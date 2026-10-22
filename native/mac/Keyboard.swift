// 键盘和悬浮条上的点击：三个 tap 加 Carbon，共用一个匹配器（docs/hotkey-research.md 4.1"tap 的布置""三个 tap 怎么分工"）。
//   只听 tap  常开，收 flagsChanged、keyDown、keyUp，要输入监控权限。平时匹配器靠它喂。
//   吞键 tap  能改事件，平时关着。截着（说话时）、录键时、有吞了按下还没吞松开的键、"修饰键 + 普通键"绑定的修饰键按着时才开，
//             要辅助功能权限。开着时事件先到它这里，当场匹配、当场决定吞不吞。悬浮条上的点击也由它截。
//   触发 tap  能改事件但一律放行，只收 flagsChanged；有"修饰键 + 普通键"的绑定时才建，建了就一直开着。
//             它的回调是同步的，系统等它返回才往下送：修饰键按下时在这里把吞键 tap 打开，紧跟着的普通键一定先到吞键 tap。
//             只听 tap 的回调是事后送的，等它来开就漏了：V1 实测人按得出 0.4 ms 的间隔。
//   Carbon    单个 F 键交给系统自己吞（HotKeys.swift）。按下松开平时仍以 tap 看到的为准；安全输入开着时 tap 收不到按下松开，
//             改由 Carbon 报过来（carbonFired）。
// 后建的 tap 排在前面：只听、吞键、触发依次建，同一个事件依次经过触发、吞键、只听。前面放行的，后面还会再收到一次，
// 按"时间戳 + 类型 + 键码 + 标志位"认出来跳过（V8 验过同一个事件经过几个 tap 时间戳不变）；前面吞掉的，后面收不到，也不需要。
// 都在主线程上：tap 的回调、匹配器、截取的状态，和命令、Carbon（Control.swift、HotKeys.swift）一起。
// 没有挪到独立线程：实测独立线程上从触发 tap 的回调里打开吞键 tap 生效得晚，右 Option+空格快速连发 200 次漏了 57 个空格，
// 同样的代码在主线程上 0 漏（docs/hotkey-research.md 4.1"线程"）。

import AppKit

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
/// 录键（Recorder.swift）：录着的时候，和它还在吞松开的键，事件交给它，不交给匹配器
let recorder = Recorder()

/// 一个 tap 和它挂在 run loop 上的源：作废时两样都要拿下来
private struct Tap {
    let port: CFMachPort
    let source: CFRunLoopSource

    func invalidate() {
        CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes)
        CFMachPortInvalidate(port)
    }
}

private var listenTap: Tap?
private var swallowTap: Tap?
private var swallowOn = false
private var triggerTap: Tap?
/// "修饰键 + 普通键"绑定用到的修饰键：按着其中一个时吞键 tap 要开着，后面的普通键才吞得住
private var triggerModifiers: Set<Int> = []
/// Carbon 替我们吞的单个键：吞了一半的是这些键时，吞键 tap 不用为它开着
private var carbonKeys: Set<Int> = []
/// 锁屏、切到别的用户时不认热键（VoiceInk 的做法）：别人在登录界面上按的键不该触发我们
private var suspended = false
/// 安全输入开着：tap 收不到按下松开，Carbon 报过来的才算
private var secureInput = false

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
    if suspended || event.getIntegerValueField(.eventSourceUserData) == ourEventTag { return false }
    let code = Int(event.getIntegerValueField(.keyboardEventKeycode))
    let identity = EventKey(timestamp: event.timestamp, type: type.rawValue, code: Int64(code), flags: event.flags.rawValue)
    if seenBefore(identity) { return false }
    let flags = event.flags.rawValue
    let down: Bool
    if type == .flagsChanged {
        // CapsLock 之类也走 flagsChanged，但它们不是修饰键
        guard let mask = modifierFlagMasks[code] else { return false }
        down = flags & mask != 0
    } else {
        down = type == .keyDown
    }
    let autorepeat = event.getIntegerValueField(.keyboardEventAutorepeat) != 0
    if let recorded = recorder.onKey(code, down: down, autorepeat: autorepeat) {
        if recorded.changed { emit(recorder.json) }
        settleSwallowTap()
        return recorded.swallow
    }
    // CGEvent 的时间戳是开机以来的纳秒（和 CLOCK_UPTIME_RAW 同一个钟，实验记录里对过）
    let time = event.timestamp / 1_000_000
    var outcome = Outcome()
    if type == .flagsChanged {
        outcome.events = releaseLostModifiers(flags: flags, except: code)
        outcome.events += matcher.onKey(code, down: down, timeMs: time).events
    } else {
        outcome = matcher.onKey(code, down: down, timeMs: time)
    }
    for event in outcome.events { emit(event.json) }
    settleSwallowTap()
    // 修饰键一律不吞（匹配器也不会说吞）
    return outcome.swallow
}

