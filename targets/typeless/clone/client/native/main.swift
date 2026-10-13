// 仿刻客户端的原生小帮手：听 fn 键、把文字贴进当前输入框。
// 这两件事 Electron 自己做不了，原版也是交给 Swift 写的库和子进程（docs/07-native-helpers.md）。
//
// 和父进程用"一行一个 JSON"通信：
//   标准输出  {"event":"ready","listen":true,"trusted":true}   启动完成，附两项权限的状态
//             {"event":"fn","down":true}                        fn 按下 / 松开
//             {"event":"other_key"}                             fn 按住时又按了别的键（是组合键，不是听写）
//             {"event":"pasted","id":1,"ok":true}               贴完了；ok 为 false 时文字留在剪贴板里
//   标准输入  {"cmd":"paste","id":1,"text":"…"}
// 父进程退出（标准输入关闭）时自己也退出。
//
// 按键内容不出这个进程：除了 fn 的按下松开，只报"有别的键"，不报是哪个键。

import AppKit
import ApplicationServices

let fnKeyCode: Int64 = 63
let vKeyCode: CGKeyCode = 9
/// 剪贴板管理工具之间的约定：带这个类型的内容是临时的，不要记进历史
let transientType = NSPasteboard.PasteboardType("org.nspasteboard.TransientType")
/// 模拟粘贴之后等多久再恢复剪贴板。原版的值没有读到；太短的话目标应用还没来得及读
let restoreDelay: TimeInterval = 0.3

func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object),
          let line = String(data: data, encoding: .utf8) else {
        FileHandle.standardError.write("emit: 序列化失败 \(object)\n".data(using: .utf8)!)
        return
    }
    print(line)
    fflush(stdout)
}

// MARK: - 剪贴板

typealias PasteboardSnapshot = [[(NSPasteboard.PasteboardType, Data)]]

/// 存下剪贴板里每一项的每一种格式，这样图片、文件、富文本都能原样还回去
func snapshotPasteboard(_ pasteboard: NSPasteboard) -> PasteboardSnapshot {
    (pasteboard.pasteboardItems ?? []).map { item in
        item.types.compactMap { type in item.data(forType: type).map { (type, $0) } }
    }
}

func restorePasteboard(_ pasteboard: NSPasteboard, from snapshot: PasteboardSnapshot) {
    pasteboard.clearContents()
    let items = snapshot.map { entries -> NSPasteboardItem in
        let item = NSPasteboardItem()
        for (type, data) in entries { item.setData(data, forType: type) }
        return item
    }
    if !items.isEmpty { pasteboard.writeObjects(items) }
}

func writeTransientText(_ pasteboard: NSPasteboard, _ text: String) {
    pasteboard.clearContents()
    let item = NSPasteboardItem()
    item.setString(text, forType: .string)
    item.setData(Data(), forType: transientType)
    pasteboard.writeObjects([item])
}

// MARK: - 贴字

func postCommandV() {
    let source = CGEventSource(stateID: .combinedSessionState)
    for keyDown in [true, false] {
        let event = CGEvent(keyboardEventSource: source, virtualKey: vKeyCode, keyDown: keyDown)
        event?.flags = .maskCommand
        event?.post(tap: .cghidEventTap)
    }
}

/// 存剪贴板 → 写入文字 → 模拟 ⌘V → 恢复剪贴板。只有粘贴这一条路，和原版一样。
func paste(id: Int, text: String) {
    let pasteboard = NSPasteboard.general
    guard AXIsProcessTrusted() else {
        // 没有辅助功能权限时模拟按键不会生效。把文字留在剪贴板里，让用户自己按 ⌘V
        pasteboard.clearContents()
        pasteboard.setString(text, forType: .string)
        emit(["event": "pasted", "id": id, "ok": false, "reason": "not_trusted"])
        return
    }
    let saved = snapshotPasteboard(pasteboard)
    writeTransientText(pasteboard, text)
    postCommandV()
    DispatchQueue.main.asyncAfter(deadline: .now() + restoreDelay) {
        restorePasteboard(pasteboard, from: saved)
        emit(["event": "pasted", "id": id, "ok": true])
    }
}

