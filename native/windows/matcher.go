package main

// 热键匹配（纯逻辑）：父进程用 bind 下发绑定表，低级钩子把每个键盘事件交给这里，这里说吞不吞、报什么。
// 规矩和 macOS 版一字不差，由两边共用的按键轨迹样例约束（native/fixtures/hotkeys/，docs/hotkey-research.md 5.3）：
//   - 按住的键集合恰好等于某个绑定才算，多一个键都不算。修饰键之间不分先后；有普通键的，普通键要最后按。
//   - 只有按下能凑成组合；组合里的键全部松开才算松开。按着时组合里的某个键松开又按回去，不算新的一下。
//   - 按着时来了组合外的键：新的集合恰好是另一个绑定就是"升级"，先报打断（带 to）再报新绑定按下；否则报一次打断，
//     之后不报松开，组合里的键全松开之前不再触发任何东西。
//   - 修饰键一律不吞；凑成组合的那个普通键整段吞掉（按下、自动重复、松开）。有 Alt 或 Win 的绑定按下时要插掩码键。
//   - 只在说话时生效的绑定（取消）不按集合认：截着的时候它那个键一按下就算，吞掉，也不进按住的键。
//   - 松开的事件可能丢（UIPI、管理员窗口）：每次按下前用系统接口核对按住的普通键，按下超过 10 秒的也当丢了。
//     我们吞掉的键系统接口查不准，只按 10 秒算（只有 Windows 这样，见 prune）。
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
	0xA0: true, 0xA1: true, // 左右 Shift
	vkLControl: true, vkRControl: true,
	0xA4: true, vkRMenu: true, // 左右 Alt
	0x5B: true, 0x5C: true, // 左右 Win
}

// 按着时要插掩码键的修饰键：Alt 和 Win 单独松开会打开菜单栏、开始菜单
var maskedVKs = map[uint32]bool{0xA4: true, vkRMenu: true, 0x5B: true, 0x5C: true}

func keyIDOf(in keyInput) keyID {
	if modifierVKs[in.vk] {
		return modifierBit | keyID(in.vk)
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

func (b *binding) masked() bool {
	for _, vk := range b.Mods {
		if maskedVKs[vk] {
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

// 监听停了又打开（钩子重装、睡眠唤醒）：这段时间的松开多半丢了。按着的绑定补报松开，按住的普通键和吞了一半的都清掉
func (m *matcher) reset() []event {
	events := m.release()
	for id := range m.held {
		if !id.isModifier() {
			delete(m.held, id)
		}
	}
	m.swallowed = map[keyID]bool{}
	m.capturingDown = map[keyID]*binding{}
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
	// 自己模拟的（插的掩码键、贴字时的 Ctrl+V）：不算用户按的键
	if in.ours {
		return outcome{}
	}
	// 用了 AltGr 的布局上，按右 Alt 时系统先补一个假的左 Ctrl：不是用户按的别的键
	if in.vk == vkLControl && in.scan == altGrFakeCtrlScan {
		return outcome{}
	}
	id := keyIDOf(in)
	if in.down {
		return m.onDown(id, in)
	}
	return m.onUp(id)
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
	return outcome{swallow: swallow, events: append(before, bindingEvent(b, true)), mask: b.masked()}
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

// 按下前核对按住的普通键：系统说已经松开的、按下超过 10 秒的，都当成松开的事件丢了（docs/hotkey-research.md 5.3 第 8 条）
func (m *matcher) prune(now uint32) {
	for id, key := range m.held {
		if id.isModifier() {
			continue
		}
		// 吞掉的不问系统：低级钩子吞了按下，系统就不更新这个键的状态，GetAsyncKeyState 一直说它没按着
		// （所有低级钩子都放行了才改：https://devblogs.microsoft.com/oldnewthing/20140213-00/?p=1773 ）。
		// 它的松开要是丢了，只靠 10 秒清。无符号相减：钩子的时间 49 天绕一圈也算得对
		if now-key.since > staleAfterMs || (!m.swallowed[id] && !m.stillDown(id, key)) {
			delete(m.held, id)
		}
	}
}
