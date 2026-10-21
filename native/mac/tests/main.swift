// Mac 小帮手纯逻辑的测试。没有 Xcode 也能跑（命令行工具里没有 XCTest）：和要测的源码一起用 swiftc 编成一个程序，
// 跑完有没过的就以非 0 退出。scripts/dev/test-native.mjs 负责编和跑：
//   swiftc native/mac/<除 main.swift 以外的>.swift native/mac/tests/*.swift -o <临时文件> && <临时文件> native/fixtures/hotkeys/mac
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

/// bind 命令的绑定表（规矩同 Windows 版的 protocol_test.go）：正例原样装上；每条规矩各一个反例，只退回那一个（invalid）；
/// 整条形状不对是 nil
func testParseBindings() {
    func parsed(_ json: String) -> (bindings: [Binding], rejected: [Rejected])? {
        parseBindings(try! JSONSerialization.jsonObject(with: json.data(using: .utf8)!, options: .fragmentsAllowed))
    }
    let good = parsed("""
    [{"id":"dictate#0","mods":[61],"when":"always"},
     {"id":"dictate#1","mods":[61,60],"when":"always"},
     {"id":"dictate#2","mods":[61],"key":49,"when":"always"},
     {"id":"dictate#3","mods":[],"key":105,"when":"always"},
     {"id":"cancel#0","mods":[],"key":53,"when":"capturing"},
     {"id":"x#0","mods":[],"key":0,"when":"always"},
     {"id":"x#1","mods":[],"key":127,"when":"always"},
     {"id":"x#2","mods":[62],"key":null,"when":"always"}]
    """)
    check(good?.rejected == [], "正例被退回：\(String(describing: good?.rejected))")
    check(good?.bindings.map(\.id) == ["dictate#0", "dictate#1", "dictate#2", "dictate#3", "cancel#0", "x#0", "x#1", "x#2"],
          "正例没有全装上：\(String(describing: good?.bindings.map(\.id)))")
    check(good?.bindings[2].mods == [61] && good?.bindings[2].key == 49 && good?.bindings[4].capturing == true
        && good?.bindings[7].key == nil, "正例的字段不对")
    check(parsed("[]")?.bindings.isEmpty == true, "空表要能装（清空绑定）")

    let invalid: [(String, String)] = [
        ("id 是空的", #"{"id":"","mods":[61],"when":"always"}"#),
        ("mods 里有普通键", #"{"id":"a#0","mods":[49],"when":"always"}"#),
        ("mods 重复", #"{"id":"a#0","mods":[61,61],"when":"always"}"#),
        ("三个修饰键", #"{"id":"a#0","mods":[61,60,62],"when":"always"}"#),
        ("一个键都没有", #"{"id":"a#0","mods":[],"when":"always"}"#),
        ("合计三个键", #"{"id":"a#0","mods":[61,60],"key":49,"when":"always"}"#),
        ("key 是修饰键", #"{"id":"a#0","mods":[],"key":61,"when":"always"}"#),
        ("key 超出 kVK", #"{"id":"a#0","mods":[],"key":128,"when":"always"}"#),
        ("不认识的 when", #"{"id":"a#0","mods":[61],"when":"sometimes"}"#),
        ("capturing 带修饰键", #"{"id":"a#0","mods":[61],"key":53,"when":"capturing"}"#),
        ("capturing 没有普通键", #"{"id":"a#0","mods":[61],"when":"capturing"}"#),
    ]
    for (what, item) in invalid {
        let result = parsed("[\(item),{\"id\":\"ok#0\",\"mods\":[61],\"when\":\"always\"}]")
        check(result?.bindings.map(\.id) == ["ok#0"] && result?.rejected.map(\.reason) == ["invalid"],
              "反例「\(what)」：\(String(describing: result))")
    }
    let twice = parsed(#"[{"id":"a#0","mods":[61],"when":"always"},{"id":"ok#0","mods":[60],"when":"always"},{"id":"a#0","mods":[62],"when":"always"}]"#)
    check(twice?.bindings.map(\.id) == ["ok#0"] && twice?.rejected == [Rejected(id: "a#0", reason: "invalid"), Rejected(id: "a#0", reason: "invalid")],
          "重复的 id：两个都退回 \(String(describing: twice))")

    let shapes: [(String, String)] = [
        ("不是一组", #"{}"#), ("字符串", #""dictate""#), ("一组数字", #"[1,2]"#), ("一组数组", #"[[61]]"#), ("null", "null"),
        ("没有 id", #"[{"mods":[61],"when":"always"}]"#),
        ("id 不是字符串", #"[{"id":7,"mods":[61],"when":"always"}]"#),
        ("没有 mods", #"[{"id":"a#0","key":49,"when":"always"}]"#),
        ("mods 是 null", #"[{"id":"a#0","mods":null,"when":"always"}]"#),
        ("mods 里有小数", #"[{"id":"a#0","mods":[61.5],"when":"always"}]"#),
        ("mods 里有 true", #"[{"id":"a#0","mods":[true],"when":"always"}]"#),
        ("mods 里有负数", #"[{"id":"a#0","mods":[-1],"when":"always"}]"#),
        ("key 是负数", #"[{"id":"a#0","mods":[],"key":-1,"when":"always"}]"#),
        ("key 是字符串", #"[{"id":"a#0","mods":[],"key":"49","when":"always"}]"#),
        ("没有 when", #"[{"id":"a#0","mods":[61]}]"#),
        ("when 不是字符串", #"[{"id":"a#0","mods":[61],"when":1}]"#),
    ]
    for (what, shape) in shapes {
        check(parsed(shape) == nil, "整条形状不对没被拒：\(what)")
    }
    check(parseBindings(nil) == nil, "没有 bindings 没被拒")
}

guard CommandLine.arguments.count == 2 else {
    FileHandle.standardError.write("用法：<测试程序> <样例目录 native/fixtures/hotkeys/mac>\n".data(using: .utf8)!)
    exit(2)
}
runFixtures(in: CommandLine.arguments[1])
testParseBindings()

for failure in failures { print("✖ \(failure)") }
print("Swift：\(passed) 条过，\(failures.count) 条没过")
exit(failures.isEmpty ? 0 : 1)
