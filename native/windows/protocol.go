// Windows 上的原生小帮手：按父进程下发的绑定表听热键、把文字贴进当前输入框、听写进行中截住悬浮条上的点击。
// 和父进程的约定与 macOS 版（native/mac/main.swift）一字不差，父进程（src/app/helper.mjs）不分系统：
//
//	标准输出  {"event":"ready","listen":true,"trusted":true,"capture":true}
//	          {"event":"bound","rejected":[{"id":"x#0","reason":"invalid"}]}   每条 bind 回一条；rejected 总是一组，都装上了是 []
//	          {"event":"binding","id":"dictate#0","down":true}               绑定按下 / 松开（down 为 false）
//	          {"event":"interrupted","id":"dictate#0"}                       按着时又按了组合外的键；之后不报它的松开
//	          {"event":"interrupted","id":"dictate#0","to":"x#0"}            升级成了另一个绑定，紧接着报 x#0 的按下
//	          {"event":"pasted","id":1,"ok":true}     ok 为 false 时文字留在剪贴板里，reason 说为什么
//	          {"event":"click","id":"cancel"}
//	          {"event":"relistened","reason":"resume"}            睡眠唤醒（resume）、解锁或切回这个用户（unlock）以后重装了键盘钩子
//	          {"event":"elevated_foreground","on":true,"pid":42}   前台换成了以管理员身份运行的窗口（换走了是 on:false，不带 pid）
//	          {"event":"recording","on":true,"mods":[163],"keys":[100]}   录键模式里按住的键：进入时先报一次两个空的，之后每变一次报一次
//	          {"event":"recording","on":false}                     离开了录键模式（父进程让停的、录了 30 秒自己停的都报）
//	          {"event":"probed","id":7,"conflict":true,"source":"registered"}   这个组合别的程序用 RegisterHotKey 登记过了；
//	                                                                  没有就是 {"event":"probed","id":7,"conflict":false}
//	          {"event":"info"}                                     Windows 上没有要报的系统设置
//	标准输入  {"cmd":"bind","bindings":[{"id":"dictate#0","mods":[165],"when":"always"},{"id":"cancel#0","mods":[],"key":1,"when":"capturing"}]}
//	          {"cmd":"paste","id":1,"text":"…"}
//	          {"cmd":"capture","regions":[{"id":"cancel","x":0,"y":0,"width":28,"height":28}]}   屏幕上的物理像素
//	          {"cmd":"release"}
//	          {"cmd":"record","on":true}   进入录键模式，已经在录就从头录；on:false 离开，没在录时什么也不报
//	          {"cmd":"probe","id":7,"mods":[163],"key":100}   mods、key 的写法同 bind 的一个绑定
//	          {"cmd":"info"}
//
// bind 整表替换，随时可以再发；起来以后收到第一条 bind 之前一个热键也不听。一个绑定：
//   - mods：修饰键的 vk（分左右，0xA0–0xA5、0x5B、0x5C），0 到 2 个；key：普通键的扫描码，扩展键带 0xE0 高字节
//     （上箭头是 0xE048），可以不带。合起来 1 到 2 个键（docs/hotkey-research.md 5.3、5.8）。
//   - when：always 一直听；capturing 只在截着（capture 之后、release 之前）时听，只能是单独一个普通键（取消用的 esc）。
//   - 装不上的写在 bound 的 rejected 里：invalid 是不合上面的规矩（或者 id 是空的、重复了），
//     needs_listen 是键盘钩子没装上。整条的形状不对（不是一组、少了字段）报 error，绑定表不动。
//
// 录键（record.go，docs/hotkey-research.md 5.6）：设置页换键时用。进入时按着的绑定先补报松开，之后匹配器停着，
// 不报 binding、interrupted，截着时的取消键也不认；离开时匹配器从头认。mods 是修饰键分左右的 vk，keys 是别的键的扫描码
// （同 bind 的 key），各自升序。只算进入以后按下的键，自动重复不算；录到的键整段吞掉，修饰键也吞，离开时还按着的吞到松开为止。
// 录了 30 秒还没停，先报 {"event":"error"} 再照离开处理。截不截、悬浮条上的点击录键都不管，照截的规矩来。
//
// probe（docs/hotkey-research.md 5.5）：只有"修饰键 + 普通键"会去试登记（RegisterHotKey 必须有普通键，修饰键不分左右），
// 只有修饰键的、单个普通键的直接回 conflict:false。id 是整数就一定回一条 probed：形状不对、试登记出了别的错，
// 都回 conflict:false，另报一条 error 说为什么；没有 id 的只报 error。
//
// 隐私：除了录键模式，只报绑定的按下、松开、被打断，不报按的是哪个键。录键是一个有边界的例外：只在父进程说"录"之后、
// 说"停"或 30 秒到点之前报，只报按住的键码，不报打出来的字符；进入前就按着的、自己模拟的不报。
//
// 父进程退出（标准输入关闭）时自己也退出。和 macOS 不同的地方：
//   - Windows 没有"输入监控""辅助功能"这两项权限，listen、trusted 照实报装没装上钩子；
//   - 目标窗口是以管理员身份运行的、我们不是时，系统不让模拟的按键进去（UIPI），而且不报错：
//     这时不去按 Ctrl+V，把文字留在剪贴板里，报 ok:false、reason:"elevated"。发给它的按键钩子也收不到，
//     所以前台换成这种窗口时报 elevated_foreground，让父进程提示（我们自己以管理员身份运行时不报）；
//   - 没有 permissions、secure_input；睡眠唤醒、解锁以后自己重装钩子，报 relistened；
//   - info 不带别的字段；probed 的 source 只会是 registered（Mac 是 symbolic）。
//
// 这个文件和 keys.go、matcher.go、record.go、capture.go 只有纯逻辑，不碰 Windows 的接口，在任何系统上都能 go test。
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"slices"
)

