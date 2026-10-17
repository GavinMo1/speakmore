package main

import (
	"reflect"
	"testing"
)

func newState(hotkey string) *keyState { return &keyState{hotkey: hotkeys[hotkey]} }

func key(vk uint32, down bool) keyInput { return keyInput{vk: vk, down: down} }

func eventsOf(outs ...outcome) []event {
	var all []event
	for _, out := range outs {
		all = append(all, out.events...)
	}
	return all
}

func TestHotkeyDownUpReportedOnceEachDespiteAutoRepeat(t *testing.T) {
	s := newState("right_control")
	got := eventsOf(s.onKey(key(vkRControl, true)), s.onKey(key(vkRControl, true)), s.onKey(key(vkRControl, false)))
	want := []event{{"event": "hotkey", "down": true}, {"event": "hotkey", "down": false}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestOtherKeyWhileHeldReportedOnceWithoutNamingTheKey(t *testing.T) {
	s := newState("right_control")
	s.onKey(key(vkRControl, true))
	got := eventsOf(s.onKey(key('A', true)), s.onKey(key('A', false)), s.onKey(key('B', true)))
	if want := []event{{"event": "other_key"}}; !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	// 下一次按住重新算
	s.onKey(key(vkRControl, false))
	s.onKey(key(vkRControl, true))
	if got := eventsOf(s.onKey(key('C', true))); len(got) != 1 {
		t.Fatalf("新的一次按住没有报 other_key：%v", got)
	}
}

func TestKeysWithoutHotkeyHeldAreNotReportedOrSwallowed(t *testing.T) {
	s := newState("right_alt")
	for _, in := range []keyInput{key('A', true), key('A', false), key(vkEscape, true), key(vkEscape, false)} {
		if out := s.onKey(in); out.swallow || len(out.events) != 0 {
			t.Fatalf("%v：%+v", in, out)
		}
	}
}

func TestRightAltAsksForMaskKeySoMenusDoNotOpen(t *testing.T) {
	s := newState("right_alt")
	if out := s.onKey(key(vkRMenu, true)); !out.mask {
		t.Fatal("按下右 Alt 时没要求插一下 vkMask")
	}
	if out := s.onKey(key(vkRMenu, false)); out.mask {
		t.Fatal("松开时不用插")
	}
	c := newState("right_control")
	if out := c.onKey(key(vkRControl, true)); out.mask {
		t.Fatal("右 Ctrl 单按没有副作用，不用插")
	}
}

func TestOurOwnInjectedKeysAndAltGrFakeCtrlAreNotOtherKeys(t *testing.T) {
	s := newState("right_alt")
	s.onKey(key(vkRMenu, true))
	got := eventsOf(
		s.onKey(keyInput{vk: vkMask, down: true, ours: true}),
		s.onKey(keyInput{vk: vkMask, down: false, ours: true}),
		// AltGr 布局下按住右 Alt，系统跟着自动重复那个假的左 Ctrl
		s.onKey(keyInput{vk: vkLControl, scan: altGrFakeCtrlScan, down: true}),
	)
	if len(got) != 0 {
		t.Fatalf("got %v", got)
	}
	// 真的左 Ctrl 是别的键
	if got := eventsOf(s.onKey(keyInput{vk: vkLControl, scan: 0x1D, down: true})); len(got) != 1 {
		t.Fatalf("真的左 Ctrl 没算成别的键：%v", got)
	}
}

func TestEscapeSwallowedOnlyWhileCapturingAndHeldPressIsSwallowedToTheEnd(t *testing.T) {
	s := newState("right_alt")
	s.setCapturing(true, nil)
	down := s.onKey(key(vkEscape, true))
	if !down.swallow || !reflect.DeepEqual(down.events, []event{{"event": "escape"}}) {
		t.Fatalf("截着时按 esc：%+v", down)
	}
	// 长按的重复不再报
	if out := s.onKey(key(vkEscape, true)); !out.swallow || len(out.events) != 0 {
		t.Fatalf("重复：%+v", out)
	}
	// 取消了，父进程说不截了，手还没松
	s.setCapturing(false, nil)
	if out := s.onKey(key(vkEscape, true)); !out.swallow {
		t.Fatal("不截了之后、松开之前的重复要吞掉")
	}
	if out := s.onKey(key(vkEscape, false)); !out.swallow {
		t.Fatal("松开要吞掉，不然前台应用收到半个事件")
	}
	// 之后的 esc 和我们无关了
	if out := s.onKey(key(vkEscape, true)); out.swallow {
		t.Fatal("不截时的新一下 esc 被吞了")
	}
}

func TestEscapeWhileHotkeyHeldAndCapturingIsNotAnOtherKey(t *testing.T) {
	s := newState("right_alt")
	s.onKey(key(vkRMenu, true))
	s.setCapturing(true, nil)
	got := eventsOf(s.onKey(key(vkEscape, true)))
	if want := []event{{"event": "escape"}}; !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestClickCountsOnlyWhenPressedAndReleasedInTheSameRegion(t *testing.T) {
	s := newState("right_alt")
	s.setCapturing(true, []region{{ID: "cancel", X: 100, Y: 100, Width: 28, Height: 28}, {ID: "done", X: 140, Y: 100, Width: 28, Height: 28}})
	if out := s.onLeftButton(true, 110, 110); !out.swallow {
		t.Fatal("按在按钮上要吞掉")
	}
	if out := s.onLeftButton(false, 111, 111); !out.swallow || !reflect.DeepEqual(out.events, []event{{"event": "click", "id": "cancel"}}) {
		t.Fatalf("松开：%+v", out)
	}
	// 按下之后拖到另一块再松手：反悔，不报，但松开照样吞掉
	s.onLeftButton(true, 110, 110)
	if out := s.onLeftButton(false, 150, 110); !out.swallow || len(out.events) != 0 {
		t.Fatalf("拖走：%+v", out)
	}
	// 右、下边不算在里面
	if out := s.onLeftButton(true, 128, 110); out.swallow {
		t.Fatal("右边界算进去了")
	}
	// 不在任何一块里的点击原样放行
	if out := s.onLeftButton(true, 10, 10); out.swallow {
		t.Fatal("块外的点击被吞了")
	}
}

func TestClickReleasedAfterCaptureEndedIsSwallowedButNotReported(t *testing.T) {
	s := newState("right_alt")
	s.setCapturing(true, []region{{ID: "done", X: 0, Y: 0, Width: 10, Height: 10}})
	s.onLeftButton(true, 5, 5)
	s.setCapturing(false, nil)
	if !s.wantsCapture() {
		t.Fatal("按下吞了还没松开，鼠标钩子要留着")
	}
	if out := s.onLeftButton(false, 5, 5); !out.swallow || len(out.events) != 0 {
		t.Fatalf("got %+v", out)
	}
	if s.wantsCapture() {
		t.Fatal("松开之后不该再截")
	}
	if out := s.onLeftButton(true, 5, 5); out.swallow {
		t.Fatal("不截时的点击被吞了")
	}
}
