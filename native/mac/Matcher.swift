// 热键匹配（纯逻辑，只用 Foundation）：父进程用 bind 下发绑定表，tap 把每个键盘事件交给这里，这里说吞不吞、报什么。
// 规矩和 Windows 版（native/windows/matcher.go）一字不差，由两边共用的按键轨迹样例约束
// （native/fixtures/hotkeys/，docs/hotkey-research.md 5.3）：
//   - 按住的键集合恰好等于某个绑定才算，多一个键都不算。修饰键之间不分先后；有普通键的，普通键要最后按。
//   - 只有按下能凑成组合；组合里的键全部松开才算松开。按着时组合里的某个键松开又按回去，不算新的一下。
//   - 按着时来了组合外的键：新的集合恰好是另一个绑定就是"升级"，先报打断（带 to）再报新绑定按下；否则报一次打断，
//     之后不报松开，组合里的键全松开之前不再触发任何东西。
//   - 修饰键一律不吞；凑成组合的那个普通键整段吞掉（按下、自动重复、松开）。
//   - 只在说话时生效的绑定（取消）不按集合认：截着的时候它那个键一按下就算，吞掉，也不进按住的键。
//   - 松开的事件可能丢（安全输入会吞掉松开）：每次按下前用系统接口核对按住的普通键，按下超过 10 秒的也当丢了。
//   - MacBook 上 fn 按着再按 F 键才是 F 键：这时把 fn 当成没按。
// 只报绑定的按下、松开、被打断，不报是哪个键。键都用 kVK 键码（HIToolbox/Events.h），修饰键和别的键的码不重叠。

import Foundation

/// 一个绑定：父进程 bind 下发的一行
struct Binding {
    let id: String
    /// 修饰键的键码，0 到 2 个
    let mods: [Int]
    /// 普通键的键码；只有修饰键的绑定是 nil
    let key: Int?
    /// 只在说话时生效
    let capturing: Bool

    var keys: [Int] { key.map { mods + [$0] } ?? mods }
}

enum HotkeyEvent: Equatable {
    case binding(id: String, down: Bool)
    case interrupted(id: String, to: String?)

    /// 报给父进程的那一行
    var json: [String: Any] {
        switch self {
        case let .binding(id, down): return ["event": "binding", "id": id, "down": down]
        case let .interrupted(id, to?): return ["event": "interrupted", "id": id, "to": to]
        case let .interrupted(id, nil): return ["event": "interrupted", "id": id]
        }
    }
}

struct Outcome: Equatable {
    var swallow = false
    var events: [HotkeyEvent] = []
}

/// 修饰键的键码：左右 Command、Shift、Option、Control，和 fn（不含 CapsLock：它不让绑，当普通键）
let modifierKeyCodes: Set<Int> = [0x37, 0x36, 0x38, 0x3C, 0x3A, 0x3D, 0x3B, 0x3E, 0x3F]
let fnKeyCode = 0x3F
/// F1–F20 的键码：MacBook 上第一排默认是亮度、音量，按着 fn 才是 F 键
let functionKeyCodes: Set<Int> = [
    0x7A, 0x78, 0x63, 0x76, 0x60, 0x61, 0x62, 0x64, 0x65, 0x6D, 0x67, 0x6F, 0x69, 0x6B, 0x71, 0x6A, 0x40, 0x4F, 0x50,
    0x5A,
]
/// 按下超过这么久还没松开的普通键，当成松开的事件丢了（Typeless 的 cleanupStaleKeys 也是 10 秒）
let staleAfterMs: UInt64 = 10_000

final class Matcher {
    private var bindings: [Binding] = []
    /// 系统接口说这个键还按着没有（CGEventSourceKeyState）；测试里换成假的
    private let stillDown: (Int) -> Bool

    /// 按住的键 → 什么时候按下的（毫秒）
    private var held: [Int: UInt64] = [:]
    /// 吞了按下、还要吞松开的普通键
    private var swallowed: Set<Int> = []
    /// 截着时按下、还没松开的取消键：松开时报它的松开
    private var capturingDown: [Int: Binding] = [:]
    private(set) var capturing = false

    /// 现在按着的绑定；被打断以后 interrupted 为 true，等它的键全松开再清掉
    private var current: Binding?
    private var interrupted = false

    init(stillDown: @escaping (Int) -> Bool) {
        self.stillDown = stillDown
    }

