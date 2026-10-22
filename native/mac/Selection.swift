// 划词翻译要的选区：选中的字、它在屏幕上的位置、能不能改（App 据此在卡片上给不给"替换选中文字"，替换就是 paste 往原处贴）。
// 先问辅助功能：焦点元素的 AXSelectedText，位置是 AXSelectedTextRange 的 AXBoundsForRange（全局坐标，左上角为原点，
// 和 CGEvent、capture 的 regions 同一套）。原生控件、Safari 都问得到；问不到字的（多数 Electron 应用、没开辅助功能树的
// Chrome）再模拟 ⌘C 从剪贴板取，取完把剪贴板还原，这条路拿不到位置。
// 和 Windows 版（native/windows/selection*.go）的回执一字不差：
//   {"event":"selection","id":7,"text":"…","editable":true,"rect":{…},"via":"ax","ms":12}
//   text 为空时带 reason（none 没选中 / not_trusted 没有辅助功能权限 / failed），editable 是 false、不带 rect

import AppKit

/// 一行 JSON 别太大：选得再多也只交出前这么多个 UTF-16 单元（同 Windows 版）
let maxSelectionUnits = 65536
/// 问辅助功能最多等多久：前台应用卡住时别把我们也拖住
private let axTimeout: Float = 0.5
/// 模拟 ⌘C 之前等用户把修饰键松开最多多久（他是按着右⌥按回车触发的）
private let releaseWait: TimeInterval = 1.0
/// 模拟 ⌘C 之后等剪贴板变化最多多久
private let copyWait: TimeInterval = 0.4
private let cKeyCode: CGKeyCode = 8
/// 能改的控件：这几种角色、并且值能写
private let editableRoles: Set<String> = [kAXTextFieldRole, kAXTextAreaRole, kAXComboBoxRole, "AXSearchField"]

// MARK: - 纯逻辑（tests/main.swift 测）

/// 截到 limit 个 UTF-16 单元以内，不把一个字符（含代理对、组合字符）劈开
func clipSelection(_ text: String, limit: Int = maxSelectionUnits) -> String {
    if text.utf16.count <= limit { return text }
    var clipped = ""
    var units = 0
    for character in text {
        let size = String(character).utf16.count
        if units + size > limit { break }
        clipped.append(character)
        units += size
    }
    return clipped
}

/// 位置像不像样：宽高都要大于 0，没有 NaN（有的应用对空选区回一个全 0 的框）
func usableRect(_ rect: CGRect?) -> CGRect? {
    guard let rect, rect.width > 0, rect.height > 0, rect.origin.x.isFinite, rect.origin.y.isFinite else { return nil }
    return rect
}

/// 拼出回执。text 为空时 editable 一定是 false、不带 rect（App 不拿没意义的位置摆卡片）
func selectionEvent(id: Int, text: String, editable: Bool, rect: CGRect?, via: String, reason: String?, ms: Int)
    -> [String: Any]
{
    var event: [String: Any] = ["event": "selection", "id": id, "text": clipSelection(text), "via": via, "ms": ms]
    if text.isEmpty {
        event["editable"] = false
        event["reason"] = reason ?? "none"
        return event
    }
    event["editable"] = editable
    if let rect = usableRect(rect) {
        event["rect"] = ["x": rect.origin.x, "y": rect.origin.y, "width": rect.width, "height": rect.height]
    }
    return event
}

// MARK: - 辅助功能

private func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
    return value
}

private func focusedElement() -> AXUIElement? {
    let system = AXUIElementCreateSystemWide()
    AXUIElementSetMessagingTimeout(system, axTimeout)
    guard let value = attribute(system, kAXFocusedUIElementAttribute),
          CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
    let element = value as! AXUIElement
    AXUIElementSetMessagingTimeout(element, axTimeout)
    return element
}

private func selectedText(_ element: AXUIElement) -> String? {
    attribute(element, kAXSelectedTextAttribute) as? String
}

