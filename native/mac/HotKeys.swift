// Carbon 热键（RegisterEventHotKey）：要 NSApplication 跑着，回调只在主线程的事件循环里来
// （V19：只跑 RunLoop 时键照样被系统接走，回调却永远不来）。两种用法（docs/hotkey-research.md 4.1）：
//   单个 F 键  一直注册着，修饰键传 0：tap 关着时 F 键会漏给前台应用，交给系统自己吞。系统在 session 层所有 tap 之后匹配它，
//              所以只听 tap 照样先看到按下松开，平时以 tap 看到的为准。MacBook 上按 fn+F5 时还触不触发，未验证（V21）
//   安全输入   开着时 tap 收不到按下松开，带普通键的绑定（修饰键 + 普通键、截着时的取消键）另由 Carbon 注册一份顶着，
//              关掉就注销（Handy 的做法）。Carbon 分不了左右：⌥空格会把左右两边都吞掉，由匹配器按它记着的左右去凑
// 回调收到的按下松开交给匹配器（Keyboard.swift 的 carbonFired），那边只在安全输入开着时才算。

import Carbon.HIToolbox
import Foundation

/// 单个键的注册：id 就是键码
private let singleSignature: OSType = 0x534D_4B48 // "SMKH"
/// 安全输入期间顶着的注册：id 是顺序号，对应哪个键记在 shadowKeys 里
private let shadowSignature: OSType = 0x534D_4B53 // "SMKS"

/// 修饰键的键码 → Carbon 的修饰位（左右合成一个）。fn 没有对应的位，带 fn 的组合顶不了
private let carbonModifiers: [Int: Int] = [
    0x37: cmdKey, 0x36: cmdKey, 0x38: shiftKey, 0x3C: shiftKey, 0x3A: optionKey, 0x3D: optionKey,
    0x3B: controlKey, 0x3E: controlKey,
]

private func register(_ key: Int, modifiers: Int, signature: OSType, id: UInt32) -> (EventHotKeyRef?, OSStatus) {
    var ref: EventHotKeyRef?
    let status = RegisterEventHotKey(UInt32(key), UInt32(modifiers), EventHotKeyID(signature: signature, id: id),
                                     GetEventDispatcherTarget(), 0, &ref)
    return (status == noErr ? ref : nil, status)
}

/// 安全输入期间顶着的一个组合：Carbon 分不了左右，左右两边的同一个组合在它眼里是一个
private struct ShadowCombo: Hashable {
    let key: Int
    /// Carbon 的修饰位，左右已经合成一个
    let modifiers: Int
}

final class HotKeys {
    private var singles: [Int: EventHotKeyRef] = [:]
    private var shadows: [ShadowCombo: (ref: EventHotKeyRef, id: UInt32)] = [:]
    private var shadowKeys: [UInt32: Int] = [:]
    /// 下一个顶着的注册用的 id：留着的注册不换 id，新加的不能和它们撞
    private var nextShadowID: UInt32 = 1
    private var installed = false

    /// 现在一直注册着的单个键
    var singleKeys: Set<Int> { Set(singles.keys) }

    /// 单个键换成这几个。返回注册不上的键和原因
    func replaceSingles(with wanted: Set<Int>) -> [Int: OSStatus] {
        installHandler()
        for (key, ref) in singles where !wanted.contains(key) {
            UnregisterEventHotKey(ref)
            singles.removeValue(forKey: key)
        }
        var failed: [Int: OSStatus] = [:]
        for key in wanted where singles[key] == nil {
            let (ref, status) = register(key, modifiers: 0, signature: singleSignature, id: UInt32(key))
            if let ref { singles[key] = ref } else { failed[key] = status }
        }
        return failed
    }

    /// 安全输入期间顶着的注册换成这几个绑定的（空的就是全注销）。单个键已经一直注册着，不再注册一遍。
    /// 只注销不再要的、只注册新加的，没变的原样留着：capture、release 每次都走到这里，那时组合里的键多半还按着，
    /// 注销重注的话，新的注册没见过这次按下，它的松开很可能报不过来（推断，没在真机上验过）。
    /// 返回顶不了的绑定 id：带 fn 的、注册不上的（被别的应用占了）
    func replaceShadows(with bindings: [Binding]) -> [String] {
        installHandler()
        // 每个要顶的绑定对应的组合；nil 是顶不了的（带 fn，Carbon 没有对应的位）
        let wanted: [(id: String, combo: ShadowCombo?)] = bindings.compactMap { binding in
            guard let key = binding.key, binding.capturing || !binding.mods.isEmpty else { return nil }
            let mods = binding.mods.compactMap { carbonModifiers[$0] }
            guard mods.count == binding.mods.count else { return (binding.id, nil) }
            return (binding.id, ShadowCombo(key: key, modifiers: mods.reduce(0, |)))
        }
        let combos = Set(wanted.compactMap(\.combo))
        for (combo, shadow) in shadows where !combos.contains(combo) {
            UnregisterEventHotKey(shadow.ref)
            shadows.removeValue(forKey: combo)
            shadowKeys.removeValue(forKey: shadow.id)
        }
        var failed: Set<ShadowCombo> = []
        var unavailable: [String] = []
        for (id, combo) in wanted {
            guard let combo, !failed.contains(combo) else {
                unavailable.append(id)
                continue
            }
            // 注册过的（留着的，或者这一轮左右另一边刚注册的）不再注册
            guard shadows[combo] == nil else { continue }
            let shadowID = nextShadowID
            let (ref, _) = register(combo.key, modifiers: combo.modifiers, signature: shadowSignature, id: shadowID)
            if let ref {
                nextShadowID &+= 1
                shadows[combo] = (ref, shadowID)
                shadowKeys[shadowID] = combo.key
            } else {
                failed.insert(combo)
                unavailable.append(id)
            }
        }
        return unavailable
    }

    /// Carbon 报了一个热键：认出是哪个键，交给匹配器
    fileprivate func fired(_ id: EventHotKeyID, down: Bool) {
        let key: Int?
        switch id.signature {
        case singleSignature: key = Int(id.id)
        case shadowSignature: key = shadowKeys[id.id]
        default: key = nil
        }
        guard let key else { return }
        carbonFired(key, down: down)
    }

    private func installHandler() {
        guard !installed else { return }
        installed = true
        var types = [
            EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed)),
            EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyReleased)),
        ]
        let status = InstallEventHandler(GetEventDispatcherTarget(), onHotKey, 2, &types, nil, nil)
        if status != noErr { emit(["event": "error", "message": "Carbon 热键的回调装不上（OSStatus \(status)）"]) }
    }
}

let hotKeys = HotKeys()

private let onHotKey: EventHandlerUPP = { _, event, _ in
    guard let event else { return OSStatus(eventNotHandledErr) }
    var id = EventHotKeyID()
    let status = GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID),
                                   nil, MemoryLayout<EventHotKeyID>.size, nil, &id)
    guard status == noErr else { return status }
    hotKeys.fired(id, down: GetEventKind(event) == UInt32(kEventHotKeyPressed))
    return noErr
}