// 一块屏幕区域：悬浮条上的一个按钮。坐标是屏幕上的物理像素，和低级鼠标钩子报的一致
type region struct {
	ID     string
	X, Y   float64
	Width  float64
	Height float64
}

// 和 macOS 的 CGRect.contains 一样：左、上边算在里面，右、下边不算
func (r region) contains(x, y float64) bool {
	return x >= r.X && x < r.X+r.Width && y >= r.Y && y < r.Y+r.Height
}

type command struct {
	Cmd      string          `json:"cmd"`
	ID       *int            `json:"id"`
	Text     *string         `json:"text"`
	Regions  json.RawMessage `json:"regions"`
	Bindings json.RawMessage `json:"bindings"`
	On       json.RawMessage `json:"on"`
	Mods     json.RawMessage `json:"mods"`
	Key      json.RawMessage `json:"key"`
}

func parseCommand(line []byte) (command, error) {
	var parsed command
	if err := json.Unmarshal(line, &parsed); err != nil || parsed.Cmd == "" {
		return command{}, errors.New("看不懂的命令行")
	}
	return parsed, nil
}

func parseRegions(raw json.RawMessage) ([]region, error) {
	var items []struct {
		ID     *string  `json:"id"`
		X      *float64 `json:"x"`
		Y      *float64 `json:"y"`
		Width  *float64 `json:"width"`
		Height *float64 `json:"height"`
	}
	bad := errors.New("capture 需要 regions：一组 { id, x, y, width, height }")
	if len(raw) == 0 || json.Unmarshal(raw, &items) != nil || items == nil {
		return nil, bad
	}
	regions := make([]region, 0, len(items))
	for _, item := range items {
		if item.ID == nil || item.X == nil || item.Y == nil || item.Width == nil || item.Height == nil {
			return nil, bad
		}
		if *item.Width <= 0 || *item.Height <= 0 {
			return nil, bad
		}
		regions = append(regions, region{ID: *item.ID, X: *item.X, Y: *item.Y, Width: *item.Width, Height: *item.Height})
	}
	return regions, nil
}

