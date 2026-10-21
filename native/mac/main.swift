// 仿刻客户端的原生小帮手：听热键、把文字贴进当前输入框。
// 这两件事 Electron 自己做不了，原版也是交给 Swift 写的库和子进程（docs/07-native-helpers.md）。
// 文件：main.swift 入口和命令；Keyboard.swift 按键和点击（tap、Carbon）；Matcher.swift 热键匹配；
// Bindings.swift 绑定表的解析；Paste.swift 贴字；Output.swift 往父进程写事件。
//
// 和父进程用"一行一个 JSON"通信，和 Windows 版（native/windows/）一字不差（docs/hotkey-research.md 5.8）：
//   标准输出  {"event":"ready","listen":true,"trusted":true,"capture":true}
//                                         启动完成，附两项权限的状态；capture：截不截得住取消键和点击
//             {"event":"bound","rejected":[{"id":"x#0","reason":"needs_trusted"}]}
//                                         装好了一份绑定表；rejected 是装不上的和原因（Bindings.swift 的 Rejected）
//             {"event":"binding","id":"dictate#0","down":true}       某个绑定按下 / 松开
//             {"event":"interrupted","id":"dictate#0"}               按着时来了组合外的键（是别的组合键，这一下作废）
//             {"event":"interrupted","id":"dictate#0","to":"x#0"}    升级成了另一个绑定，紧接着报它的按下
//             {"event":"click","id":"cancel"}                        截着的时候点了某一块
//             {"event":"pasted","id":1,"ok":true}                    贴完了；ok 为 false 时文字留在剪贴板里
//   标准输入  {"cmd":"bind","bindings":[{"id":"dictate#0","mods":[61],"when":"always"},
//                                       {"id":"cancel#0","mods":[],"key":53,"when":"capturing"}]}
//                                         整表替换；mods 是修饰键、key 是普通键，都是 kVK 键码；
//                                         capturing 的只在截着的时候算数
//             {"cmd":"capture","regions":[{"id":"cancel","x":0,"y":0,"width":28,"height":28}]}
//                                         开始截：capturing 的绑定，和这几块（屏幕坐标）里的鼠标点击
//             {"cmd":"release"}           不截了
//             {"cmd":"paste","id":1,"text":"…"}
// 父进程退出（标准输入关闭）时自己也退出。
// --no-prompt：缺权限时不让系统弹授权提示，只照实报。
//
// 按键内容不出这个进程：只报绑定的按下、松开、被打断，不报是哪个键。

import AppKit

let arguments = Array(CommandLine.arguments.dropFirst())
if arguments.contains("--check") {
    emit(["event": "check", "listen": CGPreflightListenEventAccess(), "trusted": AXIsProcessTrusted()])
    flushOutput()
    exit(0)
}
if arguments.contains("--selftest") {
    let ok = selfTest()
    flushOutput()
    exit(ok ? 0 : 1)
}

// 没给权限时让系统弹出授权提示，并把应用加进"输入监控"和"辅助功能"的列表里。
// --no-prompt：只查不弹。父进程重新检查权限靠的是重启本进程，那时再弹的话每查一次就弹一次
let mayPrompt = !arguments.contains("--no-prompt")
let listenAllowed = CGPreflightListenEventAccess() || (mayPrompt && CGRequestListenEventAccess())
let trusted = mayPrompt
    ? AXIsProcessTrustedWithOptions(["AXTrustedCheckOptionPrompt": true] as CFDictionary)
    : AXIsProcessTrusted()
let listening = listenAllowed && startListenTap()
// 先建只听的，再建吞键的：后建的排在前面，事件先到吞键的那里
let capture = trusted && startSwallowTap()
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
        case "bind":
            let bindings = object["bindings"]
            DispatchQueue.main.async { applyBindings(bindings) }
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
    flushOutput()
    exit(0)
}

// 用 NSApplication 跑，不只跑 RunLoop：单个 F 键交给 Carbon 注册，只跑 RunLoop 的进程里键照样被系统接走、
// 回调却永远不来（V19 实测）。.prohibited：不出程序坞图标、不出菜单栏。
// 不让系统给它打盹（App Nap）：触发 tap 的回调是同步的，每次按修饰键系统都等它返回，进程被压低优先级的话
// 全系统的修饰键都跟着慢（推断，未实测）
let noNap = ProcessInfo.processInfo.beginActivity(options: .userInitiatedAllowingIdleSystemSleep, reason: "听热键")
NSApplication.shared.setActivationPolicy(.prohibited)
NSApplication.shared.run()
