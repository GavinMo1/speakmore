package main

// 热键匹配（纯逻辑）：父进程用 bind 下发绑定表，低级钩子把每个键盘事件交给这里，这里说吞不吞、报什么。
// 规矩和 macOS 版一字不差，由两边共用的按键轨迹样例约束（native/fixtures/hotkeys/，docs/hotkey-research.md 5.3）：
//   - 按住的键集合恰好等于某个绑定才算，多一个键都不算。修饰键之间不分先后；有普通键的，普通键要最后按。
//   - 只有按下能凑成组合；组合里的键全部松开才算松开。按着时组合里的某个键松开又按回去，不算新的一下。
//   - 按着时来了组合外的键：新的集合恰好是另一个绑定就是"升级"，先报打断（带 to）再报新绑定按下；否则报一次打断，
//     之后不报松开，组合里的键全松开之前不再触发任何东西。
//   - 修饰键一律不吞；凑成组合的那个普通键整段吞掉（按下、自动重复、松开）。
//   - 只在说话时生效的绑定（取消）不按集合认：截着的时候它那个键一按下就算，吞掉，也不进按住的键。
//   - 松开的事件可能丢（UIPI、管理员窗口、Win+L）：每次按下前用系统接口核对按住的别的键，普通键按下超过 10 秒的也当丢了。
//     我们吞掉的键系统接口查不准，只按 10 秒算；修饰键也核对（Mac 每个 flagsChanged 都从标志位重新读，不用）。见 prune。
// 只有 Windows 有的：Alt 或 Win 按住期间，我们第一次触发绑定或吞键时插一下掩码键（见 settleMask）。
// 只报绑定的按下、松开、被打断，不报是哪个键。

// 一个绑定：父进程 bind 下发的一行
type binding struct {
	ID   string
	Mods []uint32 // 修饰键的 vk，0 到 2 个
	// 普通键：扫描码，扩展键带 0xE000（同 KBDLLHOOKSTRUCT.scanCode 加 LLKHF_EXTENDED）；HasKey 为 false 时没有
	Key       uint32
	HasKey    bool
	Capturing bool // 只在说话时生效
}

// 按住的一个键在匹配里的身份：修饰键按 vk 认（左右 Shift 带不带扩展位的键盘都有），别的键按扫描码认
type keyID uint32

const modifierBit keyID = 1 << 16

var modifierVKs = map[uint32]bool{
	vkLShift: true, vkRShift: true,
	vkLControl: true, vkRControl: true,
	vkLMenu: true, vkRMenu: true,
	vkLWin: true, vkRWin: true,
}

// 单独按下再松开会打开菜单栏、开始菜单的修饰键：Alt 和 Win
var menuVKs = map[uint32]bool{vkLMenu: true, vkRMenu: true, vkLWin: true, vkRWin: true}

// 不是物理键的那几个 vk（keys.go 的 virtualVKs）在匹配里的身份：按 vk 认，和哪个扫描码都不撞
const virtualBit keyID = 1 << 17

func keyIDOf(in keyInput) keyID {
	if modifierVKs[in.vk] {
		return modifierBit | keyID(in.vk)
	}
	if virtualVKs[in.vk] {
		return virtualBit | keyID(in.vk)
	}
	id := keyID(in.scan & 0xFF)
	if in.extended {
		id |= 0xE000
	}
	return id
}

func (id keyID) isModifier() bool { return id&modifierBit != 0 }

// 按住的普通键：什么时候按下的（毫秒，钩子给的时间），和它的 vk（核对还按没按着要用）
type heldKey struct {
	since uint32
	vk    uint32
}

// 按下超过这么久还没松开的普通键，当成松开的事件丢了（Typeless 的 cleanupStaleKeys 也是 10 秒）
const staleAfterMs = 10_000

type matcher struct {
	bindings []binding
	// 系统接口说这个键还按着没有（GetAsyncKeyState）；测试里换成假的
	stillDown func(keyID, heldKey) bool

	held map[keyID]heldKey
	// 吞了按下、还要吞松开的普通键
	swallowed map[keyID]bool
	// 截着时按下、还没松开的取消键：松开时报它的松开
	capturingDown map[keyID]*binding
	capturing     bool

	// 现在按着的绑定；被打断以后 interrupted 为 true，等它的键全松开再清掉
	current     *binding
	interrupted bool
	// 这次 Alt、Win 按住期间插过掩码键了：插一次就够，全松开再清
	masked bool
}

