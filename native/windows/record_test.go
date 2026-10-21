package main

import (
	"reflect"
	"testing"
)

// 测试里用到的几个键：vk、扫描码、扩展位，同真键盘
var (
	rCtrl  = keyInput{vk: vkRControl, scan: 0x1D, extended: true}
	rAlt   = keyInput{vk: vkRMenu, scan: 0x38, extended: true}
	lAlt   = keyInput{vk: vkLMenu, scan: 0x38}
	rShift = keyInput{vk: vkRShift, scan: 0x36}
	lWin   = keyInput{vk: vkLWin, scan: 0x5B, extended: true}
	f13    = keyInput{vk: 0x7C, scan: 0x64}
	space  = keyInput{vk: 0x20, scan: 0x39}
	escape = keyInput{vk: 0x1B, scan: 0x01}
	arrow  = keyInput{vk: 0x26, scan: 0x48, extended: true} // 上箭头
	tab    = keyInput{vk: 0x09, scan: 0x0F}
)

// 测试用的键盘：记着哪些键物理上还按着，系统接口（GetAsyncKeyState）照这个答
type testKeys struct {
	*recorder
	held map[keyID]bool
}

// 录键接在一个装好了绑定的匹配器前面
func newTestKeys(bindings ...binding) *testKeys {
	k := &testKeys{held: map[keyID]bool{}}
	m := newMatcher(func(id keyID, _ heldKey) bool { return k.held[id] })
	m.bind(bindings)
	k.recorder = newRecorder(m)
	return k
}

// 按下、松开一个键，t 是钩子给的毫秒时间
func (k *testKeys) down(in keyInput, t uint32) outcome {
	in.down, in.time = true, t
	k.held[keyIDOf(in)] = true
	return k.onKey(in)
}

func (k *testKeys) up(in keyInput, t uint32) outcome {
	in.down, in.time = false, t
	delete(k.held, keyIDOf(in))
	return k.onKey(in)
}

func recordingSet(mods, keys []uint32) event {
	if mods == nil {
		mods = []uint32{}
	}
	if keys == nil {
		keys = []uint32{}
	}
	return event{"event": "recording", "on": true, "mods": mods, "keys": keys}
}

var (
	emptySet     = recordingSet(nil, nil)
	recordingOff = event{"event": "recording", "on": false}
)

func bindingDown(id string) event { return event{"event": "binding", "id": id, "down": true} }
func bindingUp(id string) event   { return event{"event": "binding", "id": id, "down": false} }

// 比较时两边都过一遍 JSON（normalized 在 matcher_test.go）：[] 和 null 分得开
func expectEvents(t *testing.T, what string, got []event, want ...event) {
	t.Helper()
	if !reflect.DeepEqual(normalized(got), normalized(want)) {
		t.Fatalf("%s：报的是 %v，应为 %v", what, got, want)
	}
}

func expectOutcome(t *testing.T, what string, got outcome, swallow bool, want ...event) {
	t.Helper()
	if got.swallow != swallow {
		t.Fatalf("%s：吞不吞得到 %v，应为 %v", what, got.swallow, swallow)
	}
	expectEvents(t, what, got.events, want...)
}

// 进入先报一次空的集合；mods、keys 写成 []，不写成 null
func TestRecordStartsWithAnEmptySet(t *testing.T) {
	r := newTestKeys()
	events := r.record(true)
	if len(events) != 1 || string(encodeEvent(events[0])) != `{"event":"recording","keys":[],"mods":[],"on":true}`+"\n" {
		t.Fatalf("进入：%v", events)
	}
}