    /// 换一份绑定表。按着的绑定补报松开；按住的键照旧记着
    func bind(_ newBindings: [Binding]) -> [HotkeyEvent] {
        let events = release()
        bindings = newBindings
        return events
    }

    func setCapturing(_ on: Bool) { capturing = on }

    /// 监听停了又打开（tap 被系统停用、安全输入关掉、锁屏回来）：这段时间的松开多半丢了。
    /// 按着的绑定补报松开，按住的普通键和吞了一半的都清掉
    func reset() -> [HotkeyEvent] {
        let events = release()
        held = held.filter { modifierKeyCodes.contains($0.key) }
        swallowed = []
        capturingDown = [:]
        return events
    }

    private func release() -> [HotkeyEvent] {
        var events: [HotkeyEvent] = []
        if let binding = current, !interrupted { events.append(.binding(id: binding.id, down: false)) }
        current = nil
        interrupted = false
        return events
    }

    /// 一个键盘事件。injected：自己模拟的（贴字时的 ⌘V），不算用户按的键
    func onKey(_ code: Int, down: Bool, injected: Bool = false, timeMs: UInt64) -> Outcome {
        if injected { return Outcome() }
        return down ? onDown(code, timeMs: timeMs) : onUp(code)
    }

    private func onDown(_ code: Int, timeMs: UInt64) -> Outcome {
        // 已经按着的键又来按下：自动重复，不参与匹配；按下吞了的，重复也吞
        if capturingDown[code] != nil { return Outcome(swallow: true) }
        if held[code] != nil { return Outcome(swallow: swallowed.contains(code)) }
        // 新的一下。上一下的松开要是丢了，它吞没吞过都和这一下无关
        swallowed.remove(code)
        if capturing, let binding = bindings.first(where: { $0.capturing && $0.key == code }) {
            capturingDown[code] = binding
            return Outcome(swallow: true, events: [.binding(id: binding.id, down: true)])
        }
        prune(now: timeMs)
        held[code] = timeMs

        if let binding = current {
            if interrupted || binding.keys.contains(code) { return Outcome() }
            if let next = match(code) {
                // 升级：两键以内最多一次
                current = next
                return pressed(code, next, before: [.interrupted(id: binding.id, to: next.id)])
            }
            interrupted = true
            return Outcome(events: [.interrupted(id: binding.id, to: nil)])
        }
        if let next = match(code) {
            current = next
            return pressed(code, next)
        }
        return Outcome()
    }

    /// 绑定刚被 code 这个键凑成：报按下；凑成它的是普通键的话整段吞掉
    private func pressed(_ code: Int, _ binding: Binding, before: [HotkeyEvent] = []) -> Outcome {
        let swallow = !modifierKeyCodes.contains(code)
        if swallow { swallowed.insert(code) }
        return Outcome(swallow: swallow, events: before + [.binding(id: binding.id, down: true)])
    }

    private func onUp(_ code: Int) -> Outcome {
        if let binding = capturingDown.removeValue(forKey: code) {
            return Outcome(swallow: true, events: [.binding(id: binding.id, down: false)])
        }
        let swallow = swallowed.remove(code) != nil
        guard held.removeValue(forKey: code) != nil else { return Outcome(swallow: swallow) }
        var events: [HotkeyEvent] = []
        if let binding = current, !binding.keys.contains(where: { held[$0] != nil }) { events = release() }
        return Outcome(swallow: swallow, events: events)
    }

    /// code 刚按下，按住的键恰好等于哪个绑定。有普通键的绑定，凑成它的必须是那个普通键（普通键要最后按）。
    /// 按的是 F 键、fn 又按着时，把 fn 当成没按
    private func match(_ code: Int) -> Binding? {
        var keys = Set(held.keys)
        if functionKeyCodes.contains(code) { keys.remove(fnKeyCode) }
        return bindings.first { binding in
            !binding.capturing && (binding.key == nil || binding.key == code) && Set(binding.keys) == keys
        }
    }

    /// 按下前核对按住的普通键：系统说已经松开的、按下超过 10 秒的，都当成松开的事件丢了（docs/hotkey-research.md 5.3 第 8 条）
    private func prune(now: UInt64) {
        for (code, since) in held where !modifierKeyCodes.contains(code) {
            if now &- since > staleAfterMs || !stillDown(code) { held.removeValue(forKey: code) }
        }
    }
}