func newMatcher(stillDown func(keyID, heldKey) bool) *matcher {
	return &matcher{
		stillDown:     stillDown,
		held:          map[keyID]heldKey{},
		swallowed:     map[keyID]bool{},
		capturingDown: map[keyID]*binding{},
	}
}

func bindingEvent(b *binding, down bool) event {
	return event{"event": "binding", "id": b.ID, "down": down}
}

func (b *binding) keys() []keyID {
	ids := make([]keyID, 0, len(b.Mods)+1)
	for _, vk := range b.Mods {
		ids = append(ids, modifierBit|keyID(vk))
	}
	if b.HasKey {
		ids = append(ids, keyID(b.Key))
	}
	return ids
}

func (b *binding) has(id keyID) bool {
	for _, key := range b.keys() {
		if key == id {
			return true
		}
	}
	return false
}

// 换一份绑定表。按着的绑定补报松开；按住的键照旧记着
func (m *matcher) bind(bindings []binding) []event {
	events := m.release()
	m.bindings = bindings
	return events
}

func (m *matcher) setCapturing(on bool) { m.capturing = on }

// 监听停了又打开（钩子重装、睡眠唤醒、解锁）：这段时间的松开多半丢了。按着的绑定补报松开，按住的普通键和吞了一半的都清掉，
// 修饰键问一遍系统（Win+L 锁屏时 Win 的松开到不了钩子，留着的话回来以后什么绑定都凑不上）
func (m *matcher) reset() []event {
	events := m.release()
	for id, key := range m.held {
		if !id.isModifier() || !m.stillDown(id, key) {
			delete(m.held, id)
		}
	}
	m.swallowed = map[keyID]bool{}
	m.capturingDown = map[keyID]*binding{}
	m.settleMask(&outcome{})
	return events
}

func (m *matcher) release() []event {
	var events []event
	if m.current != nil && !m.interrupted {
		events = append(events, bindingEvent(m.current, false))
	}
	m.current, m.interrupted = nil, false
	return events
}

func (m *matcher) onKey(in keyInput) outcome {
	// 自己模拟的（插的掩码键、贴字时的 Ctrl+V）、驱动补的假修饰键（AltGr 的假左 Ctrl、小键盘的假 Shift）：不是用户按的键
	if in.ours || in.scan&fakeScanBit != 0 {
		return outcome{}
	}
	id := keyIDOf(in)
	var out outcome
	if in.down {
		out = m.onDown(id, in)
	} else {
		out = m.onUp(id)
	}
	m.settleMask(&out)
	return out
}

// 掩码：Alt 或 Win 按住期间，我们触发了绑定或吞了键，系统看到的就是"Alt、Win 单按了一下"，松开时会开菜单。
// 这次按住期间第一回这样时插一下掩码键。被吞的键松开时也算：先按 F13（单键绑定，整段吞）、再按 Win、
// 松开 F13、松开 Win，系统看到的只有 Win 的按下松开（handy-keys 实测过，listener.rs:755-790）
func (m *matcher) settleMask(out *outcome) {
	if !m.menuKeyHeld() {
		m.masked = false
		return
	}
	if m.masked || !(out.swallow || firesBinding(out.events)) {
		return
	}
	out.mask, m.masked = true, true
}

func (m *matcher) menuKeyHeld() bool {
	for id := range m.held {
		if id.isModifier() && menuVKs[uint32(id&^modifierBit)] {
			return true
		}
	}
	return false
}

func firesBinding(events []event) bool {
	for _, e := range events {
		if e["event"] == "binding" && e["down"] == true {
			return true
		}
	}
	return false
}