// 集合每变一次报一次：修饰键报 vk、别的键报扫描码，各自升序；录到的键整段吞掉，修饰键也吞
func TestRecordReportsTheSetEachTimeItChangesAndSwallowsEveryRecordedKey(t *testing.T) {
	r := newTestKeys()
	r.record(true)
	expectOutcome(t, "按下右 Ctrl", r.down(rCtrl, 1), true, recordingSet([]uint32{0xA3}, nil))
	expectOutcome(t, "再按下右 Shift", r.down(rShift, 2), true, recordingSet([]uint32{0xA1, 0xA3}, nil))
	expectOutcome(t, "再按下 F13", r.down(f13, 3), true, recordingSet([]uint32{0xA1, 0xA3}, []uint32{0x64}))
	expectOutcome(t, "再按下空格", r.down(space, 4), true, recordingSet([]uint32{0xA1, 0xA3}, []uint32{0x39, 0x64}))
	// 自动重复不改集合，照样吞
	expectOutcome(t, "F13 自动重复", r.down(f13, 5), true)
	expectOutcome(t, "右 Ctrl 自动重复", r.down(rCtrl, 6), true)
	expectOutcome(t, "松开 F13", r.up(f13, 7), true, recordingSet([]uint32{0xA1, 0xA3}, []uint32{0x39}))
	expectOutcome(t, "松开右 Ctrl", r.up(rCtrl, 8), true, recordingSet([]uint32{0xA1}, []uint32{0x39}))
	expectOutcome(t, "松开空格", r.up(space, 9), true, recordingSet([]uint32{0xA1}, nil))
	expectOutcome(t, "松开右 Shift", r.up(rShift, 10), true, emptySet)
	// 松开以后再按，又算进去
	expectOutcome(t, "再按 F13", r.down(f13, 11), true, recordingSet(nil, []uint32{0x64}))
}

// 原生码和 bind 的写法一样：扩展键带 0xE000，Win 键是分左右的 vk
func TestRecordReportsExtendedKeysWithE0AndWinAsAModifier(t *testing.T) {
	r := newTestKeys()
	r.record(true)
	expectOutcome(t, "按下左 Win", r.down(lWin, 1), true, recordingSet([]uint32{0x5B}, nil))
	expectOutcome(t, "按下上箭头", r.down(arrow, 2), true, recordingSet([]uint32{0x5B}, []uint32{0xE048}))
}

// 录键期间匹配器停着：凑成绑定的键不报 binding、不打断谁，截着时的取消键也不认
func TestRecordingPausesTheMatcher(t *testing.T) {
	r := newTestKeys(
		binding{ID: "dictate#0", Mods: []uint32{vkRControl}},
		binding{ID: "x#0", Mods: []uint32{vkRControl}, Key: 0x64, HasKey: true},
		binding{ID: "cancel#0", Mods: []uint32{}, Key: 0x01, HasKey: true, Capturing: true},
	)
	r.hotkeys.setCapturing(true)
	r.record(true)
	expectOutcome(t, "按下右 Ctrl", r.down(rCtrl, 1), true, recordingSet([]uint32{0xA3}, nil))
	expectOutcome(t, "再按下 F13", r.down(f13, 2), true, recordingSet([]uint32{0xA3}, []uint32{0x64}))
	expectOutcome(t, "再按下 esc", r.down(escape, 3), true, recordingSet([]uint32{0xA3}, []uint32{0x01, 0x64}))
	expectOutcome(t, "松开 esc", r.up(escape, 4), true, recordingSet([]uint32{0xA3}, []uint32{0x64}))
	expectOutcome(t, "松开 F13", r.up(f13, 5), true, recordingSet([]uint32{0xA3}, nil))
	expectOutcome(t, "松开右 Ctrl", r.up(rCtrl, 6), true, emptySet)
	// 离开以后照常认
	expectEvents(t, "离开", r.record(false), recordingOff)
	expectOutcome(t, "离开以后按右 Ctrl", r.down(rCtrl, 7), false, bindingDown("dictate#0"))
	expectOutcome(t, "离开以后截着时按 esc", r.down(escape, 8), true, bindingDown("cancel#0"))
}