/// 选区的外接框：AXSelectedTextRange 交给 AXBoundsForRange
private func selectionBounds(_ element: AXUIElement) -> CGRect? {
    guard let range = attribute(element, kAXSelectedTextRangeAttribute),
          CFGetTypeID(range) == AXValueGetTypeID() else { return nil }
    var bounds: CFTypeRef?
    guard AXUIElementCopyParameterizedAttributeValue(
        element, kAXBoundsForRangeParameterizedAttribute as CFString, range, &bounds) == .success,
        let bounds, CFGetTypeID(bounds) == AXValueGetTypeID() else { return nil }
    var rect = CGRect.zero
    guard AXValueGetValue(bounds as! AXValue, .cgRect, &rect) else { return nil }
    return rect
}

/// 能不能改：输入框一类的角色，值能写。密码框不算（AXSecureTextField 不在角色里）
private func isEditable(_ element: AXUIElement) -> Bool {
    guard let role = attribute(element, kAXRoleAttribute) as? String, editableRoles.contains(role) else { return false }
    var settable: DarwinBoolean = false
    guard AXUIElementIsAttributeSettable(element, kAXValueAttribute as CFString, &settable) == .success else {
        return false
    }
    return settable.boolValue
}

// MARK: - 模拟 ⌘C

private let heldModifiers: CGEventFlags = [.maskCommand, .maskAlternate, .maskControl, .maskShift]

/// 合成的 ⌘C 带上自己的记号，匹配器认出来不当成用户按的键（同 Paste.swift 的 ⌘V）
private func postCommandC() {
    let source = CGEventSource(stateID: .combinedSessionState)
    source?.userData = ourEventTag
    for keyDown in [true, false] {
        let event = CGEvent(keyboardEventSource: source, virtualKey: cKeyCode, keyDown: keyDown)
        event?.flags = .maskCommand
        event?.post(tap: .cghidEventTap)
    }
}

/// 每 20ms 看一次 until，成了或到点就调 done（主线程上，不阻塞）
private func poll(every interval: TimeInterval = 0.02, for limit: TimeInterval, until: @escaping () -> Bool,
                  done: @escaping (Bool) -> Void)
{
    let deadline = Date().addingTimeInterval(limit)
    func tick() {
        if until() { return done(true) }
        if Date() >= deadline { return done(false) }
        DispatchQueue.main.asyncAfter(deadline: .now() + interval, execute: tick)
    }
    tick()
}

/// 模拟 ⌘C 从剪贴板取选中的字：先等修饰键松开（还按着右⌥ 时有的应用把 ⌘C 当成 ⌥⌘C），存剪贴板、记 changeCount，
/// 发 ⌘C，等剪贴板变了读出字，再还原。剪贴板没变就是没选中（或者这个应用不让复制）
private func copySelection(_ done: @escaping (String) -> Void) {
    poll(for: releaseWait, until: {
        CGEventSource.flagsState(.hidSystemState).intersection(heldModifiers).isEmpty
    }) { _ in
        let pasteboard = NSPasteboard.general
        let saved = snapshotPasteboard(pasteboard)
        let before = pasteboard.changeCount
        postCommandC()
        poll(for: copyWait, until: { pasteboard.changeCount != before }) { changed in
            guard changed else { return done("") }
            let text = pasteboard.string(forType: .string) ?? ""
            restorePasteboard(pasteboard, from: saved)
            done(text)
        }
    }
}

// MARK: - selection 命令

func selection(id: Int) {
    let started = Date()
    let elapsed = { Int(Date().timeIntervalSince(started) * 1000) }
    guard AXIsProcessTrusted() else {
        // 没有辅助功能权限：问不了，也发不了 ⌘C
        emit(selectionEvent(id: id, text: "", editable: false, rect: nil, via: "ax", reason: "not_trusted", ms: 0))
        return
    }
    let focused = focusedElement()
    if let focused, let text = selectedText(focused), !text.isEmpty {
        emit(selectionEvent(id: id, text: text, editable: isEditable(focused), rect: selectionBounds(focused),
                            via: "ax", reason: nil, ms: elapsed()))
        return
    }
    copySelection { text in
        // 复制拿不到位置；能不能改还按焦点元素看（问得到的话）
        let editable = !text.isEmpty && focused.map(isEditable) == true
        emit(selectionEvent(id: id, text: text, editable: editable, rect: nil, via: "copy", reason: nil, ms: elapsed()))
    }
}
