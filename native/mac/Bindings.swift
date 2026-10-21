// bind 命令里的绑定表（纯逻辑，只用 Foundation）：查形状，查不过的单个绑定照实退回，不猜它想要什么。
// 规矩和 Windows 版（native/windows/protocol.go 的 parseBindings）一样，只是键码换成 kVK。
// 表是主进程按动作目录生成、校验过的（src/hotkeys/bindings.mjs），这里再查一遍是兜底：装错了键会往用户的输入框里打字。

import Foundation

/// 一个装不上的绑定：bound 回执里的一行
struct Rejected: Equatable {
    let id: String
    /// invalid 形状不对；needs_listen 没有输入监控权限；needs_trusted 要吞键却没有辅助功能权限；register_failed 单个 F 键注册不上
    let reason: String

    var json: [String: Any] { ["id": id, "reason": reason] }
}

/// 解析 bind 的 bindings。整条的形状不对（不是一组对象、少了 id / mods / when、字段类型不对）是 nil，绑定表不该动：
/// 那是父进程写错了，不是哪一个绑定的事。单个绑定不合规矩的退回、reason 是 invalid，其余照装
func parseBindings(_ value: Any?) -> (bindings: [Binding], rejected: [Rejected])? {
    guard let list = value as? [[String: Any]] else { return nil }
    var items: [(id: String, mods: [Int], key: Int?, when: String)] = []
    for item in list {
        guard let id = item["id"] as? String, let mods = naturals(item["mods"]), let when = item["when"] as? String
        else { return nil }
        let key: Int?
        if let raw = item["key"], !(raw is NSNull) {
            guard let code = natural(raw) else { return nil }
            key = code
        } else {
            key = nil
        }
        items.append((id, mods, key, when))
    }
    let counts = Dictionary(items.map { ($0.id, 1) }, uniquingKeysWith: +)
    var bindings: [Binding] = []
    var rejected: [Rejected] = []
    for item in items {
        // 事件只带 id：同一个 id 出现两次，父进程分不清是哪一个触发的，所以都不装
        if counts[item.id] == 1, let binding = bindingOf(item) {
            bindings.append(binding)
        } else {
            rejected.append(Rejected(id: item.id, reason: "invalid"))
        }
    }
    return (bindings, rejected)
}

private func bindingOf(_ item: (id: String, mods: [Int], key: Int?, when: String)) -> Binding? {
    let (id, mods, key, when) = item
    let capturing = when == "capturing"
    guard !id.isEmpty, when == "always" || capturing,
          mods.count <= 2, Set(mods).count == mods.count, mods.allSatisfy({ modifierKeyCodes.contains($0) }),
          // 普通键：kVK 都在 0x00–0x7F 里，修饰键不能放在这一栏
          key.map({ $0 <= 0x7F && !modifierKeyCodes.contains($0) }) ?? true,
          (1 ... 2).contains(mods.count + (key == nil ? 0 : 1)),
          // 只在说话时生效的只按自己那一个键认（5.3）
          !capturing || (key != nil && mods.isEmpty) else { return nil }
    return Binding(id: id, mods: mods, key: key, capturing: capturing)
}

/// JSON 里的非负整数。JSONSerialization 把 true、1.5 也解成 NSNumber，这两种不算
private func natural(_ value: Any?) -> Int? {
    guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
          let exact = Int(exactly: number.doubleValue), exact >= 0 else { return nil }
    return exact
}

private func naturals(_ value: Any?) -> [Int]? {
    guard let list = value as? [Any] else { return nil }
    let ints = list.compactMap(natural)
    return ints.count == list.count ? ints : nil
}
