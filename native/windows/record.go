package main

import "slices"

// 录键（纯逻辑）：设置页换键时，父进程说"录"，这里报进入以后按住了哪些键，怎么定稿由 JS 决定（docs/hotkey-research.md 5.6）。
// 它接在匹配器前面：录键期间的键盘事件全归它，匹配器一个也不喂，所以不报 binding、interrupted，截着时的取消键也不认。
//   - 录到的集合只算进入以后按下的键。进入前就按着的（比如用快捷键打开了设置）不算，它们的松开也不改集合；自动重复不改集合。
//   - 录到的键整段吞掉（按下、自动重复、松开），修饰键也吞：免得录 Win 时弹开始菜单、录 Alt 时窗口进菜单模式。
//     离开时还按着的，之后的自动重复和松开照样吞到松开为止，不留"吞了按下、放了松开"的半截；这期间它们也不喂匹配器，
//     免得 F13 的自动重复被当成新按的一下、凑成绑定。
//   - 进入前就按着的照进入前的样子：匹配器吞着按下的（凑成绑定的普通键、截着时的取消键）接着吞到松开，别的原样放行。
//   - 自己模拟的、驱动补的假修饰键、不是物理键的 vk 都不算，原样放行。
// 隐私：这是"不报是哪个键"的一个有边界的例外。只在父进程说"录"之后、说"停"或 30 秒到点之前报，只报键码不报字符。

type recorder struct {
	hotkeys *matcher
	on      bool
	// 录到的集合：进入以后按下、还没松开的键
	recorded map[keyID]bool
	// 不算进集合、但还按着的键 → 它的自动重复和松开吞不吞：进入前就按着的，和离开时还按着的录到的键（吞）
	others map[keyID]bool
	// 原样放行的 Alt、Win 按着期间插过掩码键了（同 matcher.settleMask）：插一次就够，松开再清
	masked bool
}

func newRecorder(hotkeys *matcher) *recorder {
	return &recorder{hotkeys: hotkeys, recorded: map[keyID]bool{}, others: map[keyID]bool{}}
}

// 进入（on 为 true，已经在录就从头录）或离开录键模式，返回要报的事件
func (r *recorder) record(on bool) []event {
	if on {
		return r.start()
	}
	return r.stop()
}

func (r *recorder) start() []event {
	var events []event
	if r.on {
		// 从头录：录到的还按着，之后照样吞到松开，但不算进新的集合
		r.keepSwallowingRecorded()
	} else {
		// 进入前就按着的要赶在匹配器从头认之前问：从头认会清掉它记着的普通键和吞了一半的
		for id, swallow := range r.hotkeys.heldKeys() {
			r.others[id] = r.others[id] || swallow
		}
		events = r.hotkeys.reset()
	}
	r.on = true
	return append(events, r.snapshot())
}

func (r *recorder) stop() []event {
	if !r.on {
		return nil
	}
	// 匹配器停着的这段时间键的松开都没喂给它：从头认，修饰键问一遍系统
	events := r.hotkeys.reset()
	// 原样放行的那些交回匹配器：它已经按系统的说法重新记了还按着的修饰键
	for id, swallow := range r.others {
		if !swallow {
			delete(r.others, id)
		}
	}
	r.keepSwallowingRecorded()
	r.on, r.masked = false, false
	return append(events, event{"event": "recording", "on": false})
}

func (r *recorder) keepSwallowingRecorded() {
	for id := range r.recorded {
		r.others[id] = true
	}
	r.recorded = map[keyID]bool{}
}

// 监听停了又打开（钩子重装、睡眠唤醒、解锁），连同匹配器从头认：这段时间的松开多半丢了，按着的都不算了。
// 录着的话集合清空，报一次空的
func (r *recorder) reset() []event {
	events := r.hotkeys.reset()
	r.others, r.masked = map[keyID]bool{}, false
	if len(r.recorded) == 0 {
		return events
	}
	r.recorded = map[keyID]bool{}
	return append(events, r.snapshot())
}

// 钩子交来的一个键盘事件：录键期间的、离开后还要吞的归这里，别的交给匹配器
func (r *recorder) onKey(in keyInput) outcome {
	if in.ours || in.scan&fakeScanBit != 0 || virtualVKs[in.vk] {
		if r.on {
			return outcome{}
		}
		return r.hotkeys.onKey(in)
	}
	id := keyIDOf(in)
	if swallow, ok := r.others[id]; ok {
		if !in.down {
			delete(r.others, id)
		}
		out := outcome{swallow: swallow}
		r.settleMask(&out, id, in.down)
		return out
	}
	if !r.on {
		return r.hotkeys.onKey(in)
	}
	var out outcome
	switch {
	case in.down:
		out.swallow = true
		if !r.recorded[id] {
			r.recorded[id] = true
			out.events = []event{r.snapshot()}
		}
	case r.recorded[id]:
		out.swallow = true
		delete(r.recorded, id)
		out.events = []event{r.snapshot()}
	}
	// 剩下的是按下在进入前、匹配器也不知道的键松开了：原样放行
	r.settleMask(&out, id, in.down)
	return out
}

// 吞了键时 Alt 或 Win 还按着、而它们的按下系统看到了：系统看到的就是 Alt、Win 单按了一下，松开时会开菜单。
// 录键期间这样的 Alt、Win 是进入前就按着、原样放行的那些；离开以后是匹配器那边按着的，交给它插（它也记着插没插过）
func (r *recorder) settleMask(out *outcome, id keyID, down bool) {
	if !r.on {
		r.hotkeys.settleMask(out, id, down)
		return
	}
	held := false
	for id, swallow := range r.others {
		held = held || (!swallow && id.isModifier() && menuVKs[uint32(id&^modifierBit)])
	}
	if !held {
		r.masked = false
		return
	}
	if r.masked || !out.swallow {
		return
	}
	out.mask, r.masked = true, true
}

// 录到的集合：修饰键报分左右的 vk，别的键报扫描码（扩展键带 0xE000），和 bind 的写法一样；各自升序
func (r *recorder) snapshot() event {
	mods, keys := []uint32{}, []uint32{}
	for id := range r.recorded {
		if id.isModifier() {
			mods = append(mods, uint32(id&^modifierBit))
		} else {
			keys = append(keys, uint32(id))
		}
	}
	slices.Sort(mods)
	slices.Sort(keys)
	return event{"event": "recording", "on": true, "mods": mods, "keys": keys}
}
