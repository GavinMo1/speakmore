package main

import (
	"reflect"
	"testing"
)

func TestClickCountsOnlyWhenPressedAndReleasedInTheSameRegion(t *testing.T) {
	var c clickCapture
	c.setCapturing(true, []region{{ID: "cancel", X: 100, Y: 100, Width: 28, Height: 28}, {ID: "done", X: 140, Y: 100, Width: 28, Height: 28}}, false)
	if out := c.onLeftButton(true, 110, 110); !out.swallow {
		t.Fatal("按在按钮上要吞掉")
	}
	if out := c.onLeftButton(false, 111, 111); !out.swallow || !reflect.DeepEqual(out.events, []event{{"event": "click", "id": "cancel"}}) {
		t.Fatalf("松开：%+v", out)
	}
	// 按下之后拖到另一块再松手：反悔，不报，但松开照样吞掉
	c.onLeftButton(true, 110, 110)
	if out := c.onLeftButton(false, 150, 110); !out.swallow || len(out.events) != 0 {
		t.Fatalf("拖走：%+v", out)
	}
	// 右、下边不算在里面
	if out := c.onLeftButton(true, 128, 110); out.swallow {
		t.Fatal("右边界算进去了")
	}
	// 不在任何一块里的点击原样放行
	if out := c.onLeftButton(true, 10, 10); out.swallow {
		t.Fatal("块外的点击被吞了")
	}
}

func TestClickReleasedAfterCaptureEndedIsSwallowedButNotReported(t *testing.T) {
	var c clickCapture
	c.setCapturing(true, []region{{ID: "done", X: 0, Y: 0, Width: 10, Height: 10}}, false)
	c.onLeftButton(true, 5, 5)
	c.setCapturing(false, nil, false)
	if !c.wantsHook() {
		t.Fatal("按下吞了还没松开，鼠标钩子要留着")
	}
	if out := c.onLeftButton(false, 5, 5); !out.swallow || len(out.events) != 0 {
		t.Fatalf("got %+v", out)
	}
	if c.wantsHook() {
		t.Fatal("松开之后不该再截")
	}
	if out := c.onLeftButton(true, 5, 5); out.swallow {
		t.Fatal("不截时的点击被吞了")
	}
}

// 鼠标钩子只在截着、或者吞了的那一下还没松开时装着：不截的时候全系统的鼠标不用先过我们这里
func TestMouseHookIsWantedOnlyWhileCapturing(t *testing.T) {
	var c clickCapture
	if c.wantsHook() {
		t.Fatal("还没截就要装鼠标钩子")
	}
	c.setCapturing(true, nil, false)
	if !c.wantsHook() {
		t.Fatal("截着时（悬浮条上没画按钮也一样）要装鼠标钩子")
	}
	c.setCapturing(false, nil, false)
	if c.wantsHook() {
		t.Fatal("不截了、也没有按着的，还要鼠标钩子")
	}
}

// 划词卡片开着时（capture 带 outside）：块外按下报一次 outside、照常放行，块里的照旧吞、照旧报
func TestOutsideClickIsReportedAndPassedThroughWhenAsked(t *testing.T) {
	var c clickCapture
	c.setCapturing(true, []region{{ID: "copy", X: 100, Y: 100, Width: 40, Height: 20}}, true)
	if out := c.onLeftButton(true, 10, 10); out.swallow || !reflect.DeepEqual(out.events, []event{{"event": "click", "id": "outside"}}) {
		t.Fatalf("块外按下：%+v", out)
	}
	// 块外的那一下松开不再报、也不吞
	if out := c.onLeftButton(false, 10, 10); out.swallow || len(out.events) != 0 {
		t.Fatalf("块外松开：%+v", out)
	}
	if out := c.onLeftButton(true, 110, 110); !out.swallow || len(out.events) != 0 {
		t.Fatalf("块里按下：%+v", out)
	}
	if out := c.onLeftButton(false, 110, 110); !out.swallow || !reflect.DeepEqual(out.events, []event{{"event": "click", "id": "copy"}}) {
		t.Fatalf("块里松开：%+v", out)
	}
	// 不截了就不报
	c.setCapturing(false, nil, false)
	if out := c.onLeftButton(true, 10, 10); out.swallow || len(out.events) != 0 {
		t.Fatalf("不截了：%+v", out)
	}
}

// 悬浮条用的那种（不带 outside）：块外的点击和以前一样，不报也不吞
func TestOutsideClickIsSilentByDefault(t *testing.T) {
	var c clickCapture
	c.setCapturing(true, []region{{ID: "cancel", X: 100, Y: 100, Width: 28, Height: 28}}, false)
	if out := c.onLeftButton(true, 10, 10); out.swallow || len(out.events) != 0 {
		t.Fatalf("got %+v", out)
	}
}
