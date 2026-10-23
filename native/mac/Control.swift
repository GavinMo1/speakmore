// 父进程的 bind、capture、release、record、probe、info 命令，和三样要盯着的系统状态（docs/hotkey-research.md 4.1）——
//   权限    辅助功能、输入监控在运行中被收回或给了：没了就立刻作废对应的 tap，给了就重新建，再报一次 permissions
//   锁屏    锁屏、切到别的用户时不认热键，回来以后从头认
//   安全输入 密码框、终端的安全键盘输入开着时 tap 收不到按下松开：带普通键的绑定由 Carbon 顶着，顶不了的报 secure_input
// 全在主线程上，和 tap 的回调、Carbon 的回调同一条线程，不用加锁。

import AppKit
import Carbon.HIToolbox

/// 父进程最近一次下发的绑定表（解析过的）：权限变了要按它重装一遍
private var lastBindings: (bindings: [Binding], rejected: [Rejected])?
/// 最后装上的那些
private var installedBindings: [Binding] = []
private var capturingNow = false
/// 截了多久还没人说不截了：一次录音最长 9 分钟，过了这么久多半是父进程那边出了岔子，自己松开，
/// 不能让取消键在所有应用里一直按不出来
private let captureLimit: TimeInterval = 600
private var captureDeadline: DispatchWorkItem?

// MARK: - 命令

/// bind：整表替换。装不上的照实退回（bound 回执），不装上而让普通键漏出去会往用户的输入框里打字
func applyBindings(_ value: Any?) {
    guard let parsed = parseBindings(value) else {
        emit(["event": "error", "message": "bind 需要 bindings：一组 { id, mods, key?, when }"])
        return
    }
    lastBindings = parsed
    install(parsed)
}

private func install(_ parsed: (bindings: [Binding], rejected: [Rejected])) {
    let ready = tapsReady
    var rejected = parsed.rejected
    var candidates: [Binding] = []
    for binding in parsed.bindings {
        if !ready.listen {
            rejected.append(Rejected(id: binding.id, reason: "needs_listen"))
        } else if binding.key != nil && !isSingleKey(binding) && !ready.swallow {
            rejected.append(Rejected(id: binding.id, reason: "needs_trusted"))
        } else {
            candidates.append(binding)
        }
    }

    let failed = hotKeys.replaceSingles(with: Set(candidates.filter(isSingleKey).compactMap(\.key)))
    for (key, status) in failed.sorted(by: { $0.key < $1.key }) {
        emit(["event": "error", "message": "单个键注册不上（kVK \(key)，OSStatus \(status)），这个键吞不住"])
    }
    candidates.removeAll { binding in
        guard isSingleKey(binding), let key = binding.key, failed[key] != nil else { return false }
        rejected.append(Rejected(id: binding.id, reason: "register_failed"))
        return true
    }

    installedBindings = installBindings(candidates, rejected: rejected, carbonKeys: hotKeys.singleKeys)
    refreshShadows()
}

/// 单个普通键（只能是 F 键这类，打字的键单独不让绑）：交给 Carbon 吞
private func isSingleKey(_ binding: Binding) -> Bool {
    !binding.capturing && binding.mods.isEmpty && binding.key != nil
}

/// capture、release：开始截取消键和悬浮条（或划词卡片）上的点击，或者不截了。outside：块外的按下也报（不吞）
func capture(_ on: Bool, regions: [Region] = [], outside: Bool = false) {
    captureDeadline?.cancel()
    captureDeadline = nil
    capturingNow = on
    setCapturing(on, regions: regions, outside: outside)
    refreshShadows()
    guard on else { return }
    let deadline = DispatchWorkItem {
        emit(["event": "error", "message": "截了 \(Int(captureLimit)) 秒还没人说不截了，自己松开"])
        capture(false)
    }
    captureDeadline = deadline
    DispatchQueue.main.asyncAfter(deadline: .now() + captureLimit, execute: deadline)
}

// MARK: - 录键

/// 录了多久还没人说停：多半是父进程那边出了岔子，自己停，不能让匹配器一直停着、录到的键一直被吞着
private let recordLimit: TimeInterval = 30
private var recordDeadline: DispatchWorkItem?

/// record：进入录键模式（已经在录就重新开始、重新计时），或者离开
func record(_ on: Bool) {
    recordDeadline?.cancel()
    recordDeadline = nil
    setRecording(on)
    guard on else { return }
    let deadline = DispatchWorkItem {
        emit(["event": "error", "message": "录了 \(Int(recordLimit)) 秒还没录完，自己停了"])
        record(false)
    }
    recordDeadline = deadline
    DispatchQueue.main.asyncAfter(deadline: .now() + recordLimit, execute: deadline)
}

// MARK: - probe、info

/// probe：查一个组合是不是已经被系统快捷键占了（Probe.swift 判断，这里只读系统表）
func probe(_ object: [String: Any]) {
    for event in answerProbe(object, symbolic: copySymbolicHotKeys) { emit(event) }
}

