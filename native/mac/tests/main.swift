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

/// 组合里的普通键松开丢了，修饰键松开时要核对（5.3 第 8 条"任何修饰键变化"）：照样报松开，也不再留着要吞的键——
/// 留着的话吞键 tap 一直开着，下一次随便按个键还会被报成打断。pendingSwallow 只有 Mac 有，所以不进共用样例
func testLostKeyUpAtModifierUp() {
    let rightOption = 0x3D, space = 0x31
    var lost: Set<Int> = []
    let matcher = Matcher(stillDown: { !lost.contains($0) })
    _ = matcher.bind([Binding(id: "x#0", mods: [rightOption], key: space, capturing: false)])
    _ = matcher.onKey(rightOption, down: true, timeMs: 1)
    let down = matcher.onKey(space, down: true, timeMs: 2)
    check(down == Outcome(swallow: true, events: [.binding(id: "x#0", down: true)]), "⌥空格按下：\(down)")
    check(matcher.pendingSwallow == [space], "⌥空格按着：空格的松开要吞 \(matcher.pendingSwallow)")
    lost.insert(space)
    let up = matcher.onKey(rightOption, down: false, timeMs: 3)
    check(up == Outcome(swallow: false, events: [.binding(id: "x#0", down: false)]), "空格松开丢了、⌥ 松开：要报松开 \(up)")
    check(matcher.pendingSwallow.isEmpty, "空格松开丢了、⌥ 松开以后：不再有要吞的键 \(matcher.pendingSwallow)")
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

/// 录键（Recorder.swift）：集合怎么变、吞不吞、离开以后还要吞哪些
func testRecorder() {
    let rightOption = 0x3D, rightCommand = 0x36, leftControl = 0x3B, rightControl = 0x3E
    let space = 0x31, keyA = 0x00, f13 = 0x69
    func held(_ mods: [Int], _ keys: [Int]) -> NSDictionary {
        ["event": "recording", "on": true, "mods": mods, "keys": keys]
    }
    let off: NSDictionary = ["event": "recording", "on": false]
    func same(_ recorder: Recorder, _ want: NSDictionary, _ what: String) {
        let got = recorder.json as NSDictionary
        check(got == want, "\(what)：报的是 \(got)，应为 \(want)")
    }
    func expect(_ got: Recorded?, _ want: Recorded?, _ what: String) {
        check(got == want, "\(what)：得到 \(String(describing: got))，应为 \(String(describing: want))")
    }
    let counted = Recorded(swallow: true, changed: true)
    let modifierCounted = Recorded(swallow: false, changed: true)
    let swallowOnly = Recorded(swallow: true, changed: false)
    let passed = Recorded()

    // 正例：录右 Option+空格
    var recorder = Recorder()
    expect(recorder.onKey(space, down: true), nil, "没在录：空格交给匹配器")
    check(!recorder.swallowWanted, "没在录、没有要吞的：吞键 tap 不用开")
    recorder.start(swallowing: [])
    same(recorder, held([], []), "进入")
    check(recorder.swallowWanted, "录着时吞键 tap 要开着")
    expect(recorder.onKey(rightOption, down: true), modifierCounted, "右 Option 按下：集合变了，不吞")
    same(recorder, held([rightOption], []), "右 Option 按下以后")
    expect(recorder.onKey(space, down: true), counted, "空格按下：集合变了，吞")
    same(recorder, held([rightOption], [space]), "空格按下以后")
    expect(recorder.onKey(space, down: true, autorepeat: true), swallowOnly, "空格自动重复：集合不变，吞")
    expect(recorder.onKey(space, down: true), swallowOnly, "已经录到的空格又来一个按下：集合不变，吞")
    expect(recorder.onKey(space, down: false), counted, "空格松开：集合变了，吞")
    expect(recorder.onKey(rightOption, down: false), modifierCounted, "右 Option 松开：集合变了，不吞")
    same(recorder, held([], []), "全松开以后")

    // 升序、不重复；fn 原样报
    recorder = Recorder()
    recorder.start(swallowing: [])
    _ = recorder.onKey(rightControl, down: true)
    _ = recorder.onKey(leftControl, down: true)
    expect(recorder.onKey(rightControl, down: true), passed, "右 Control 又说按着：集合不变")
    expect(recorder.onKey(rightCommand, down: false), passed, "没录到的右 ⌘ 松开：集合不变")
    _ = recorder.onKey(space, down: true)
    _ = recorder.onKey(keyA, down: true)
    same(recorder, held([leftControl, rightControl], [keyA, space]), "两个修饰键、两个普通键")
    recorder = Recorder()
    recorder.start(swallowing: [])
    _ = recorder.onKey(fnKeyCode, down: true)
    _ = recorder.onKey(f13, down: true)
    same(recorder, held([fnKeyCode], [f13]), "fn 按着按 F13：fn 不折叠")

    // 进入前就按着的键：不算，它们的自动重复、松开放行
    recorder = Recorder()
    recorder.start(swallowing: [])
    expect(recorder.onKey(space, down: true, autorepeat: true), passed, "进入前按着的空格自动重复：不算、不吞")
    expect(recorder.onKey(space, down: false), passed, "进入前按着的空格松开：不算、不吞")
    expect(recorder.onKey(rightCommand, down: false), passed, "进入前按着的右 ⌘ 松开：不算")
    same(recorder, held([], []), "进入前按着的键都松开以后")
    expect(recorder.onKey(space, down: true), counted, "松开后再按空格：算")

    // 离开：还按着的普通键吞到松开为止，修饰键交回匹配器
    recorder = Recorder()
    recorder.start(swallowing: [])
    _ = recorder.onKey(rightOption, down: true)
    _ = recorder.onKey(space, down: true)
    check(recorder.stop(), "在录时离开：要报 on:false")
    same(recorder, off, "离开以后")
    check(recorder.swallowWanted, "离开时空格还按着：吞键 tap 还要开着")
    expect(recorder.onKey(space, down: true, autorepeat: true), swallowOnly, "离开后空格自动重复：照样吞")
    expect(recorder.onKey(rightOption, down: false), nil, "离开后右 Option 松开：交给匹配器")
    expect(recorder.onKey(space, down: false), swallowOnly, "离开后空格松开：吞，集合不报")
    check(!recorder.swallowWanted, "空格松开以后：吞键 tap 不用为录键开着")
    expect(recorder.onKey(space, down: true), nil, "之后的空格交给匹配器")
    check(!recorder.stop(), "没在录时离开：什么也不报")
    recorder = Recorder()
    recorder.start(swallowing: [])
    _ = recorder.onKey(rightOption, down: true)
    _ = recorder.stop()
    check(!recorder.swallowWanted, "只录到修饰键就离开：吞键 tap 不用开着")

    // 重新开始：清空集合；上一轮还按着的普通键吞到松开为止，但不再算
    recorder = Recorder()
    recorder.start(swallowing: [])
    _ = recorder.onKey(rightOption, down: true)
    _ = recorder.onKey(space, down: true)
    recorder.start(swallowing: [])
    same(recorder, held([], []), "重新开始")
    expect(recorder.onKey(space, down: true, autorepeat: true), swallowOnly, "上一轮的空格自动重复：吞，不算")
    expect(recorder.onKey(rightOption, down: false), passed, "上一轮的右 Option 松开：不改新集合")
    expect(recorder.onKey(space, down: false), swallowOnly, "上一轮的空格松开：吞，不算")
    same(recorder, held([], []), "上一轮的键都松开以后")
    expect(recorder.onKey(space, down: true), counted, "重新开始以后再按空格：算")

    // 进入时匹配器吞了按下的键：松开也要吞，修饰键不吞
    recorder = Recorder()
    recorder.start(swallowing: [space, rightOption])
    expect(recorder.onKey(space, down: true, autorepeat: true), swallowOnly, "匹配器吞了按下的空格自动重复：吞，不算")
    expect(recorder.onKey(space, down: false), swallowOnly, "匹配器吞了按下的空格松开：吞，不算")
    expect(recorder.onKey(rightOption, down: false), passed, "匹配器记着的右 Option 松开：不吞，不算")

    // 松开丢了：吞着松开的键来了不是自动重复的按下，就是新的一下
    recorder = Recorder()
    recorder.start(swallowing: [])
    _ = recorder.onKey(space, down: true)
    _ = recorder.stop()
    recorder.start(swallowing: [])
    expect(recorder.onKey(space, down: true), counted, "录着时：吞着松开的空格来了新的按下，算")
    recorder = Recorder()
    recorder.start(swallowing: [])
    _ = recorder.onKey(keyA, down: true)
    _ = recorder.stop()
    expect(recorder.onKey(keyA, down: true), nil, "不在录时：吞着松开的 A 来了新的按下，交给匹配器")
    check(!recorder.swallowWanted, "A 不再吞着：吞键 tap 不用为录键开着")
}

/// probe、info（Probe.swift）：id 是整数一定回一条 probed；有普通键的组合才查系统表（单个 F 键也查）；
/// 修饰键左右合并，F 键、方向键上的 fn 位是系统表自己带的，不比
func testProbe() {
    // 本机 CopySymbolicHotKeys 里摘的几条（2026-10-21）：⌘空格、⌃空格、⌃⇧空格（关着）、⌃F2、地球仪+A、⌃←、
    // 单个 F12、单个 F7（关着）。单个 F 键的条目只带合成的 fn 位
    let table = [
        SymbolicHotKey(code: 0x31, modifiers: 0x100, enabled: true),
        SymbolicHotKey(code: 0x31, modifiers: 0x1000, enabled: true),
        SymbolicHotKey(code: 0x31, modifiers: 0x1200, enabled: false),
        SymbolicHotKey(code: 0x78, modifiers: 0x21000, enabled: true),
        SymbolicHotKey(code: 0x00, modifiers: 0x20000, enabled: true),
        SymbolicHotKey(code: 0x7B, modifiers: 0x21000, enabled: true),
        SymbolicHotKey(code: 0x6F, modifiers: 0x20000, enabled: true),
        SymbolicHotKey(code: 0x62, modifiers: 0x20000, enabled: false),
    ]
    let conflicts: [(String, [Int], Int, Bool)] = [
        ("左 ⌘空格", [0x37], 0x31, true),
        ("右 ⌘空格（左右合并）", [0x36], 0x31, true),
        ("右 Control+空格", [0x3E], 0x31, true),
        ("左 Option+空格", [0x3A], 0x31, false),
        ("⌃⇧空格（系统表里关着）", [0x3B, 0x38], 0x31, false),
        ("⌃⌘空格（多一个修饰键）", [0x3B, 0x37], 0x31, false),
        ("左 Control+F2（F 键的 fn 位不比）", [0x3B], 0x78, true),
        ("左 Control+←（方向键的 fn 位不比）", [0x3B], 0x7B, true),
        ("fn+A（字母键的 fn 位要比）", [fnKeyCode], 0x00, true),
        ("⌘A", [0x37], 0x00, false),
        ("fn+空格", [fnKeyCode], 0x31, false),
        ("右 Option+F13", [0x3D], 0x69, false),
        ("单个 F12（F 键的 fn 位不比）", [], 0x6F, true),
        ("单个 F7（系统表里关着）", [], 0x62, false),
        ("单个 F13（系统表里没有）", [], 0x69, false),
        ("单个 F2（系统表里的是 ⌃F2）", [], 0x78, false),
        ("单个 A（系统表里的是地球仪+A）", [], 0x00, false),
    ]
    for (what, mods, key, want) in conflicts {
        check(symbolicConflict(mods: mods, key: key, in: table) == want, "冲突「\(what)」应为 \(want)")
    }

    func answer(_ json: String, table result: Result<[SymbolicHotKey], SymbolicFailure> = .success(table))
        -> (events: [NSDictionary], asked: Bool) {
        var asked = false
        let object = try! JSONSerialization.jsonObject(with: Data(json.utf8)) as! [String: Any]
        let events = answerProbe(object) {
            asked = true
            return result
        }
        return (events.map { $0 as NSDictionary }, asked)
    }
    func probed(_ id: Int, _ conflict: Bool) -> NSDictionary {
        conflict ? ["event": "probed", "id": id, "conflict": true, "source": "symbolic"]
            : ["event": "probed", "id": id, "conflict": false]
    }
    var got = answer(#"{"cmd":"probe","id":7,"mods":[55],"key":49}"#)
    check(got.events == [probed(7, true)] && got.asked, "⌘空格：\(got)")
    got = answer(#"{"cmd":"probe","id":-2,"mods":[61],"key":105}"#)
    check(got.events == [probed(-2, false)], "右 Option+F13，id 是负数：\(got)")
    got = answer(#"{"cmd":"probe","id":5,"mods":[],"key":111}"#)
    check(got.events == [probed(5, true)] && got.asked, "单个 F12：要查系统表，被占了 \(got)")
    got = answer(#"{"cmd":"probe","id":6,"mods":[],"key":105}"#)
    check(got.events == [probed(6, false)] && got.asked, "单个 F13：要查系统表，没被占 \(got)")
    for (what, json) in [
        ("只有修饰键", #"{"cmd":"probe","id":3,"mods":[61]}"#),
        ("两个修饰键", #"{"cmd":"probe","id":3,"mods":[61,60]}"#),
        ("key 是 null", #"{"cmd":"probe","id":3,"mods":[61],"key":null}"#),
    ] {
        got = answer(json)
        check(got.events == [probed(3, false)] && !got.asked, "\(what)：不查系统表、直接不冲突 \(got)")
    }
    for (what, json) in [
        ("没有 mods", #"{"cmd":"probe","id":4,"key":49}"#),
        ("mods 不是一组", #"{"cmd":"probe","id":4,"mods":"x","key":49}"#),
        ("mods 里有普通键", #"{"cmd":"probe","id":4,"mods":[49],"key":49}"#),
        ("mods 重复", #"{"cmd":"probe","id":4,"mods":[61,61],"key":49}"#),
        ("三个修饰键", #"{"cmd":"probe","id":4,"mods":[61,60,62]}"#),
        ("合计三个键", #"{"cmd":"probe","id":4,"mods":[61,60],"key":49}"#),
        ("一个键都没有", #"{"cmd":"probe","id":4,"mods":[]}"#),
        ("key 是修饰键", #"{"cmd":"probe","id":4,"mods":[55],"key":61}"#),
        ("key 超出 kVK", #"{"cmd":"probe","id":4,"mods":[55],"key":128}"#),
        ("key 是负数", #"{"cmd":"probe","id":4,"mods":[55],"key":-1}"#),
        ("key 是小数", #"{"cmd":"probe","id":4,"mods":[55],"key":49.5}"#),
        ("key 是 true", #"{"cmd":"probe","id":4,"mods":[55],"key":true}"#),
    ] {
        got = answer(json)
        check(got.events.count == 2 && got.events[0]["event"] as? String == "error" && got.events[1] == probed(4, false)
            && !got.asked, "形状不对「\(what)」：先报 error 再回不冲突 \(got)")
    }
    for (what, json) in [
        ("没有 id", #"{"cmd":"probe","mods":[55],"key":49}"#),
        ("id 是小数", #"{"cmd":"probe","id":1.5,"mods":[55],"key":49}"#),
        ("id 是 true", #"{"cmd":"probe","id":true,"mods":[55],"key":49}"#),
        ("id 是字符串", #"{"cmd":"probe","id":"7","mods":[55],"key":49}"#),
        ("没有 id，形状也不对", #"{"cmd":"probe","mods":[49]}"#),
    ] {
        got = answer(json)
        check(got.events.count == 1 && got.events[0]["event"] as? String == "error" && !got.asked,
              "\(what)：只报一条 error \(got)")
    }
    got = answer(#"{"cmd":"probe","id":9,"mods":[55],"key":49}"#, table: .failure(SymbolicFailure(status: -108)))
    check(got.events.count == 2 && (got.events[0]["message"] as? String)?.contains("-108") == true
        && got.events[1] == probed(9, false), "系统表读不出来：报带 OSStatus 的 error，回不冲突 \(got)")

    let infos: [(String, Any?, NSDictionary)] = [
        ("1", 1 as NSNumber, ["event": "info", "fnUsage": 1]),
        ("0", 0 as NSNumber, ["event": "info", "fnUsage": 0]),
        ("读不到", nil, ["event": "info"]),
        ("字符串", "1", ["event": "info"]),
        ("布尔", kCFBooleanTrue, ["event": "info"]),
        ("小数", 1.5 as NSNumber, ["event": "info"]),
    ]
    for (what, value, want) in infos {
        let got = infoEvent(fnUsage: value) as NSDictionary
        check(got == want, "info「\(what)」：\(got)，应为 \(want)")
    }
}

/// 划词的选区（Selection.swift）：截断不劈开字、位置要像样、回执的拼法；capture 的 outside 只认布尔
func testSelection() {
    check(clipSelection("abc", limit: 3) == "abc", "不超的不截")
    check(clipSelection("ab😀c", limit: 3) == "ab", "表情是一对代理，放不下就整个不要，不留半个")
    check(clipSelection("你好世界", limit: 2) == "你好", "按 UTF-16 单元数截")
    check(usableRect(CGRect(x: 0, y: 0, width: 0, height: 10)) == nil, "宽是 0 的框不要")
    check(usableRect(CGRect(x: 10, y: 20, width: 30, height: 12)) == CGRect(x: 10, y: 20, width: 30, height: 12), "像样的框原样")

    let found = selectionEvent(id: 7, text: "hello", rect: CGRect(x: 1, y: 2, width: 3, height: 4),
                               via: "ax", reason: nil, ms: 12)
    check(found["event"] as? String == "selection" && found["id"] as? Int == 7, "回执的名字和 id")
    check(found["text"] as? String == "hello" && found["editable"] == nil, "带着字；不报能不能改（10-23 砍掉了替换）")
    check((found["rect"] as? [String: CGFloat])?["width"] == 3, "带上位置")
    check(found["reason"] == nil && found["via"] as? String == "ax" && found["ms"] as? Int == 12, "有字时不带 reason")

    let empty = selectionEvent(id: 8, text: "", rect: CGRect(x: 1, y: 2, width: 3, height: 4),
                               via: "copy", reason: nil, ms: 400)
    check(empty["rect"] == nil, "没字时不带位置")
    check(empty["reason"] as? String == "none", "没字时说为什么：默认是没选中")
    let denied = selectionEvent(id: 9, text: "", rect: nil, via: "ax", reason: "not_trusted", ms: 0)
    check(denied["reason"] as? String == "not_trusted", "没权限照实说")
    let noRect = selectionEvent(id: 10, text: "x", rect: nil, via: "copy", reason: nil, ms: 30)
    check(noRect["rect"] == nil, "复制拿不到位置就不带")

    check(parseOutside(nil) == false, "outside 不写是 false")
    check(parseOutside(true) == true, "outside 写 true")
    let json = try! JSONSerialization.jsonObject(with: Data(#"{"a":true,"b":1,"c":"true"}"#.utf8)) as! [String: Any]
    check(parseOutside(json["a"]) == true, "JSON 里的 true")
    check(parseOutside(json["b"]) == nil, "JSON 里的 1 不算布尔")
    check(parseOutside(json["c"]) == nil, "字符串不算布尔")
}

guard CommandLine.arguments.count == 2 else {
    FileHandle.standardError.write("用法：<测试程序> <样例目录 native/fixtures/hotkeys/mac>\n".data(using: .utf8)!)
    exit(2)
}
runFixtures(in: CommandLine.arguments[1])
testLostKeyUpAtModifierUp()
testParseBindings()
testRecorder()
testProbe()
testSelection()

for failure in failures { print("✖ \(failure)") }
print("Swift：\(passed) 条过，\(failures.count) 条没过")
exit(failures.isEmpty ? 0 : 1)
