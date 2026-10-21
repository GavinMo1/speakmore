// 仿刻客户端的原生小帮手：听热键、把文字贴进当前输入框。
// 这两件事 Electron 自己做不了，原版也是交给 Swift 写的库和子进程（docs/07-native-helpers.md）。
//
// 和父进程用"一行一个 JSON"通信：
//   标准输出  {"event":"ready","listen":true,"trusted":true,"capture":true}
//                                                               启动完成，附两项权限的状态；capture：截不截得住 esc 和点击
//             {"event":"hotkey","down":true}                    热键按下 / 松开
//             {"event":"other_key"}                             热键按住时又按了别的键（是组合键，不是听写）
//             {"event":"pasted","id":1,"ok":true}               贴完了；ok 为 false 时文字留在剪贴板里
//             {"event":"escape"}                                截着的时候按了 esc
//             {"event":"click","id":"cancel"}                   截着的时候点了某一块
//   标准输入  {"cmd":"paste","id":1,"text":"…"}
//             {"cmd":"capture","regions":[{"id":"cancel","x":0,"y":0,"width":28,"height":28}]}
//                                                               开始截：esc，和这几块（屏幕坐标）里的鼠标点击
//             {"cmd":"release"}                                 不截了
// 父进程退出（标准输入关闭）时自己也退出。
//
// 热键用 --key 指定，是单独一个修饰键：right_option（默认）、right_command、right_control、fn。
// 原版用 fn；仿刻要和原版同时开着用，所以默认换成右 Option。
// --no-prompt：缺权限时不让系统弹授权提示，只照实报。
//
// 按键内容不出这个进程：除了热键的按下松开，只报"有别的键"，不报是哪个键。
// 例外只有 esc，而且只在父进程说"开始截"之后、"不截了"之前：那段时间它是用来取消听写的。

import AppKit
import ApplicationServices

/// 一个修饰键：键码用来认"是不是这个键的事件"，标志位用来认"它现在是按下还是松开"。
/// 左右两个 Option 共用 maskAlternate，要用设备相关的标志位（IOLLEvent.h 里的 NX_DEVICER*KEYMASK）才分得开。
struct Hotkey {
    let keyCode: Int64
    let flagMask: UInt64
}

let hotkeys: [String: Hotkey] = [
    "right_option": Hotkey(keyCode: 61, flagMask: 0x40),
    "right_command": Hotkey(keyCode: 54, flagMask: 0x10),
    "right_control": Hotkey(keyCode: 62, flagMask: 0x2000),
    "fn": Hotkey(keyCode: 63, flagMask: CGEventFlags.maskSecondaryFn.rawValue),
]
var hotkey = hotkeys["right_option"]!
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

var hotkeyIsDown = false
var reportedOtherKey = false
var eventTap: CFMachPort?

let onKeyEvent: CGEventTapCallBack = { _, type, event, _ in
    switch type {
    case .tapDisabledByTimeout, .tapDisabledByUserInput:
        // 系统会在回调太慢或用户切换安全输入时停掉监听，要自己重新打开
        if let tap = eventTap { CGEvent.tapEnable(tap: tap, enable: true) }
    case .flagsChanged:
        // 别的键的事件也可能带着同一个标志位（比如方向键带 fn 的），所以先认键码
        guard event.getIntegerValueField(.keyboardEventKeycode) == hotkey.keyCode else {
            // 热键按住时又按了别的修饰键，同样是组合键
            reportOtherKeyIfHeld()
            break
        }
        let down = event.flags.rawValue & hotkey.flagMask != 0
        if down != hotkeyIsDown {
            hotkeyIsDown = down
            reportedOtherKey = false
            emit(["event": "hotkey", "down": down])
        }
    case .keyDown:
        reportOtherKeyIfHeld()
    default:
        break
    }
    return Unmanaged.passUnretained(event)
}

