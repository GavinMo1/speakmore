// mac-hotkeys.mjs 用的发键程序：按场景发合成按键，同时在 annotated session 层的末尾接住所有带记号的合成事件，
// 一个都不让到达任何应用；结束时打印末尾收到了哪些（小帮手吞掉的不会到这里，漏出去的会）。
// 用法：mac-hotkeys-poster <场景> [<信号文件>]
//   secure 场景自己开着安全输入（EnableSecureEventInput）。安全输入下 tap 收不到按下松开，末尾也接不住：
//   等驱动程序看到小帮手顶上了 Carbon、建出开始信号文件，才发 Carbon 顶着的组合（⌥空格），那几下由 Carbon 吞掉
//   hold 场景按下空格就停住，等驱动程序让小帮手离开录键模式、建出信号文件，再发空格的自动重复和松开
//   check 场景什么也不发，只查一遍能不能发（驱动程序起小帮手之前先跑它）
// 屏幕锁着、切到了别的用户时一个键也不发，以非 0 退出：锁屏界面自己开着安全输入，末尾接不住按键，合成的键会打进锁屏的密码框；
// 锁屏时 Carbon 热键也不起作用。10-21 锁屏时跑过一次：F13 没被 Carbon 吞、到了末尾，安全输入那几下 ⌥空格去向不明

import AppKit
import Carbon.HIToolbox

setvbuf(stdout, nil, _IOLBF, 0)

