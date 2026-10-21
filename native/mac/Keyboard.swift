// 键盘和悬浮条上的点击：三个 tap 加 Carbon，共用一个匹配器（docs/hotkey-research.md 4.1"tap 的布置""三个 tap 怎么分工"）。
//   只听 tap  常开，收 flagsChanged、keyDown、keyUp，要输入监控权限。平时匹配器靠它喂。
//   吞键 tap  能改事件，平时关着。截着（说话时）、有吞了按下还没吞松开的键、"修饰键 + 普通键"绑定的修饰键按着时才开，
//             要辅助功能权限。开着时事件先到它这里，当场匹配、当场决定吞不吞。悬浮条上的点击也由它截。
//   触发 tap  能改事件但一律放行，只收 flagsChanged；有"修饰键 + 普通键"的绑定时才建，建了就一直开着。
//             它的回调是同步的，系统等它返回才往下送：修饰键按下时在这里把吞键 tap 打开，紧跟着的普通键一定先到吞键 tap。
//             只听 tap 的回调是事后送的，等它来开就漏了：V1 实测人按得出 0.4 ms 的间隔。
//   Carbon    单个 F 键：tap 关着时 F 键会漏给前台应用，交给系统自己吞。按下松开仍以 tap 看到的为准，所以不装回调。
// 后建的 tap 排在前面：只听、吞键、触发依次建，同一个事件依次经过触发、吞键、只听。前面放行的，后面还会再收到一次，
// 按"时间戳 + 类型 + 键码 + 标志位"认出来跳过（V8 验过同一个事件经过几个 tap 时间戳不变）；前面吞掉的，后面收不到，也不需要。
// 这一版所有 tap 都在主线程上。挪到独立线程、权限撤销时作废能改事件的 tap、安全输入期间改用 Carbon 是下一步（第 7 步）。

import AppKit
import Carbon.HIToolbox

/// 自己合成的事件（贴字时的 ⌘V）带的记号（eventSourceUserData）：匹配器不把它当成用户按的键
let ourEventTag: Int64 = 0x5350_4B48 // "SPKH"，同 Windows 版

/// 修饰键的设备相关标志位（IOLLEvent.h 的 NX_DEVICE*KEYMASK），左右分得开；fn 只有一个位。
/// 每个 flagsChanged 都从标志位读"它现在按没按着"，不靠"来一次翻一次"记账，漏一个事件也能自己纠正
let modifierFlagMasks: [Int: UInt64] = [
    0x3B: 0x1, 0x38: 0x2, 0x3C: 0x4, 0x37: 0x8, 0x36: 0x10, 0x3A: 0x20, 0x3D: 0x40, 0x3E: 0x2000,
    fnKeyCode: CGEventFlags.maskSecondaryFn.rawValue,
]

/// 核对按住的键查的是硬件那份状态：我们的 tap 吞掉的键，合并后的那份（combinedSessionState）一直说没按着，
/// 硬件那份照实说按着（本机实测，合成按键四组一致）
let matcher = Matcher(stillDown: { CGEventSource.keyState(.hidSystemState, key: CGKeyCode($0)) })

private var listenTap: CFMachPort?
private var swallowTap: CFMachPort?
private var swallowOn = false
private var triggerTap: CFMachPort?
private var triggerSource: CFRunLoopSource?
/// "修饰键 + 普通键"绑定用到的修饰键：按着其中一个时吞键 tap 要开着，后面的普通键才吞得住
private var triggerModifiers: Set<Int> = []
private let carbon = CarbonKeys()

// MARK: - 喂匹配器

/// 一个事件在匹配器眼里的身份。只听 tap 的回调可能晚好几个事件才到，所以记一小串，不只是上一个
private struct EventKey: Equatable {
    let timestamp: UInt64
    let type: UInt32
    let code: Int64
    let flags: UInt64
}

private var recentEvents: [EventKey] = []

private func seenBefore(_ key: EventKey) -> Bool {
    if recentEvents.contains(key) { return true }
    recentEvents.append(key)
    if recentEvents.count > 64 { recentEvents.removeFirst() }
    return false
}