/// 现在的时间，和 CGEvent 的时间戳同一个钟（开机以来，毫秒）
private func nowMs() -> UInt64 { clock_gettime_nsec_np(CLOCK_UPTIME_RAW) / 1_000_000 }

/// Carbon 报的按下松开（HotKeys.swift）。只在安全输入开着时算：平时这些键的按下松开只听 tap 都看得到，
/// 再算一次就重了；录键期间匹配器不喂，也不算。Carbon 分不了左右，不用另外核对：修饰键的 flagsChanged 安全输入下照常收得到，
/// 匹配器按它记着的左右去凑，凑不上就当没按（这一下已经被 Carbon 吞了，到不了前台应用）
func carbonFired(_ code: Int, down: Bool) {
    guard secureInput, !suspended, !recorder.on else { return }
    for event in matcher.onKey(code, down: down, timeMs: nowMs()).events { emit(event.json) }
    settleSwallowTap()
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
/// Carbon 管的键由系统自己吞，不用开着。录键吞的键不减 Carbon 管的：它的按下是我们的 tap 吞的，Carbon 没见过
private var swallowWanted: Bool {
    guard !suspended else { return false }
    return capturing || pressedRegion != nil || recorder.swallowWanted
        || !matcher.pendingSwallow.subtracting(carbonKeys).isEmpty || triggerModifiers.contains(where: matcher.isHeld)
}

private func settleSwallowTap() {
    guard let tap = swallowTap else { return }
    let wanted = swallowWanted
    guard wanted != swallowOn else { return }
    swallowOn = wanted
    CGEvent.tapEnable(tap: tap.port, enable: wanted)
}

// MARK: - 三个 tap 的回调

private let keyEvents: [CGEventType] = [.flagsChanged, .keyDown, .keyUp]

private let onListenEvent: CGEventTapCallBack = { _, type, event, _ in
    switch type {
    case .tapDisabledByTimeout, .tapDisabledByUserInput:
        // 只听的 tap 也可能被停（切换安全输入时），要自己重新打开；停着的这段时间的事件都没看到
        if let tap = listenTap { CGEvent.tapEnable(tap: tap.port, enable: true) }
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
        guard capturing else { return pass }
        guard let region = regionAt(event.location) else {
            // 划词卡片要"点别处收起"：块外按下报一次 outside，这一下照常放行
            if reportOutside { emit(["event": "click", "id": "outside"]) }
            return pass
        }
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
        if let tap = triggerTap { CGEvent.tapEnable(tap: tap.port, enable: true) }
    case .flagsChanged:
        _ = feed(type, event)
    default:
        break
    }
    return Unmanaged.passUnretained(event)
}

private func makeTap(_ options: CGEventTapOptions, _ types: [CGEventType], _ callback: CGEventTapCallBack,
                     enabled: Bool) -> Tap? {
    let mask = types.reduce(CGEventMask(0)) { $0 | CGEventMask(1 << $1.rawValue) }
    guard let port = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: options,
                                       eventsOfInterest: mask, callback: callback, userInfo: nil) else { return nil }
    let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, port, 0)!
    CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
    CGEvent.tapEnable(tap: port, enable: enabled)
    return Tap(port: port, source: source)
}