// MARK: - 按键监听

var fnIsDown = false
var reportedOtherKey = false
var eventTap: CFMachPort?

let onKeyEvent: CGEventTapCallBack = { _, type, event, _ in
    switch type {
    case .tapDisabledByTimeout, .tapDisabledByUserInput:
        // 系统会在回调太慢或用户切换安全输入时停掉监听，要自己重新打开
        if let tap = eventTap { CGEvent.tapEnable(tap: tap, enable: true) }
    case .flagsChanged:
        // 方向键等也会带上 fn 标志位，所以只认 fn 键自己的键码
        guard event.getIntegerValueField(.keyboardEventKeycode) == fnKeyCode else { break }
        let down = event.flags.contains(.maskSecondaryFn)
        if down != fnIsDown {
            fnIsDown = down
            reportedOtherKey = false
            emit(["event": "fn", "down": down])
        }
    case .keyDown:
        if fnIsDown && !reportedOtherKey {
            reportedOtherKey = true
            emit(["event": "other_key"])
        }
    default:
        break
    }
    return Unmanaged.passUnretained(event)
}

func startKeyListener() -> Bool {
    let mask = CGEventMask(1 << CGEventType.flagsChanged.rawValue | 1 << CGEventType.keyDown.rawValue)
    // 只听不改：事件原样放行，系统和别的应用照常收到
    guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap,
                                      options: .listenOnly, eventsOfInterest: mask,
                                      callback: onKeyEvent, userInfo: nil) else { return false }
    eventTap = tap
    let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
    CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
    CGEvent.tapEnable(tap: tap, enable: true)
    return true
}

// MARK: - 自检（不发按键，只验证剪贴板存取能原样还原）

func selfTest() -> Bool {
    let pasteboard = NSPasteboard.general
    let before = snapshotPasteboard(pasteboard)
    writeTransientText(pasteboard, "typeless-clone 自检")
    let wroteText = pasteboard.string(forType: .string) == "typeless-clone 自检"
    let markedTransient = pasteboard.types?.contains(transientType) ?? false
    restorePasteboard(pasteboard, from: before)
    let after = snapshotPasteboard(pasteboard)
    let restored = before.count == after.count && zip(before, after).allSatisfy { old, new in
        old.count == new.count && zip(old, new).allSatisfy { $0.0 == $1.0 && $0.1 == $1.1 }
    }
    emit(["event": "selftest", "wrote_text": wroteText, "marked_transient": markedTransient,
          "restored": restored, "items": before.count])
    return wroteText && markedTransient && restored
}

// MARK: - 入口

let arguments = CommandLine.arguments.dropFirst()
if arguments.contains("--check") {
    emit(["event": "check", "listen": CGPreflightListenEventAccess(), "trusted": AXIsProcessTrusted()])
    exit(0)
}
if arguments.contains("--selftest") {
    exit(selfTest() ? 0 : 1)
}

// 第一次运行时让系统弹出授权提示，并把应用加进"输入监控"和"辅助功能"的列表里
let listenAllowed = CGPreflightListenEventAccess() || CGRequestListenEventAccess()
let trusted = AXIsProcessTrustedWithOptions(["AXTrustedCheckOptionPrompt": true] as CFDictionary)
let listening = listenAllowed && startKeyListener()
emit(["event": "ready", "listen": listening, "trusted": trusted])

Thread.detachNewThread {
    while let line = readLine() {
        guard let data = line.data(using: .utf8),
              let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let command = object["cmd"] as? String else {
            emit(["event": "error", "message": "看不懂的命令行"])
            continue
        }
        switch command {
        case "paste":
            guard let id = object["id"] as? Int, let text = object["text"] as? String else {
                emit(["event": "error", "message": "paste 需要 id 和 text"])
                continue
            }
            DispatchQueue.main.async { paste(id: id, text: text) }
        default:
            emit(["event": "error", "message": "不认识的命令：\(command)"])
        }
    }
    exit(0)
}

RunLoop.main.run()
