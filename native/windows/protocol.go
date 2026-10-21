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
//	标准输入  {"cmd":"bind","bindings":[{"id":"dictate#0","mods":[165],"when":"always"},{"id":"cancel#0","mods":[],"key":1,"when":"capturing"}]}
//	          {"cmd":"paste","id":1,"text":"…"}
//	          {"cmd":"capture","regions":[{"id":"cancel","x":0,"y":0,"width":28,"height":28}]}   屏幕上的物理像素
//	          {"cmd":"release"}
//
// bind 整表替换，随时可以再发；起来以后收到第一条 bind 之前一个热键也不听。一个绑定：
//   - mods：修饰键的 vk（分左右，0xA0–0xA5、0x5B、0x5C），0 到 2 个；key：普通键的扫描码，扩展键带 0xE0 高字节
//     （上箭头是 0xE048），可以不带。合起来 1 到 2 个键（docs/hotkey-research.md 5.3、5.8）。
//   - when：always 一直听；capturing 只在截着（capture 之后、release 之前）时听，只能是单独一个普通键（取消用的 esc）。
//   - 装不上的写在 bound 的 rejected 里：invalid 是不合上面的规矩（或者 id 是空的、重复了），
//     needs_listen 是键盘钩子没装上。整条的形状不对（不是一组、少了字段）报 error，绑定表不动。
//
// 父进程退出（标准输入关闭）时自己也退出。和 macOS 不同的地方：
//   - Windows 没有"输入监控""辅助功能"这两项权限，listen、trusted 照实报装没装上钩子；
//   - 目标窗口是以管理员身份运行的、我们不是时，系统不让模拟的按键进去（UIPI），而且不报错：
//     这时不去按 Ctrl+V，把文字留在剪贴板里，报 ok:false、reason:"elevated"。发给它的按键钩子也收不到，
//     所以前台换成这种窗口时报 elevated_foreground，让父进程提示（我们自己以管理员身份运行时不报）；
//   - 没有 permissions、secure_input；睡眠唤醒、解锁以后自己重装钩子，报 relistened。
//
// 这个文件和 keys.go、matcher.go、capture.go 只有纯逻辑，不碰 Windows 的接口，在任何系统上都能 go test。
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
	if b.ID == "" || (when != "always" && when != "capturing") || len(b.Mods) > 2 {
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
	if n := len(b.keys()); n < 1 || n > 2 {
		return false
	}
	// 只在说话时生效的按单独一个普通键认（matcher.capturingBinding），带了修饰键或没有普通键就永远认不出来
	return !b.Capturing || (b.HasKey && len(b.Mods) == 0)
}

// 父进程按数组读 rejected：一个都没拒也写成 []，不写成 null
func boundEvent(rejected []rejection) event {
	if rejected == nil {
		rejected = []rejection{}
	}
	return event{"event": "bound", "rejected": rejected}
}

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