// 进入时按着的绑定先补报松开，再报空的集合；离开时匹配器再从头认一次
func TestEnteringReleasesTheHeldBindingBeforeTheEmptySet(t *testing.T) {
	r := newTestKeys(binding{ID: "dictate#0", Mods: []uint32{vkRMenu}})
	expectOutcome(t, "按下右 Alt", r.down(rAlt, 1), false, bindingDown("dictate#0"))
	expectEvents(t, "进入", r.record(true), bindingUp("dictate#0"), emptySet)
	// 进入前就按着的右 Alt：自动重复、松开都原样放行，不改集合；匹配器也不再报它的松开
	expectOutcome(t, "右 Alt 自动重复", r.down(rAlt, 2), false)
	expectOutcome(t, "松开右 Alt", r.up(rAlt, 3), false)
	expectEvents(t, "离开", r.record(false), recordingOff)
	expectOutcome(t, "离开以后再按右 Alt", r.down(rAlt, 4), false, bindingDown("dictate#0"))
}

// 进入前就按着的键（比如用快捷键打开了设置）不算：它的自动重复、松开原样放行，不改集合
func TestKeysHeldBeforeEnteringAreNotRecordedAndPassThrough(t *testing.T) {
	r := newTestKeys()
	r.down(rShift, 1)
	r.down(space, 2)
	expectEvents(t, "进入", r.record(true), emptySet)
	expectOutcome(t, "空格自动重复", r.down(space, 3), false)
	expectOutcome(t, "按下 F13", r.down(f13, 4), true, recordingSet(nil, []uint32{0x64}))
	expectOutcome(t, "松开右 Shift", r.up(rShift, 5), false)
	expectOutcome(t, "松开空格", r.up(space, 6), false)
	// 松开以后再按，就是进入以后按下的了
	expectOutcome(t, "再按右 Shift", r.down(rShift, 7), true, recordingSet([]uint32{0xA1}, []uint32{0x64}))
}

// 进入前就按着、离开时还按着的键：离开以后交回匹配器，和之后按的键一起凑组合，松开也照常报
func TestKeysHeldBeforeEnteringGoBackToTheMatcherWhenLeaving(t *testing.T) {
	r := newTestKeys(binding{ID: "x#0", Mods: []uint32{vkRShift}, Key: 0x64, HasKey: true})
	r.down(rShift, 1)
	r.record(true)
	r.record(false)
	expectOutcome(t, "离开以后按 F13", r.down(f13, 2), true, bindingDown("x#0"))
	expectOutcome(t, "松开右 Shift", r.up(rShift, 3), false)
	expectOutcome(t, "松开 F13", r.up(f13, 4), true, bindingUp("x#0"))
}

// 进入前按着、松开却丢了的键（比如切进了管理员窗口）：系统说它已经松开，录键时再按就算进去
func TestKeyWhoseReleaseWasLostBeforeEnteringIsRecordedWhenPressedAgain(t *testing.T) {
	r := newTestKeys()
	r.down(tab, 1)
	delete(r.held, keyIDOf(tab))
	r.record(true)
	expectOutcome(t, "再按 Tab", r.down(tab, 2), true, recordingSet(nil, []uint32{0x0F}))
}

// 进入前匹配器吞了按下的键：接着吞到松开，不留"吞了按下、放了松开"的半截，也不算进集合
func TestKeyTheMatcherSwallowedBeforeEnteringStaysSwallowedUntilReleased(t *testing.T) {
	// 系统接口照真系统说：吞掉的普通键没按着（低级钩子吞了，系统就不更新它的状态）
	r := &testKeys{held: map[keyID]bool{}}
	m := newMatcher(func(id keyID, _ heldKey) bool { return id.isModifier() && r.held[id] })
	m.bind([]binding{
		{ID: "x#0", Mods: []uint32{}, Key: 0x64, HasKey: true},
		{ID: "cancel#0", Mods: []uint32{}, Key: 0x01, HasKey: true, Capturing: true},
	})
	r.recorder = newRecorder(m)
	expectOutcome(t, "按下 F13", r.down(f13, 1), true, bindingDown("x#0"))
	m.setCapturing(true)
	expectOutcome(t, "截着时按下 esc", r.down(escape, 2), true, bindingDown("cancel#0"))
	expectEvents(t, "进入", r.record(true), bindingUp("x#0"), emptySet)
	expectOutcome(t, "F13 自动重复", r.down(f13, 3), true)
	expectOutcome(t, "esc 自动重复", r.down(escape, 4), true)
	expectOutcome(t, "松开 F13", r.up(f13, 5), true)
	expectOutcome(t, "松开 esc", r.up(escape, 6), true)
	expectOutcome(t, "再按 F13", r.down(f13, 7), true, recordingSet(nil, []uint32{0x64}))
}