/// 一个键盘事件交给匹配器，报它说的事件，按需开关吞键 tap。返回吞不吞
private func feed(_ type: CGEventType, _ event: CGEvent) -> Bool {
    if event.getIntegerValueField(.eventSourceUserData) == ourEventTag { return false }
    let code = Int(event.getIntegerValueField(.keyboardEventKeycode))
    let identity = EventKey(timestamp: event.timestamp, type: type.rawValue, code: Int64(code), flags: event.flags.rawValue)
    if seenBefore(identity) { return false }
    // CGEvent 的时间戳是开机以来的纳秒（和 CLOCK_UPTIME_RAW 同一个钟，实验记录里对过）
    let time = event.timestamp / 1_000_000
    var outcome = Outcome()
    if type == .flagsChanged {
        // CapsLock 之类也走 flagsChanged，但它们不是修饰键
        guard let mask = modifierFlagMasks[code] else { return false }
        let flags = event.flags.rawValue
        outcome.events = releaseLostModifiers(flags: flags, except: code)
        outcome.events += matcher.onKey(code, down: flags & mask != 0, timeMs: time).events
    } else {
        outcome = matcher.onKey(code, down: type == .keyDown, timeMs: time)
    }
    for event in outcome.events { emit(event.json) }
    settleSwallowTap()
    // 修饰键一律不吞（匹配器也不会说吞）
    return outcome.swallow
}

/// 匹配器记着按住、标志位却说已经松开的修饰键：它的松开丢了（比如 tap 被停用过），补报一个。
/// fn 不在其中：方向键、F 键的事件本身就带 fn 位，拿标志位判断 fn 不可靠，只认键码 63 自己的 flagsChanged
private func releaseLostModifiers(flags: UInt64, except code: Int) -> [HotkeyEvent] {
    var events: [HotkeyEvent] = []
    for other in modifierFlagMasks.keys.sorted() where other != code && other != fnKeyCode {
        if flags & modifierFlagMasks[other]! == 0 && matcher.isHeld(other) {
            events += matcher.onKey(other, down: false, timeMs: 0).events
        }
    }
    return events
}

/// 监听停过又打开：这段时间的松开多半丢了。按着的绑定补报松开，按住的普通键清掉，修饰键按系统现在的标志位核对
private func resetMatcher() {
    var events = matcher.reset()
    events += releaseLostModifiers(flags: CGEventSource.flagsState(.combinedSessionState).rawValue, except: -1)
    for event in events { emit(event.json) }
    settleSwallowTap()
}

// MARK: - 吞键 tap 开关

/// 吞键 tap 现在该不该开着。手还没松开的那一下要吞完整：按下吞了、松开却放出去的话，前台应用会收到没头没尾的半个事件。
/// Carbon 管的键由系统自己吞，不用开着
private var swallowWanted: Bool {
    capturing || pressedRegion != nil || !matcher.pendingSwallow.subtracting(carbon.keys).isEmpty
        || triggerModifiers.contains(where: matcher.isHeld)
}

private func settleSwallowTap() {
    guard let tap = swallowTap else { return }
    let wanted = swallowWanted
    guard wanted != swallowOn else { return }
    swallowOn = wanted
    CGEvent.tapEnable(tap: tap, enable: wanted)
}

// MARK: - 三个 tap 的回调

private let keyEvents: [CGEventType] = [.flagsChanged, .keyDown, .keyUp]

private let onListenEvent: CGEventTapCallBack = { _, type, event, _ in
    switch type {
    case .tapDisabledByTimeout, .tapDisabledByUserInput:
        // 只听的 tap 也可能被停（切换安全输入时），要自己重新打开；停着的这段时间的事件都没看到
        if let tap = listenTap { CGEvent.tapEnable(tap: tap, enable: true) }
        resetMatcher()
    case .flagsChanged, .keyDown, .keyUp:
        _ = feed(type, event)
    default:
        break
    }
    return Unmanaged.passUnretained(event)
}

private let onSwallowEvent: CGEventTapCallBack = { _, type, event, _ in
    let pass = Unmanaged.passUnretained(event)
    switch type {
    case .tapDisabledByTimeout, .tapDisabledByUserInput:
        // 它被停掉了：可能是系统嫌回调慢，也可能就是我们自己关的（自己关也会收到这个通知）。
        // 该开着就重新打开；不该开的不能碰——在这里再关一次会再收到一次通知，没完没了地转（实测转起来过）。
        // 停着的这段时间事件照样经过只听 tap，匹配器没有漏看，只是没吞住
        swallowOn = false
        settleSwallowTap()
        return pass
    case .flagsChanged, .keyDown, .keyUp:
        return feed(type, event) ? nil : pass
    case .leftMouseDown:
        guard capturing, let region = regionAt(event.location) else { return pass }
        pressedRegion = region
        return nil
    case .leftMouseDragged:
        return pressedRegion == nil ? pass : nil
    case .leftMouseUp:
        guard let pressed = pressedRegion else { return pass }
        pressedRegion = nil
        // 和普通按钮一样，按下和松开在同一块里才算点了它：按下之后拖出去再松手是反悔
        if capturing && regionAt(event.location) == pressed {
            emit(["event": "click", "id": pressed])
        }
        settleSwallowTap()
        return nil
    default:
        return pass
    }
}

