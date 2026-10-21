// Mac 小帮手纯逻辑的测试。没有 Xcode 也能跑（命令行工具里没有 XCTest）：和要测的源码一起用 swiftc 编成一个程序，
// 跑完有没过的就以非 0 退出。scripts/dev/test-native.mjs 负责编和跑：
//   swiftc native/mac/Matcher.swift native/mac/tests/*.swift -o <临时文件> && <临时文件> native/fixtures/hotkeys/mac
// 共用的按键轨迹样例写法见 native/fixtures/hotkeys/README.md。

import Foundation

var failures: [String] = []
var passed = 0

func check(_ ok: Bool, _ what: @autoclosure () -> String) {
    if ok { passed += 1 } else { failures.append(what()) }
}

func bindings(_ value: Any?) -> [Binding] {
    (value as? [[String: Any]] ?? []).map { item in
        Binding(id: item["id"] as! String, mods: item["mods"] as! [Int], key: item["key"] as? Int,
                capturing: item["when"] as? String == "capturing")
    }
}

/// 样例里写的事件
func expectedEvents(_ value: Any?) -> [HotkeyEvent] {
    (value as? [[String: Any]] ?? []).map { item in
        if item["event"] as? String == "binding" {
            return .binding(id: item["id"] as! String, down: item["down"] as! Bool)
        }
        return .interrupted(id: item["id"] as! String, to: item["to"] as? String)
    }
}

func runFixtures(in directory: String) {
    let files = (try? FileManager.default.contentsOfDirectory(atPath: directory))?.filter { $0.hasSuffix(".json") }.sorted() ?? []
    var cases = 0
    for file in files {
        let data = FileManager.default.contents(atPath: "\(directory)/\(file)")!
        let root = try! JSONSerialization.jsonObject(with: data) as! [String: Any]
        for entry in root["cases"] as! [[String: Any]] {
            cases += 1
            runCase(entry, file: file)
        }
    }
    check(cases >= 25, "只读到 \(cases) 个样例（\(directory)；先跑 node scripts/build/hotkey-fixtures.mjs）")
}

func runCase(_ entry: [String: Any], file: String) {
    let name = "\(file)「\(entry["name"] as! String)」"
    // 松开的事件丢了的键：系统接口说它已经松开
    var lost: Set<Int> = []
    let matcher = Matcher(stillDown: { !lost.contains($0) })
    _ = matcher.bind(bindings(entry["bindings"]))
    for (index, step) in (entry["steps"] as! [[String: Any]]).enumerated() {
        let expect = step["expect"] as! [String: Any]
        var got = Outcome()
        if let code = step["code"] as? Int {
            let down = step["down"] as! Bool
            if down { lost.remove(code) }
            got = matcher.onKey(code, down: down, injected: step["injected"] as? Bool ?? false,
                                timeMs: UInt64(step["t"] as! Int))
        } else if let capture = step["capture"] as? Bool {
            matcher.setCapturing(capture)
        } else if let key = step["lostUp"] as? [String: Any] {
            lost.insert(key["code"] as! Int)
        } else if step["reset"] != nil {
            got.events = matcher.reset()
        } else if let list = step["bind"] {
            got.events = matcher.bind(bindings(list))
        } else {
            check(false, "\(name) 第 \(index + 1) 步认不出")
            return
        }
        let want = Outcome(swallow: expect["swallow"] as! Bool, events: expectedEvents(expect["events"]))
        check(got == want, "\(name) 第 \(index + 1) 步：得到 \(got)，应为 \(want)")
        if got != want { return }
    }
}

guard CommandLine.arguments.count == 2 else {
    FileHandle.standardError.write("用法：<测试程序> <样例目录 native/fixtures/hotkeys/mac>\n".data(using: .utf8)!)
    exit(2)
}
runFixtures(in: CommandLine.arguments[1])

for failure in failures { print("✖ \(failure)") }
print("Swift：\(passed) 条过，\(failures.count) 条没过")
exit(failures.isEmpty ? 0 : 1)