// 离开时还按着的录到的键：之后的自动重复、松开照样吞到松开为止，也不喂匹配器（F13 的自动重复不能当成新按的 x#0）
func TestKeysStillHeldWhenLeavingStaySwallowedUntilReleased(t *testing.T) {
	r := newTestKeys(
		binding{ID: "dictate#0", Mods: []uint32{vkRControl}},
		binding{ID: "x#0", Mods: []uint32{}, Key: 0x64, HasKey: true},
	)
	r.record(true)
	r.down(rCtrl, 1)
	r.down(f13, 2)
	expectEvents(t, "离开", r.record(false), recordingOff)
	expectOutcome(t, "F13 自动重复", r.down(f13, 3), true)
	expectOutcome(t, "右 Ctrl 自动重复", r.down(rCtrl, 4), true)
	// 这期间别的键照常交给匹配器
	expectOutcome(t, "按下空格", r.down(space, 5), false)
	expectOutcome(t, "松开空格", r.up(space, 6), false)
	expectOutcome(t, "松开 F13", r.up(f13, 7), true)
	expectOutcome(t, "松开右 Ctrl", r.up(rCtrl, 8), true)
	// 都松开了：之后照常认、照常放行
	expectOutcome(t, "再按右 Ctrl", r.down(rCtrl, 9), false, bindingDown("dictate#0"))
	expectOutcome(t, "松开右 Ctrl", r.up(rCtrl, 10), false, bindingUp("dictate#0"))
	expectOutcome(t, "再按 F13", r.down(f13, 11), true, bindingDown("x#0"))
}

// 没在录时让停：什么也不报，匹配器也不动（按着的绑定照常松开）
func TestLeavingWhenNotRecordingReportsNothing(t *testing.T) {
	r := newTestKeys(binding{ID: "dictate#0", Mods: []uint32{vkRMenu}})
	r.down(rAlt, 1)
	if events := r.record(false); events != nil {
		t.Fatalf("没在录时让停：%v", events)
	}
	expectOutcome(t, "松开右 Alt", r.up(rAlt, 2), false, bindingUp("dictate#0"))
}

// 已经在录时再让录：从头录。清空集合、再报一次空的；还按着的照样吞到松开，不算进新的集合
func TestStartingAgainWhileRecordingClearsTheSet(t *testing.T) {
	r := newTestKeys(binding{ID: "dictate#0", Mods: []uint32{vkRControl}})
	r.record(true)
	r.down(f13, 1)
	expectEvents(t, "再进入", r.record(true), emptySet)
	expectOutcome(t, "F13 自动重复", r.down(f13, 2), true)
	expectOutcome(t, "松开 F13", r.up(f13, 3), true)
	expectOutcome(t, "再按 F13", r.down(f13, 4), true, recordingSet(nil, []uint32{0x64}))
	// 匹配器还停着
	expectOutcome(t, "按下右 Ctrl", r.down(rCtrl, 5), true, recordingSet([]uint32{0xA3}, []uint32{0x64}))
}

// 自己模拟的、驱动补的假修饰键、不是物理键的 vk：不算，原样放行
func TestOwnFakeAndVirtualKeysAreNotRecorded(t *testing.T) {
	r := newTestKeys(binding{ID: "x#0", Mods: []uint32{}, Key: 0x64, HasKey: true})
	r.record(true)
	ours := f13
	ours.ours = true
	expectOutcome(t, "自己模拟的 F13", r.down(ours, 1), false)
	expectOutcome(t, "自己模拟的 F13 松开", r.up(ours, 1), false)
	// AltGr：驱动先补一个假的左 Ctrl（扫描码带 0x200），再是右 Alt
	fakeCtrl := keyInput{vk: vkLControl, scan: 0x21D}
	expectOutcome(t, "假的左 Ctrl", r.down(fakeCtrl, 2), false)
	expectOutcome(t, "右 Alt", r.down(rAlt, 3), true, recordingSet([]uint32{0xA5}, nil))
	// VK_PACKET：扫描码那一栏是字符 '9'，正好是空格的扫描码
	packet := keyInput{vk: 0xE7, scan: 0x39}
	expectOutcome(t, "VK_PACKET", r.down(packet, 4), false)
	expectOutcome(t, "VK_PACKET 松开", r.up(packet, 5), false)
	expectOutcome(t, "假的左 Ctrl 松开", r.up(fakeCtrl, 6), false)
}

