// mac-hotkeys.mjs 用的发键程序：按场景发合成按键，同时在 annotated session 层的末尾接住所有带记号的合成事件，
// 一个都不让到达任何应用；结束时打印末尾收到了哪些（小帮手吞掉的不会到这里，漏出去的会）。
// 用法：mac-hotkeys-poster <场景> [<开始信号文件>]
//   secure 场景自己开着安全输入（EnableSecureEventInput）。安全输入下 tap 收不到按下松开，末尾也接不住：
//   等驱动程序看到小帮手顶上了 Carbon、建出开始信号文件，才发 Carbon 顶着的组合（⌥空格），那几下由 Carbon 吞掉

import AppKit
import Carbon.HIToolbox

setvbuf(stdout, nil, _IOLBF, 0)
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

func post(_ key: Int64, _ down: Bool, flags: UInt64, modifier: Bool = false, mark: Int64 = tag) {
    let event = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(key), keyDown: down)!
    if modifier { event.type = .flagsChanged }
    event.flags = CGEventFlags(rawValue: flags)
    event.setIntegerValueField(.eventSourceUserData, value: mark)
    event.post(tap: .cghidEventTap)
}

func now() -> UInt64 { clock_gettime_nsec_np(CLOCK_UPTIME_RAW) }
/// 微秒级的间隔：usleep 做不到这么准，空转
func spin(_ microseconds: Double) {
    let end = now() + UInt64(microseconds * 1000)
    while now() < end {}
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
    case "escape":
        post(escape, true, flags: none)
        usleep(40000)
        post(escape, false, flags: none)
        usleep(40000)
    case "secure":
        EnableSecureEventInput()
        let signal = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : ""
        let deadline = now() + 5_000_000_000
        while !FileManager.default.fileExists(atPath: signal) && now() < deadline { usleep(50000) }
        if FileManager.default.fileExists(atPath: signal) {
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