/// 系统设置里定义的全局快捷键。头文件说这个接口不是线程安全的：只在主线程上调
private func copySymbolicHotKeys() -> Result<[SymbolicHotKey], SymbolicFailure> {
    var array: Unmanaged<CFArray>?
    let status = CopySymbolicHotKeys(&array)
    guard status == noErr else { return .failure(SymbolicFailure(status: status)) }
    // 调用方负责释放（头文件原话 "The array must be released by the caller"），所以是 retained
    let items = array?.takeRetainedValue() as? [[String: Any]] ?? []
    return .success(items.compactMap { item in
        guard let code = item[kHISymbolicHotKeyCode] as? Int,
              let modifiers = item[kHISymbolicHotKeyModifiers] as? Int else { return nil }
        return SymbolicHotKey(code: code, modifiers: modifiers, enabled: item[kHISymbolicHotKeyEnabled] as? Bool ?? false)
    })
}

/// info：地球仪键的用途（AppleFnUsageType），和系统设置读的是同一份
func info() {
    let value = CFPreferencesCopyAppValue("AppleFnUsageType" as CFString, "com.apple.HIToolbox" as CFString)
    emit(infoEvent(fnUsage: value))
}

// MARK: - 安全输入

private var secureOn = false
/// 最近一次报给父进程的顶不了的绑定
private var reportedUnavailable: [String] = []

/// 安全输入开着时，按现在装着的绑定重新注册 Carbon 顶着的那一份；关着时全注销。
/// 开着时报 secure_input：刚开的时候（announce）一定报，之后顶不了的有变化才报
private func refreshShadows(announce: Bool = false) {
    let keyed = installedBindings.filter { binding in
        binding.key != nil && (binding.capturing ? capturingNow : !binding.mods.isEmpty)
    }
    let unavailable = hotKeys.replaceShadows(with: secureOn ? keyed : [])
    guard secureOn, announce || unavailable != reportedUnavailable else { return }
    reportedUnavailable = unavailable
    emit(["event": "secure_input", "on": true, "unavailable": unavailable])
}

private func checkSecureInput() {
    let on = IsSecureEventInputEnabled()
    guard on != secureOn else { return }
    secureOn = on
    setSecureInput(on)
    reportedUnavailable = []
    if on {
        refreshShadows(announce: true)
    } else {
        _ = hotKeys.replaceShadows(with: [])
        emit(["event": "secure_input", "on": false, "unavailable": []])
    }
}

// MARK: - 权限

private var listenNow = false
private var trustedNow = false

private func checkPermissions() {
    let listen = CGPreflightListenEventAccess()
    let trusted = AXIsProcessTrusted()
    guard listen != listenNow || trusted != trustedNow else { return }
    listenNow = listen
    trustedNow = trusted
    let capture = refreshTaps(listen: listen, trusted: trusted)
    emit(["event": "permissions", "listen": listen, "trusted": trusted, "capture": capture])
    if let parsed = lastBindings { install(parsed) }
}

// MARK: - 锁屏、切换用户

private var screenLocked = false
private var sessionInactive = false

private func settleSuspended() {
    setSuspended(screenLocked || sessionInactive)
}

/// 起来时屏幕已经锁着、会话已经不在前台（锁屏期间被拉起，比如远程登录上去重查权限）：通知只报变化，起来时得自己查一次，
/// 不然锁屏界面上单按修饰键照样能起听写。CGSSessionScreenIsLocked 不是公开的键（VoiceInk 也这么查），解锁时没有这一项；
/// 写法同 scripts/dev/mac-hotkeys-poster.swift 的 screenUnavailable
private func readSessionState() {
    let session = CGSessionCopyCurrentDictionary() as? [String: Any] ?? [:]
    screenLocked = session["CGSSessionScreenIsLocked"] as? Bool == true
    sessionInactive = session[kCGSessionOnConsoleKey] as? Bool == false
}

// MARK: - 开始盯着

/// 启动时调一次。listen、trusted 是启动时查到的两项权限，之后有变化才报
func startWatching(listen: Bool, trusted: Bool) {
    listenNow = listen
    trustedNow = trusted
    // 每秒查一次权限和安全输入（Handy 也是每秒查安全输入）。辅助功能另有分布式通知，来了当场查，
    // 通知比 AXIsProcessTrusted 的结果先到的时候，隔一会儿再查一次
    Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
        checkPermissions()
        checkSecureInput()
    }
    let distributed = DistributedNotificationCenter.default()
    distributed.addObserver(forName: Notification.Name("com.apple.accessibility.api"), object: nil, queue: .main) { _ in
        checkPermissions()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { checkPermissions() }
    }
    distributed.addObserver(forName: Notification.Name("com.apple.screenIsLocked"), object: nil, queue: .main) { _ in
        screenLocked = true
        settleSuspended()
    }
    distributed.addObserver(forName: Notification.Name("com.apple.screenIsUnlocked"), object: nil, queue: .main) { _ in
        screenLocked = false
        settleSuspended()
    }
    let workspace = NSWorkspace.shared.notificationCenter
    workspace.addObserver(forName: NSWorkspace.sessionDidResignActiveNotification, object: nil, queue: .main) { _ in
        sessionInactive = true
        settleSuspended()
    }
    workspace.addObserver(forName: NSWorkspace.sessionDidBecomeActiveNotification, object: nil, queue: .main) { _ in
        sessionInactive = false
        settleSuspended()
    }
    // 订好通知再查初值：查完以后的变化一定有通知跟上
    readSessionState()
    settleSuspended()
    checkSecureInput()
}