// 装不上的一个绑定和为什么：invalid 是它不合规矩，needs_listen 是键盘钩子没装上
type rejection struct {
	ID     string `json:"id"`
	Reason string `json:"reason"`
}

var errBadBindings = errors.New("bind 需要 bindings：一组 { id, mods, key?, when }")

// bind 的绑定表。整条的形状不对（不是一组、少了字段、字段类型不对）返回 error，这时绑定表不该动：
// 那是父进程写错了，不是哪一个绑定的事。单个绑定不合规矩的放进 rejected、原因 invalid，其余照装。
// listening 为 false（键盘钩子没装上）时，合规矩的也一个都装不了，原因 needs_listen
func parseBindings(raw json.RawMessage, listening bool) ([]binding, []rejection, error) {
	var items []struct {
		ID   *string   `json:"id"`
		Mods *[]uint32 `json:"mods"`
		Key  *uint32   `json:"key"`
		When *string   `json:"when"`
	}
	if len(raw) == 0 || json.Unmarshal(raw, &items) != nil || items == nil {
		return nil, nil, errBadBindings
	}
	ids := map[string]int{}
	for _, item := range items {
		if item.ID == nil || item.Mods == nil || item.When == nil {
			return nil, nil, errBadBindings
		}
		ids[*item.ID]++
	}
	var bindings []binding
	var rejected []rejection
	for _, item := range items {
		b := binding{ID: *item.ID, Mods: *item.Mods, Capturing: *item.When == "capturing"}
		if item.Key != nil {
			b.Key, b.HasKey = *item.Key, true
		}
		switch {
		// 事件只带 id：同一个 id 出现两次，父进程分不清是哪一个触发的，所以都不装
		case ids[b.ID] > 1 || !validBinding(b, *item.When):
			rejected = append(rejected, rejection{ID: b.ID, Reason: "invalid"})
		case !listening:
			rejected = append(rejected, rejection{ID: b.ID, Reason: "needs_listen"})
		default:
			bindings = append(bindings, b)
		}
	}
	return bindings, rejected, nil
}

// 一个绑定合不合规矩（docs/hotkey-research.md 5.3、5.8）。主进程下发前校验过，这里再守一道：
// 写错的绑定装进匹配器，轻则永远凑不成，重则吞掉不该吞的键
func validBinding(b binding, when string) bool {
	if b.ID == "" || (when != "always" && when != "capturing") || !validKeys(b) {
		return false
	}
	// 只在说话时生效的按单独一个普通键认（matcher.capturingBinding），带了修饰键或没有普通键就永远认不出来
	return !b.Capturing || (b.HasKey && len(b.Mods) == 0)
}

// 组合里的键合不合规矩（bind 和 probe 共用）：修饰键 0 到 2 个、不重复，合起来 1 到 2 个键
func validKeys(b binding) bool {
	if len(b.Mods) > 2 {
		return false
	}
	for i, vk := range b.Mods {
		if !modifierVKs[vk] || slices.Contains(b.Mods[:i], vk) {
			return false
		}
	}
	// 普通键是扫描码：一个字节，扩展键带 0xE0 前缀（matcher 的 keyIDOf 就这么认）
	if b.HasKey && !(b.Key >= 0x01 && b.Key <= 0xFF || b.Key >= 0xE001 && b.Key <= 0xE0FF) {
		return false
	}
	n := len(b.keys())
	return n >= 1 && n <= 2
}

// 父进程按数组读 rejected：一个都没拒也写成 []，不写成 null
func boundEvent(rejected []rejection) event {
	if rejected == nil {
		rejected = []rejection{}
	}
	return event{"event": "bound", "rejected": rejected}
}

// record 的 on：true 进入录键模式，false 离开
func parseRecord(raw json.RawMessage) (bool, error) {
	var on *bool
	if len(raw) == 0 || json.Unmarshal(raw, &on) != nil || on == nil {
		return false, errors.New("record 需要 on：true 或 false")
	}
	return *on, nil
}