/// 只听的 tap：要输入监控权限。事件原样放行，系统和别的应用照常收到
func startListenTap() -> Bool {
    if listenTap == nil { listenTap = makeTap(.listenOnly, keyEvents, onListenEvent, enabled: true) }
    return listenTap != nil
}

/// 吞键的 tap：要辅助功能权限。要在只听的之后建，排在它前面
func startSwallowTap() -> Bool {
    if swallowTap == nil {
        swallowTap = makeTap(.defaultTap, keyEvents + [.leftMouseDown, .leftMouseUp, .leftMouseDragged], onSwallowEvent,
                             enabled: false)
        swallowOn = false
    }
    return swallowTap != nil
}

/// 有"修饰键 + 普通键"的绑定时建触发 tap，没有了就作废。它在吞键 tap 之后建，排在最前。建不起来是 false
private func settleTriggerTap(_ modifiers: Set<Int>) -> Bool {
    if modifiers.isEmpty, let tap = triggerTap {
        triggerTap = nil
        tap.invalidate()
    } else if !modifiers.isEmpty && triggerTap == nil {
        guard let made = makeTap(.defaultTap, [.flagsChanged], onTriggerEvent, enabled: true) else { return false }
        triggerTap = made
    }
    triggerModifiers = modifiers
    return true
}

/// 现在有没有只听的、能吞键的 tap（装绑定前看能装哪些）
var tapsReady: (listen: Bool, swallow: Bool) { (listenTap != nil, swallowTap != nil) }

// MARK: - 权限、锁屏、安全输入（Control.swift 盯着，变了调这里）

/// 权限变了：没了的那项立刻作废它的 tap。辅助功能没了还留着能改事件的 tap，有报告说整机键盘鼠标会冻住（V26），
/// 所以吞键、触发两个一起作废，退回只听。又给了就重新建。返回现在截不截得住取消键和点击
func refreshTaps(listen: Bool, trusted: Bool) -> Bool {
    // 三个 tap 一定按只听、吞键、触发的顺序建（后建的排在前面，V8）。运行中才给了输入监控时吞键 tap 已经在：
    // 只听 tap 这时才建就排到了它前面，事件先被只听 tap 记下，到吞键 tap 时认作重复、一律放行，什么都吞不住。
    // 所以先把吞键、触发两个作废，建完只听的再按顺序重建
    let reorder = trusted && listen && listenTap == nil && (swallowTap != nil || triggerTap != nil)
    let modifiers = triggerModifiers
    if !trusted || reorder {
        triggerTap?.invalidate()
        triggerTap = nil
        triggerModifiers = []
        swallowTap?.invalidate()
        swallowTap = nil
        swallowOn = false
    }
    // 只是重建的话按下的那一块留着：按下已经被旧的吞键 tap 吞掉，松开会到新建的这个，照样吞掉、照样认点了哪块
    if !trusted { pressedRegion = nil }
    if !listen {
        listenTap?.invalidate()
        listenTap = nil
    } else {
        _ = startListenTap()
    }
    if trusted {
        _ = startSwallowTap()
        if reorder { _ = settleTriggerTap(modifiers) }
    }
    // 作废的 tap 上可能还有按着的键：照没看到松开处理
    resetMatcher()
    return swallowTap != nil
}

/// 锁屏、切到别的用户（suspend 为 true）：按着的补报松开，之后不认热键、不吞键，回来以后再从头认
func setSuspended(_ suspend: Bool) {
    guard suspend != suspended else { return }
    resetMatcher()
    suspended = suspend
    settleSwallowTap()
}

