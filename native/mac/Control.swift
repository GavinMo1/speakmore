// 父进程的 bind、capture、release 命令，和三样要盯着的系统状态（docs/hotkey-research.md 4.1）——
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

/// capture、release：开始截取消键和悬浮条上的点击，或者不截了
func capture(_ on: Bool, regions: [Region] = []) {
    captureDeadline?.cancel()
    captureDeadline = nil
    capturingNow = on
    setCapturing(on, regions: regions)
    refreshShadows()
    guard on else { return }
    let deadline = DispatchWorkItem {
        emit(["event": "error", "message": "截了 \(Int(captureLimit)) 秒还没人说不截了，自己松开"])
        capture(false)
    }
    captureDeadline = deadline
    DispatchQueue.main.asyncAfter(deadline: .now() + captureLimit, execute: deadline)
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
    checkSecureInput()
}