// 没见过按下的键松开了（按下在进入前、匹配器也不知道）：原样放行
func TestReleaseOfAKeyNeverSeenGoingDownPassesThrough(t *testing.T) {
	r := newTestKeys()
	r.record(true)
	expectOutcome(t, "松开空格", r.up(space, 1), false)
}

// 进入前就按着、原样放行的 Alt：录键吞了键的话，系统看到的是 Alt 单按了一下，松开会进菜单模式。插一次掩码键
func TestAltPassedThroughWhileRecordingGetsOneMask(t *testing.T) {
	r := newTestKeys()
	r.down(lAlt, 1)
	r.record(true)
	if out := r.down(f13, 2); !out.swallow || !out.mask {
		t.Fatalf("Alt 按着时吞了 F13，要插掩码：%+v", out)
	}
	if out := r.down(f13, 3); !out.swallow || out.mask {
		t.Fatalf("一次按住只插一次：%+v", out)
	}
	if out := r.up(f13, 4); !out.swallow || out.mask {
		t.Fatalf("一次按住只插一次：%+v", out)
	}
	if out := r.up(lAlt, 5); out.swallow || out.mask {
		t.Fatalf("Alt 的松开原样放行：%+v", out)
	}
	if out := r.down(f13, 6); !out.swallow || out.mask {
		t.Fatalf("Alt 松开以后吞键不用插：%+v", out)
	}
	// 录到的 Alt 整段吞了，系统根本没看到它，不用插
	if out := r.down(lAlt, 7); !out.swallow || out.mask {
		t.Fatalf("录到的 Alt：%+v", out)
	}
	if out := r.up(f13, 8); !out.swallow || out.mask {
		t.Fatalf("录到的 Alt 按着时吞键：%+v", out)
	}
}

// 离开以后才按下的 Alt 按着时，吞了录到的键的松开：同样要插掩码（Alt 由匹配器管着）
func TestReleaseSwallowedAfterLeavingWhileAltIsHeldGetsAMask(t *testing.T) {
	r := newTestKeys()
	r.record(true)
	r.down(f13, 1)
	r.record(false)
	if out := r.down(lAlt, 2); out.swallow || out.mask {
		t.Fatalf("离开以后按 Alt：%+v", out)
	}
	if out := r.up(f13, 3); !out.swallow || !out.mask {
		t.Fatalf("吞了 F13 的松开，要插掩码：%+v", out)
	}
}

// 钩子重装、睡眠唤醒、解锁：这段时间的松开多半丢了。录着的话清空集合、报一次空的；离开后还要吞的也不吞了
func TestResetForgetsWhatWasRecorded(t *testing.T) {
	r := newTestKeys()
	r.record(true)
	r.down(f13, 1)
	expectEvents(t, "重装钩子", r.reset(), emptySet)
	expectOutcome(t, "F13 松开（按下在重装前）", r.up(f13, 2), false)
	if events := r.reset(); events != nil {
		t.Fatalf("集合本来就是空的，不用再报：%v", events)
	}
	r.down(f13, 3)
	r.record(false)
	r.reset()
	expectOutcome(t, "离开、重装以后 F13 自动重复", r.down(f13, 4), false)
}

// 不在录：照旧是匹配器从头认，按着的绑定补报松开
func TestResetWhenNotRecordingReleasesTheHeldBinding(t *testing.T) {
	r := newTestKeys(binding{ID: "dictate#0", Mods: []uint32{vkRMenu}})
	r.down(rAlt, 1)
	expectEvents(t, "重装钩子", r.reset(), bindingUp("dictate#0"))
}