func reportOtherKeyIfHeld() {
    if hotkeyIsDown && !reportedOtherKey {
        reportedOtherKey = true
        emit(["event": "other_key"])
    }
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

// MARK: - 截住 esc 和悬浮条上的点击
//
// 听写进行中，悬浮条上有"取消"和"完成"两个按钮，按 esc 也能取消。这两样都不能让别的应用收到：
// 点击要是落到悬浮条的窗口上，我们的应用会被切到最前面，用户正在写的那个输入框就丢了焦点，文字贴不进去；
// esc 要是也传给前台应用，取消听写的同时会顺手关掉它的对话框、打断它正在做的事。
// 所以另开一个能改事件的监听，平时关着，只在听写进行中打开，只吞这两样，别的原样放行。它要辅助功能权限。

struct Region {
    let id: String
    let rect: CGRect
}

let escapeKeyCode: Int64 = 53
var captureTap: CFMachPort?
var capturing = false
var regions: [Region] = []
/// 按下已经被吞掉、还在等松开的：esc，和鼠标（记着按在哪一块上）
var escapeIsDown = false
var pressedRegion: String?
/// 一次录音最长 9 分钟。过了这么久父进程还没说"不截了"，多半是它那边出了岔子：自己松开，
/// 不能让 esc 在所有应用里一直按不出来
let captureLimit: TimeInterval = 600
var captureDeadline: DispatchWorkItem?

/// 这个监听现在该不该开着。手还没松开的那一下要吞完整，所以"不截了"之后可能还要再开一小会儿：
/// 按下吞了、松开却放出去的话，前台应用会收到没头没尾的半个事件
var captureWanted: Bool { capturing || escapeIsDown || pressedRegion != nil }

func settleCapture() {
    guard let tap = captureTap else { return }
    CGEvent.tapEnable(tap: tap, enable: captureWanted)
}

func setCapturing(_ on: Bool, regions newRegions: [Region] = []) {
    captureDeadline?.cancel()
    captureDeadline = nil
    capturing = on
    regions = newRegions
    settleCapture()
    guard on else { return }
    let deadline = DispatchWorkItem {
        emit(["event": "error", "message": "截了 \(Int(captureLimit)) 秒还没人说不截了，自己松开"])
        setCapturing(false)
    }
    captureDeadline = deadline
    DispatchQueue.main.asyncAfter(deadline: .now() + captureLimit, execute: deadline)
}

func regionAt(_ point: CGPoint) -> String? {
    regions.first { $0.rect.contains(point) }?.id
}

let onCaptureEvent: CGEventTapCallBack = { _, type, event, _ in
    let pass = Unmanaged.passUnretained(event)
    switch type {
    case .tapDisabledByTimeout, .tapDisabledByUserInput:
        // 它被停掉了：可能是系统嫌回调慢，也可能就是我们自己关的（自己关也会收到这个通知）。
        // 该开着就重新打开；不该开的不能碰——在这里再关一次会再收到一次通知，没完没了地转（实测转起来过）
        if captureWanted, let tap = captureTap { CGEvent.tapEnable(tap: tap, enable: true) }
        return pass
    case .keyDown:
        guard event.getIntegerValueField(.keyboardEventKeycode) == escapeKeyCode else { return pass }
        let isRepeat = event.getIntegerValueField(.keyboardEventAutorepeat) != 0
        if capturing {
            if !isRepeat {
                escapeIsDown = true
                emit(["event": "escape"])
            }
            return nil
        }
        // 已经不截了，但取消用的那一下还按着没松：长按产生的重复也不放出去
        if escapeIsDown && isRepeat { return nil }
        // 新的一下：和我们无关了。万一上一次的松开没收到，也在这里收拾掉
        escapeIsDown = false
        settleCapture()
        return pass
    case .keyUp:
        guard escapeIsDown, event.getIntegerValueField(.keyboardEventKeycode) == escapeKeyCode else { return pass }
        escapeIsDown = false
        settleCapture()
        return nil
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
        settleCapture()
        return nil
    default:
        return pass
    }
}

func startCaptureTap() -> Bool {
    let types: [CGEventType] = [.keyDown, .keyUp, .leftMouseDown, .leftMouseUp, .leftMouseDragged]
    let mask = types.reduce(CGEventMask(0)) { $0 | CGEventMask(1 << $1.rawValue) }
    guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap,
                                      options: .defaultTap, eventsOfInterest: mask,
                                      callback: onCaptureEvent, userInfo: nil) else { return false }
    captureTap = tap
    let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
    CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
    // 平时关着：不在任何按键和点击的必经之路上
    CGEvent.tapEnable(tap: tap, enable: false)
    return true
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

// MARK: - 自检（不发按键，只验证剪贴板存取能原样还原）

func selfTest() -> Bool {
    let pasteboard = NSPasteboard.general
    let before = snapshotPasteboard(pasteboard)
    writeTransientText(pasteboard, "speakmore 自检")
    let wroteText = pasteboard.string(forType: .string) == "speakmore 自检"
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

let arguments = Array(CommandLine.arguments.dropFirst())
if let flag = arguments.firstIndex(of: "--key") {
    let name = flag + 1 < arguments.count ? arguments[flag + 1] : ""
    guard let chosen = hotkeys[name] else {
        emit(["event": "error", "message": "不认识的热键 \(name)，可选：\(hotkeys.keys.sorted().joined(separator: "、"))"])
        exit(2)
    }
    hotkey = chosen
}
if arguments.contains("--check") {
    emit(["event": "check", "listen": CGPreflightListenEventAccess(), "trusted": AXIsProcessTrusted()])
    exit(0)
}
if arguments.contains("--selftest") {
    exit(selfTest() ? 0 : 1)
}

// 没给权限时让系统弹出授权提示，并把应用加进"输入监控"和"辅助功能"的列表里。
// --no-prompt：只查不弹。父进程重新检查权限靠的是重启本进程，那时再弹的话每查一次就弹一次
let mayPrompt = !arguments.contains("--no-prompt")
let listenAllowed = CGPreflightListenEventAccess() || (mayPrompt && CGRequestListenEventAccess())
let trusted = mayPrompt
    ? AXIsProcessTrustedWithOptions(["AXTrustedCheckOptionPrompt": true] as CFDictionary)
    : AXIsProcessTrusted()
let listening = listenAllowed && startKeyListener()
// 先开只听的那个，再开能改事件的这个：后开的排在前面，它吞掉的 esc 不会再被当成"热键加别的键"
let capture = trusted && startCaptureTap()
emit(["event": "ready", "listen": listening, "trusted": trusted, "capture": capture])

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
        case "capture":
            guard let parsed = parseRegions(object["regions"]) else {
                emit(["event": "error", "message": "capture 需要 regions：一组 { id, x, y, width, height }"])
                continue
            }
            DispatchQueue.main.async { setCapturing(true, regions: parsed) }
        case "release":
            DispatchQueue.main.async { setCapturing(false) }
        default:
            emit(["event": "error", "message": "不认识的命令：\(command)"])
        }
    }
    exit(0)
}

RunLoop.main.run()