/// 屏幕锁着，或者这个会话不在前台（切到了别的用户）。CGSSessionScreenIsLocked 不是公开的键（VoiceInk 也这么查），
/// 解锁时没有这一项。别的应用已经开着安全输入（密码框、终端的"安全键盘输入"）也不发：那时末尾同样接不住，键会打进那个输入框
func screenUnavailable() -> Bool {
    let session = CGSessionCopyCurrentDictionary() as? [String: Any] ?? [:]
    return session["CGSSessionScreenIsLocked"] as? Bool == true || session[kCGSessionOnConsoleKey] as? Bool == false
}
// secure 场景发键前只再查锁屏：那时的安全输入是它自己开的
if screenUnavailable() || IsSecureEventInputEnabled() {
    print(#"{"error":"屏幕锁着、不在这个用户的会话里，或者别的应用开着安全输入：不发键"}"#)
    exit(4)
}
/// 我们发的键带的记号：末尾只接带记号的，用户自己按的照常放行
let tag: Int64 = 0x5EAB_0000
/// 小帮手自己的记号：模拟"贴字时的 ⌘V"
let helperTag: Int64 = 0x5350_4B48

var sink: [[String: Any]] = []
let onSink: CGEventTapCallBack = { _, type, event, _ in
    let mark = event.getIntegerValueField(.eventSourceUserData)
    guard mark == tag || mark == helperTag else { return Unmanaged.passUnretained(event) }
    sink.append(["type": Int(type.rawValue), "code": event.getIntegerValueField(.keyboardEventKeycode)])
    return nil
}
let mask = CGEventMask(1 << CGEventType.keyDown.rawValue | 1 << CGEventType.keyUp.rawValue
    | 1 << CGEventType.flagsChanged.rawValue)
guard let sinkTap = CGEvent.tapCreate(tap: .cgAnnotatedSessionEventTap, place: .tailAppendEventTap,
                                      options: .defaultTap, eventsOfInterest: mask, callback: onSink, userInfo: nil)
else {
    print(#"{"error":"末尾的 tap 建不起来：给运行它的终端辅助功能权限"}"#)
    exit(3)
}
CFRunLoopAddSource(CFRunLoopGetMain(), CFMachPortCreateRunLoopSource(nil, sinkTap, 0), .commonModes)
CGEvent.tapEnable(tap: sinkTap, enable: true)

let source = CGEventSource(stateID: .privateState)
/// 右 Option 按着：Option 位、不分左右的位、右 Option 的设备位
let rightOption: UInt64 = 0x80000 | 0x100 | 0x40
let none: UInt64 = 0x100
let rightOptionCode: Int64 = 0x3D, space: Int64 = 0x31, keyK: Int64 = 0x28, keyV: Int64 = 0x09
let f13: Int64 = 0x69, escape: Int64 = 0x35

/// repeating：自动重复的按下（系统给的标记，小帮手靠它认出进入录键前就按着的键）
func post(_ key: Int64, _ down: Bool, flags: UInt64, modifier: Bool = false, mark: Int64 = tag, repeating: Bool = false) {
    let event = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(key), keyDown: down)!
    if modifier { event.type = .flagsChanged }
    event.flags = CGEventFlags(rawValue: flags)
    event.setIntegerValueField(.eventSourceUserData, value: mark)
    if repeating { event.setIntegerValueField(.keyboardEventAutorepeat, value: 1) }
    event.post(tap: .cghidEventTap)
}

/// @Sendable：顶层代码里的函数，在发键线程上经别的函数调到它时，编译器要求这么标
@Sendable func now() -> UInt64 { clock_gettime_nsec_np(CLOCK_UPTIME_RAW) }
/// 微秒级的间隔：usleep 做不到这么准，空转
func spin(_ microseconds: Double) {
    let end = now() + UInt64(microseconds * 1000)
    while now() < end {}
}

/// 等驱动程序建出信号文件，最多等 5 秒。返回等没等到
func waitForSignal() -> Bool {
    let signal = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : ""
    let deadline = now() + 5_000_000_000
    while !FileManager.default.fileExists(atPath: signal) && now() < deadline { usleep(50000) }
    return FileManager.default.fileExists(atPath: signal)
}

func pressRightOption() {
    post(rightOptionCode, true, flags: rightOption, modifier: true)
    usleep(30000)
    post(rightOptionCode, false, flags: none, modifier: true)
    usleep(30000)
}

let scenario = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : ""
alarm(30)
Thread.detachNewThread {
    usleep(300_000)
    switch scenario {
    case "single":
        for _ in 0 ..< 3 { pressRightOption() }
    case "chord":
        // 人"同时按"按得出 0.4 ms 的间隔（V1）：从 0 到 5 ms 各几次
        for gap in [0.0, 0, 0, 0, 0, 100, 100, 100, 100, 100, 1000, 1000, 1000, 1000, 1000, 5000, 5000, 5000, 5000, 5000] {
            post(rightOptionCode, true, flags: rightOption, modifier: true)
            spin(gap)
            post(space, true, flags: rightOption)
            spin(3000)
            post(space, false, flags: rightOption)
            spin(3000)
            post(rightOptionCode, false, flags: none, modifier: true)
            usleep(40000)
        }
    case "interrupt":
        post(rightOptionCode, true, flags: rightOption, modifier: true)
        usleep(30000)
        post(keyK, true, flags: rightOption)
        usleep(30000)
        post(keyK, false, flags: rightOption)
        usleep(30000)
        post(rightOptionCode, false, flags: none, modifier: true)
        usleep(30000)
    case "injected":
        post(rightOptionCode, true, flags: rightOption, modifier: true)
        usleep(30000)
        post(keyV, true, flags: rightOption, mark: helperTag)
        usleep(30000)
        post(keyV, false, flags: rightOption, mark: helperTag)
        usleep(30000)
        post(rightOptionCode, false, flags: none, modifier: true)
        usleep(30000)
    case "carbon":
        for _ in 0 ..< 3 {
            post(f13, true, flags: none)
            usleep(40000)
            post(f13, false, flags: none)
            usleep(40000)
        }
    case "check":
        break
    case "escape":
        post(escape, true, flags: none)
        usleep(40000)
        post(escape, false, flags: none)
        usleep(40000)
    case "record":
        // 录键：右 Option、空格（带一次自动重复）依次按下再松开
        post(rightOptionCode, true, flags: rightOption, modifier: true)
        usleep(30000)
        post(space, true, flags: rightOption)
        usleep(30000)
        post(space, true, flags: rightOption, repeating: true)
        usleep(30000)
        post(space, false, flags: rightOption)
        usleep(30000)
        post(rightOptionCode, false, flags: none, modifier: true)
        usleep(30000)
    case "hold":
        // 录键时按下空格，离开录键模式以后才自动重复、松开（信号文件建出来以后）。等不到信号也照样松开，不留按着的键
        post(space, true, flags: none)
        _ = waitForSignal()
        post(space, true, flags: none, repeating: true)
        usleep(30000)
        post(space, false, flags: none)
        usleep(30000)
    case "secure":
        EnableSecureEventInput()
        // 等信号的这几秒里也可能锁屏：这几下末尾接不住，锁着就不发
        if waitForSignal() && !screenUnavailable() {
            for _ in 0 ..< 3 {
                post(rightOptionCode, true, flags: rightOption, modifier: true)
                usleep(30000)
                post(space, true, flags: rightOption)
                usleep(30000)
                post(space, false, flags: rightOption)
                usleep(30000)
                post(rightOptionCode, false, flags: none, modifier: true)
                usleep(60000)
            }
            pressRightOption()
        }
        DisableSecureEventInput()
        usleep(1_500_000)
    default:
        print(#"{"error":"不认识的场景"}"#)
        exit(2)
    }
    usleep(300_000)
    DispatchQueue.main.async {
        let data = try! JSONSerialization.data(withJSONObject: ["sink": sink])
        print(String(data: data, encoding: .utf8)!)
        exit(0)
    }
}
RunLoop.main.run()
