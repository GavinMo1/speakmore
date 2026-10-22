// probe、info 两条命令的纯逻辑（只用 Foundation）：系统快捷键表、系统设置由 Control.swift 读来交给这里
// （docs/hotkey-research.md 5.5、5.8）。
//   probe  查一个组合是不是已经被系统快捷键（CopySymbolicHotKeys）占了。有普通键的才可能冲突："修饰键 + 普通键"，
//          和单个普通键——本机表里单个 F11、F12、F14、F15 都是启用的系统快捷键，修饰位只有合成的 fn 位（2026-10-21）。
//          只有修饰键的，系统表里没有对应的形状，直接不冲突。
//   info   系统设置里和热键相关的值，第一版只有地球仪键的用途（AppleFnUsageType）。

import Foundation

/// 系统快捷键表里的一条（CopySymbolicHotKeys 的一项）
struct SymbolicHotKey {
    let code: Int
    /// kHISymbolicHotKeyModifiers
    let modifiers: Int
    let enabled: Bool
}

/// 系统快捷键表读不出来
struct SymbolicFailure: Error {
    let status: Int32
}

/// 修饰键的键码 → kHISymbolicHotKeyModifiers 里的位，左右合成一个。
/// 这个值是 Carbon 那套（Events.h 的 cmdKey 0x100、shiftKey 0x200、optionKey 0x800、controlKey 0x1000，
/// CarbonEvents.h 的 kEventKeyModifierFnMask 0x20000），不是 NSEvent 那套（0x100000…）。本机核对过（2026-10-21）：
/// 表里 230 条、171 条启用；⌘空格（Spotlight）是键码 49 + 0x100，⌃空格（切换输入法）是键码 49 + 0x1000，都启用；
/// 出现过的位合起来是 0x21B00，不含别的位
private let symbolicModifierBits: [Int: Int] = [
    0x37: 0x100, 0x36: 0x100, 0x38: 0x200, 0x3C: 0x200, 0x3A: 0x800, 0x3D: 0x800, 0x3B: 0x1000, 0x3E: 0x1000,
    fnKeyCode: 0x20000,
]
private let symbolicFnBit = 0x20000

/// 系统表里这些键的条目一律带着 fn 位：F 键、方向键、Help/Home/End/PageUp/PageDown/向前删除的事件本身就带 fn 位，
/// 这个位是合成的（本机表里 F 键、方向键、Help 的条目没有一条不带它，比如 ⌃F2 记成 0x21000）。比的时候两边都不看 fn。
/// 字母键上的 fn 位是真的（地球仪+A、地球仪+F 之类，记成 0x20000），照比
private let keysWithSyntheticFn: Set<Int> = functionKeyCodes.union([0x7B, 0x7C, 0x7D, 0x7E, 0x72, 0x73, 0x74, 0x75, 0x77, 0x79])

/// 修饰键 + 普通键（或单个普通键，mods 为空）和系统表里启用的哪一条一样：键码相同、修饰位相同
func symbolicConflict(mods: [Int], key: Int, in table: [SymbolicHotKey]) -> Bool {
    let ignored = keysWithSyntheticFn.contains(key) ? symbolicFnBit : 0
    let wanted = mods.reduce(0) { $0 | (symbolicModifierBits[$1] ?? 0) } & ~ignored
    return table.contains { $0.enabled && $0.code == key && $0.modifiers & ~ignored == wanted }
}

/// probe 要报的事件，按顺序：形状不对先报 error；id 是整数时一定有一条 probed，不是整数就只有 error。
/// symbolic 只在真要比（有普通键、形状对、有 id）时才调：系统表要 O(条数) 去读，头文件说别多调
func answerProbe(_ object: [String: Any], symbolic: () -> Result<[SymbolicHotKey], SymbolicFailure>) -> [[String: Any]] {
    var problems: [String] = []
    let id = integer(object["id"])
    if id == nil { problems.append("probe 需要整数 id") }
    let mods = naturals(object["mods"])
    if mods == nil { problems.append("probe 的 mods 要是一组键码") }
    var key: Int?
    if let raw = object["key"], !(raw is NSNull) {
        key = natural(raw)
        if key == nil { problems.append("probe 的 key 要是键码") }
    }
    if problems.isEmpty, let mods, !isValidChord(mods: mods, key: key) {
        problems.append("probe 的组合不合规矩：修饰键 0 到 2 个、不重复，普通键最多 1 个，合计 1 到 2 个键")
    }

    var events: [[String: Any]] = []
    if !problems.isEmpty { events.append(["event": "error", "message": problems.joined(separator: "；")]) }
    guard let id else { return events }
    var conflict = false
    if problems.isEmpty, let mods, let key {
        switch symbolic() {
        case let .success(table):
            conflict = symbolicConflict(mods: mods, key: key, in: table)
        case let .failure(failure):
            events.append(["event": "error", "message": "系统快捷键表读不出来（OSStatus \(failure.status)），当作没冲突"])
        }
    }
    events.append(conflict ? ["event": "probed", "id": id, "conflict": true, "source": "symbolic"]
        : ["event": "probed", "id": id, "conflict": false])
    return events
}

/// info 的那一行。fnUsage 是 AppleFnUsageType 读到的值：整数才带，读不到（本机就没有这一项）或者类型不对就不带
func infoEvent(fnUsage value: Any?) -> [String: Any] {
    var event: [String: Any] = ["event": "info"]
    if let usage = integer(value) { event["fnUsage"] = usage }
    return event
}