func (m *matcher) onDown(id keyID, in keyInput) outcome {
	// 已经按着的键又来按下：自动重复，不参与匹配；按下吞了的，重复也吞
	if _, ok := m.capturingDown[id]; ok {
		return outcome{swallow: true}
	}
	if _, ok := m.held[id]; ok {
		return outcome{swallow: m.swallowed[id]}
	}
	// 新的一下。上一下的松开要是丢了，它吞没吞过都和这一下无关
	delete(m.swallowed, id)
	if m.capturing {
		if b := m.capturingBinding(id); b != nil {
			m.capturingDown[id] = b
			return outcome{swallow: true, events: []event{bindingEvent(b, true)}}
		}
	}
	m.prune(in.time)
	// 核对时清掉了松开丢了的 Alt、Win：上一次按住已经过去了，这一下另算
	m.settleMask(&outcome{})
	m.held[id] = heldKey{since: in.time, vk: in.vk}

	if m.current != nil {
		if m.interrupted || m.current.has(id) {
			return outcome{}
		}
		if next := m.match(id); next != nil {
			// 升级：两键以内最多一次
			previous := m.current
			m.current = next
			return m.pressed(id, next, event{"event": "interrupted", "id": previous.ID, "to": next.ID})
		}
		m.interrupted = true
		return outcome{events: []event{{"event": "interrupted", "id": m.current.ID}}}
	}
	if next := m.match(id); next != nil {
		m.current = next
		return m.pressed(id, next)
	}
	return outcome{}
}

// 绑定 b 刚被 id 这个键凑成：报按下；凑成它的是普通键的话整段吞掉
func (m *matcher) pressed(id keyID, b *binding, before ...event) outcome {
	swallow := !id.isModifier()
	if swallow {
		m.swallowed[id] = true
	}
	return outcome{swallow: swallow, events: append(before, bindingEvent(b, true))}
}

func (m *matcher) onUp(id keyID) outcome {
	if b, ok := m.capturingDown[id]; ok {
		delete(m.capturingDown, id)
		return outcome{swallow: true, events: []event{bindingEvent(b, false)}}
	}
	swallow := m.swallowed[id]
	delete(m.swallowed, id)
	if _, ok := m.held[id]; !ok {
		return outcome{swallow: swallow}
	}
	delete(m.held, id)
	var events []event
	if m.current != nil && !m.anyHeld(m.current) {
		events = m.release()
	}
	return outcome{swallow: swallow, events: events}
}

func (m *matcher) anyHeld(b *binding) bool {
	for _, key := range b.keys() {
		if _, ok := m.held[key]; ok {
			return true
		}
	}
	return false
}

// id 刚按下，按住的键恰好等于哪个绑定。有普通键的绑定，凑成它的必须是那个普通键（普通键要最后按）
func (m *matcher) match(id keyID) *binding {
	for i := range m.bindings {
		b := &m.bindings[i]
		if b.Capturing || (b.HasKey && keyID(b.Key) != id) {
			continue
		}
		keys := b.keys()
		if len(keys) != len(m.held) {
			continue
		}
		all := true
		for _, key := range keys {
			if _, ok := m.held[key]; !ok {
				all = false
				break
			}
		}
		if all {
			return b
		}
	}
	return nil
}

func (m *matcher) capturingBinding(id keyID) *binding {
	for i := range m.bindings {
		if b := &m.bindings[i]; b.Capturing && b.HasKey && keyID(b.Key) == id {
			return b
		}
	}
	return nil
}

// 按下前核对按住的别的键：系统说已经松开的、普通键按下超过 10 秒的，都当成松开的事件丢了（docs/hotkey-research.md 5.3 第 8 条）。
// 修饰键也问系统：Alt+Tab 切进管理员窗口时，Alt 和 Tab 的松开都被 UIPI 挡掉，不清掉 Alt 的话回来按右 Alt 凑不上听写。
// 修饰键不按 10 秒算：按住说话的那个键可以一直按着
func (m *matcher) prune(now uint32) {
	for id, key := range m.held {
		// 吞掉的不问系统：低级钩子吞了按下，系统就不更新这个键的状态，GetAsyncKeyState 一直说它没按着
		// （所有低级钩子都放行了才改：https://devblogs.microsoft.com/oldnewthing/20140213-00/?p=1773 ）。
		// 它的松开要是丢了，只靠 10 秒清。修饰键从来不吞。无符号相减：钩子的时间 49 天绕一圈也算得对
		stale := !id.isModifier() && now-key.since > staleAfterMs
		if stale || (!m.swallowed[id] && !m.stillDown(id, key)) {
			delete(m.held, id)
		}
	}
}