private let onTriggerEvent: CGEventTapCallBack = { _, type, event, _ in
    switch type {
    case .tapDisabledByTimeout, .tapDisabledByUserInput:
        // 它从来不被我们自己关（不要了就整个作废），收到这个通知只会是系统停的
        if let tap = triggerTap { CGEvent.tapEnable(tap: tap, enable: true) }
    case .flagsChanged:
        _ = feed(type, event)
    default:
        break
    }
    return Unmanaged.passUnretained(event)
}

private func makeTap(_ options: CGEventTapOptions, _ types: [CGEventType], _ callback: CGEventTapCallBack,
                     enabled: Bool) -> (CFMachPort, CFRunLoopSource)? {
    let mask = types.reduce(CGEventMask(0)) { $0 | CGEventMask(1 << $1.rawValue) }
    guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: options,
                                      eventsOfInterest: mask, callback: callback, userInfo: nil) else { return nil }
    let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)!
    CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
    CGEvent.tapEnable(tap: tap, enable: enabled)
    return (tap, source)
}

/// 只听的 tap：要输入监控权限。事件原样放行，系统和别的应用照常收到
func startListenTap() -> Bool {
    listenTap = makeTap(.listenOnly, keyEvents, onListenEvent, enabled: true)?.0
    return listenTap != nil
}

/// 吞键的 tap：要辅助功能权限。要在只听的之后建，排在它前面
func startSwallowTap() -> Bool {
    swallowTap = makeTap(.defaultTap, keyEvents + [.leftMouseDown, .leftMouseUp, .leftMouseDragged], onSwallowEvent,
                         enabled: false)?.0
    return swallowTap != nil
}

/// 有"修饰键 + 普通键"的绑定时建触发 tap，没有了就作废。它在吞键 tap 之后建，排在最前。建不起来是 false
private func settleTriggerTap(_ modifiers: Set<Int>) -> Bool {
    if modifiers.isEmpty, let tap = triggerTap {
        triggerTap = nil
        CFRunLoopRemoveSource(CFRunLoopGetMain(), triggerSource, .commonModes)
        triggerSource = nil
        CFMachPortInvalidate(tap)
    } else if !modifiers.isEmpty && triggerTap == nil {
        guard let made = makeTap(.defaultTap, [.flagsChanged], onTriggerEvent, enabled: true) else { return false }
        (triggerTap, triggerSource) = made
    }
    triggerModifiers = modifiers
    return true
}

// MARK: - 绑定表

/// bind：整表替换。装不上的照实退回（bound 回执），不装上而让普通键漏出去会往用户的输入框里打字
func applyBindings(_ value: Any?) {
    guard let parsed = parseBindings(value) else {
        emit(["event": "error", "message": "bind 需要 bindings：一组 { id, mods, key?, when }"])
        return
    }
    var rejected = parsed.rejected
    var candidates: [Binding] = []
    for binding in parsed.bindings {
        if listenTap == nil {
            rejected.append(Rejected(id: binding.id, reason: "needs_listen"))
        } else if binding.key != nil && !isCarbonKey(binding) && swallowTap == nil {
            rejected.append(Rejected(id: binding.id, reason: "needs_trusted"))
        } else {
            candidates.append(binding)
        }
    }

    let failed = carbon.replace(with: Set(candidates.filter(isCarbonKey).compactMap(\.key)))
    for (key, status) in failed.sorted(by: { $0.key < $1.key }) {
        emit(["event": "error", "message": "单个键注册不上（kVK \(key)，OSStatus \(status)），这个键吞不住"])
    }
    candidates.removeAll { binding in
        guard isCarbonKey(binding), let key = binding.key, failed[key] != nil else { return false }
        rejected.append(Rejected(id: binding.id, reason: "register_failed"))
        return true
    }

    let chorded = candidates.filter { !$0.capturing && $0.key != nil && !$0.mods.isEmpty }
    if !settleTriggerTap(Set(chorded.flatMap(\.mods))) {
        _ = settleTriggerTap([])
        let ids = Set(chorded.map(\.id))
        rejected += chorded.map { Rejected(id: $0.id, reason: "needs_trusted") }
        candidates.removeAll { ids.contains($0.id) }
    }

    for event in matcher.bind(candidates) { emit(event.json) }
    settleSwallowTap()
    emit(["event": "bound", "rejected": rejected.map(\.json)])
}