// probe 命令。要去试登记的，返回 id 和组合（mods、key 的写法同 bind 的一个绑定，没有 id、when）；
// 不用试就能回的，reply 是要报的事件：父进程按 id 等回信，id 是整数就一定回一条 probed，没有 id 的只能报 error
func parseProbe(c command) (id int, combo binding, reply []event) {
	if c.ID == nil {
		return 0, binding{}, []event{{"event": "error", "message": "probe 需要整数 id"}}
	}
	id = *c.ID
	combo, err := parseCombo(c.Mods, c.Key)
	if err != nil {
		return id, binding{}, []event{noConflict(id), {"event": "error", "message": err.Error()}}
	}
	// RegisterHotKey 必须有一个普通键：只有修饰键的、单个普通键的，别的程序用它登记不了，也就占不了
	if len(combo.Mods) == 0 || !combo.HasKey {
		return id, binding{}, []event{noConflict(id)}
	}
	return id, combo, nil
}

func parseCombo(mods, key json.RawMessage) (binding, error) {
	var combo binding
	if len(mods) == 0 || json.Unmarshal(mods, &combo.Mods) != nil || combo.Mods == nil {
		return binding{}, errors.New("probe 的 mods 不对：要一组修饰键的 vk，同 bind")
	}
	var k *uint32
	if len(key) > 0 && json.Unmarshal(key, &k) != nil {
		return binding{}, errors.New("probe 的 key 不对：要一个普通键的扫描码，同 bind")
	}
	if k != nil {
		combo.Key, combo.HasKey = *k, true
	}
	if !validKeys(combo) {
		return binding{}, errors.New("probe 的组合不合规矩：同 bind，修饰键 0 到 2 个、不重复，合起来 1 到 2 个键")
	}
	return combo, nil
}

// RegisterHotKey 的修饰键（WinUser.h 的 MOD_*）。它不分左右，左右合并
const (
	modAlt      = 0x0001
	modControl  = 0x0002
	modShift    = 0x0004
	modWin      = 0x0008
	modNoRepeat = 0x4000
)

// 试登记用的修饰键：一律带 MOD_NOREPEAT，登记上的那一瞬间用户正按着也不会连发
func registerModifiers(mods []uint32) uint32 {
	flags := uint32(modNoRepeat)
	for _, vk := range mods {
		switch vk {
		case vkLMenu, vkRMenu:
			flags |= modAlt
		case vkLControl, vkRControl:
			flags |= modControl
		case vkLShift, vkRShift:
			flags |= modShift
		case vkLWin, vkRWin:
			flags |= modWin
		}
	}
	return flags
}

// RegisterHotKey 失败时 GetLastError 给的这个，是组合已经被别的程序登记了
const errHotkeyAlreadyRegistered = 1409

// 试登记的结果怎么报。别的失败查不出占没占：照没占报，另报一条 error 带上错误码
func probeResult(id int, registered bool, lastError uint32) []event {
	switch {
	case registered:
		return []event{noConflict(id)}
	case lastError == errHotkeyAlreadyRegistered:
		return []event{{"event": "probed", "id": id, "conflict": true, "source": "registered"}}
	}
	return []event{noConflict(id), {"event": "error", "message": fmt.Sprintf("试登记组合没成功（错误码 %d），查不出是不是被别的程序占了", lastError)}}
}

func noConflict(id int) event { return event{"event": "probed", "id": id, "conflict": false} }

// 一行要交给父进程的事件
type event map[string]any

func encodeEvent(e event) []byte {
	line, err := json.Marshal(e)
	if err != nil {
		// 只有我们自己拼的几种字段，不会走到这里；万一走到了也要说一声，不能静默丢掉
		line, _ = json.Marshal(event{"event": "error", "message": fmt.Sprintf("序列化失败：%v", err)})
	}
	return append(line, '\n')
}