/// 安全输入开了、关了。关掉时清掉按住的普通键：开着那段时间它们的松开 tap 收不到，多半丢了（5.3 第 8 条）
func setSecureInput(_ on: Bool) {
    guard on != secureInput else { return }
    secureInput = on
    if !on { resetMatcher() }
}

// MARK: - 录键（Control.swift 的 record 调，限时也在那边管）

/// 进入录键模式（已经在录就是重新开始），或者离开；没在录时说离开，什么也不报。
/// 两头各 reset 一次匹配器、报它给的事件：进入时按着的绑定补报松开；录键期间它没喂，离开时它记着的已经不准了。
/// 进入时匹配器吞了按下的键交给录键吞完松开（Carbon 管的除外，系统自己吞）
func setRecording(_ on: Bool) {
    if on {
        recorder.start(swallowing: matcher.pendingSwallow.subtracting(carbonKeys))
    } else if !recorder.stop() {
        return
    }
    resetMatcher()
    emit(recorder.json)
}

// MARK: - 绑定表

/// Control.swift 查过权限、注册好 Carbon 之后：建或作废触发 tap，换掉匹配器的绑定表，报 bound 回执。
/// 返回最后装上的那些（安全输入期间要由 Carbon 顶替的从里面挑）
func installBindings(_ candidates: [Binding], rejected: [Rejected], carbonKeys keys: Set<Int>) -> [Binding] {
    var installed = candidates
    var rejected = rejected
    carbonKeys = keys
    let chorded = installed.filter { !$0.capturing && $0.key != nil && !$0.mods.isEmpty }
    if !settleTriggerTap(Set(chorded.flatMap(\.mods))) {
        _ = settleTriggerTap([])
        let ids = Set(chorded.map(\.id))
        rejected += chorded.map { Rejected(id: $0.id, reason: "needs_trusted") }
        installed.removeAll { ids.contains($0.id) }
    }
    for event in matcher.bind(installed) { emit(event.json) }
    settleSwallowTap()
    emit(["event": "bound", "rejected": rejected.map(\.json)])
    return installed
}

// MARK: - 截住取消键和悬浮条上的点击
//
// 听写进行中，悬浮条上有"取消"和"完成"两个按钮，按取消的键（默认 esc）也能取消；划词卡片开着时，卡片上的按钮和 esc
// 也这样截（它还要块外的按下：点别处收起）。这两样都不能让别的应用收到：
// 点击要是落到悬浮条的窗口上，我们的应用会被切到最前面，用户正在写的那个输入框就丢了焦点，文字贴不进去；
// esc 要是也传给前台应用，取消听写的同时会顺手关掉它的对话框、打断它正在做的事。
// 取消的键是一个"只在说话时生效"的绑定，由匹配器认；点击在吞键 tap 里认。

struct Region {
    let id: String
    let rect: CGRect
}

private var capturing = false
private var regions: [Region] = []
/// 块外的按下要不要报（capture 的 outside）：划词卡片要，悬浮条不要
private var reportOutside = false
/// 按下已经被吞掉、还在等松开的那一块
private var pressedRegion: String?

/// 开始截或不截了（Control.swift 的 capture 调，限时也在那边管）
func setCapturing(_ on: Bool, regions newRegions: [Region] = [], outside: Bool = false) {
    capturing = on
    regions = newRegions
    reportOutside = on && outside
    matcher.setCapturing(on)
    settleSwallowTap()
}

private func regionAt(_ point: CGPoint) -> String? {
    regions.first { $0.rect.contains(point) }?.id
}

/// capture 的 outside：不写是 false，写了要是布尔值
func parseOutside(_ value: Any?) -> Bool? {
    guard let value else { return false }
    // JSONSerialization 把 true/false 读成 NSNumber：0、1 这样的数也会被 as? Bool 认成布尔，先认准是布尔类型
    guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { return nil }
    return number.boolValue
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
