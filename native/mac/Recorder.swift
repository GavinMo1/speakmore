// 录键（纯逻辑，只用 Foundation）：设置页录一个新组合时，报"现在按住了哪些键"。什么时候定稿、合不合规矩由 JS 判断
// （docs/hotkey-research.md 5.6），这里只管集合，和吞不吞。
//   - 只算进入以后才按下的键。进入前就按着的（比如用快捷键打开了设置）不算，它们的自动重复、松开也不改集合，原样放行。
//   - 修饰键由 flagsChanged 的标志位定按下松开，一律不吞：吞了系统那边的修饰键状态会卡住。
//   - 别的键从录进集合的那一下起整段吞掉（按下、自动重复、松开）。离开录键模式、重新开始时还按着的，照样吞到松开为止，
//     不留"吞了按下、放了松开"的半截；进入时匹配器吞了按下的键也一样。
// 录键期间匹配器不喂，吞着松开的键也不喂（Keyboard.swift 的 feed）：不然离开以后它的自动重复会被当成新的一下去凑组合。
// 自己合成的事件、CapsLock 之类不是修饰键的 flagsChanged，在 feed 里就滤掉了，到不了这里。

import Foundation

/// 一个键盘事件在录键这边的结果
struct Recorded: Equatable {
    var swallow = false
    /// 录到的集合变了：要报一次 recording
    var changed = false
}

final class Recorder {
    private(set) var on = false
    /// 录到的修饰键、别的键：进入以后按下、还按着的
    private var mods: Set<Int> = []
    private var keys: Set<Int> = []
    /// 按下已经吞了、不再算进集合的键：吞到松开为止
    private var draining: Set<Int> = []

    /// 进入录键模式；已经在录就是重新开始。swallowed：匹配器吞了按下、还没吞松开的键
    func start(swallowing swallowed: Set<Int>) {
        draining.formUnion(keys)
        draining.formUnion(swallowed.subtracting(modifierKeyCodes))
        mods = []
        keys = []
        on = true
    }

    /// 离开录键模式。没在录时是 false：什么也不用报
    func stop() -> Bool {
        guard on else { return false }
        draining.formUnion(keys)
        mods = []
        keys = []
        on = false
        return true
    }

    /// 吞键 tap 要不要为录键开着：录着的时候，和还有要吞的松开的时候
    var swallowWanted: Bool { on || !draining.isEmpty }

    /// 报给父进程的那一行：录着时是录到的集合（各自升序），离开时是 on:false
    var json: [String: Any] {
        on ? ["event": "recording", "on": true, "mods": mods.sorted(), "keys": keys.sorted()]
            : ["event": "recording", "on": false]
    }

    /// 一个键盘事件。修饰键的 down 是标志位说的"现在按没按着"；autorepeat 是系统给的自动重复标记。
    /// nil：不归录键管，交给匹配器
    func onKey(_ code: Int, down: Bool, autorepeat: Bool = false) -> Recorded? {
        if modifierKeyCodes.contains(code) {
            guard on else { return nil }
            let changed = down ? mods.insert(code).inserted : mods.remove(code) != nil
            return Recorded(changed: changed)
        }
        if draining.contains(code) {
            if !down {
                draining.remove(code)
                return Recorded(swallow: true)
            }
            if autorepeat { return Recorded(swallow: true) }
            // 不是自动重复的按下：上一下的松开丢了，这是新的一下
            draining.remove(code)
        }
        guard on else { return nil }
        if down {
            // 已经录到的键又来按下：自动重复（或者松开丢了），照样吞
            if keys.contains(code) { return Recorded(swallow: true) }
            // 没录到的键在自动重复：进入前就按着的
            if autorepeat { return Recorded() }
            keys.insert(code)
            return Recorded(swallow: true, changed: true)
        }
        // 没录到的键松开：进入前就按着的
        guard keys.remove(code) != nil else { return Recorded() }
        return Recorded(swallow: true, changed: true)
    }
}