/// 单个普通键（只能是 F 键这类，打字的键单独不让绑）：交给 Carbon 吞
private func isCarbonKey(_ binding: Binding) -> Bool {
    !binding.capturing && binding.mods.isEmpty && binding.key != nil
}

// MARK: - 截住取消键和悬浮条上的点击
//
// 听写进行中，悬浮条上有"取消"和"完成"两个按钮，按取消的键（默认 esc）也能取消。这两样都不能让别的应用收到：
// 点击要是落到悬浮条的窗口上，我们的应用会被切到最前面，用户正在写的那个输入框就丢了焦点，文字贴不进去；
// esc 要是也传给前台应用，取消听写的同时会顺手关掉它的对话框、打断它正在做的事。
// 取消的键是一个"只在说话时生效"的绑定，由匹配器认；点击在吞键 tap 里认。

struct Region {
    let id: String
    let rect: CGRect
}

private var capturing = false
private var regions: [Region] = []
/// 按下已经被吞掉、还在等松开的那一块
private var pressedRegion: String?
/// 一次录音最长 9 分钟。过了这么久父进程还没说"不截了"，多半是它那边出了岔子：自己松开，
/// 不能让 esc 在所有应用里一直按不出来
private let captureLimit: TimeInterval = 600
private var captureDeadline: DispatchWorkItem?

func setCapturing(_ on: Bool, regions newRegions: [Region] = []) {
    captureDeadline?.cancel()
    captureDeadline = nil
    capturing = on
    regions = newRegions
    matcher.setCapturing(on)
    settleSwallowTap()
    guard on else { return }
    let deadline = DispatchWorkItem {
        emit(["event": "error", "message": "截了 \(Int(captureLimit)) 秒还没人说不截了，自己松开"])
        setCapturing(false)
    }
    captureDeadline = deadline
    DispatchQueue.main.asyncAfter(deadline: .now() + captureLimit, execute: deadline)
}

private func regionAt(_ point: CGPoint) -> String? {
    regions.first { $0.rect.contains(point) }?.id
}

func parseRegions(_ value: Any?) -> [Region]? {
    guard let list = value as? [[String: Any]] else { return nil }
    var parsed: [Region] = []
    for item in list {
        guard let id = item["id"] as? String,
              let x = item["x"] as? Double, let y = item["y"] as? Double,
              let width = item["width"] as? Double, let height = item["height"] as? Double,
              width > 0, height > 0 else { return nil }
        parsed.append(Region(id: id, rect: CGRect(x: x, y: y, width: width, height: height)))
    }
    return parsed
}

// MARK: - Carbon

/// 单个 F 键交给 Carbon 注册（RegisterEventHotKey，修饰键传 0）：系统在 session 层所有 tap 之后匹配它、自己吞掉，
/// 所以只听 tap 照样先看到按下松开（V19 实测）。不装回调：只用它来吞。要 NSApplication 跑着（main.swift 的入口），
/// 只跑 RunLoop 时键照样被系统接走，回调却永远不来（V19）。MacBook 上按 fn+F5 时还触不触发，未验证（V21）
final class CarbonKeys {
    private var refs: [Int: EventHotKeyRef] = [:]

    var keys: Set<Int> { Set(refs.keys) }

    /// 换成这几个键。返回注册不上的键和原因
    func replace(with wanted: Set<Int>) -> [Int: OSStatus] {
        for (key, ref) in refs where !wanted.contains(key) {
            UnregisterEventHotKey(ref)
            refs.removeValue(forKey: key)
        }
        var failed: [Int: OSStatus] = [:]
        for key in wanted where refs[key] == nil {
            var ref: EventHotKeyRef?
            let id = EventHotKeyID(signature: 0x534D_4B48, id: UInt32(key))
            let status = RegisterEventHotKey(UInt32(key), 0, id, GetEventDispatcherTarget(), 0, &ref)
            if status == noErr, let ref { refs[key] = ref } else { failed[key] = status }
        }
        return failed
    }
}
