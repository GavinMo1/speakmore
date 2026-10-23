package main

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"unicode/utf16"
)

func TestSelectionEventCarriesTextAndRect(t *testing.T) {
	got := selectionEvent(7, selection{Text: "你好", Rect: &screenRect{X: 10, Y: 20, Width: 300, Height: 40}, Via: "uia"})
	want := event{"event": "selection", "id": 7, "text": "你好", "via": "uia",
		"rect": map[string]float64{"x": 10, "y": 20, "width": 300, "height": 40}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v", got)
	}
	var back map[string]any
	if err := json.Unmarshal(encodeEvent(got), &back); err != nil || back["rect"].(map[string]any)["width"] != float64(300) {
		t.Fatalf("%v %v", back, err)
	}
}

func TestEmptySelectionSaysWhyAndCarriesNoRect(t *testing.T) {
	got := selectionEvent(3, selection{Rect: &screenRect{Width: 1, Height: 1}, Via: "copy", Reason: "none"})
	want := event{"event": "selection", "id": 3, "text": "", "via": "copy", "reason": "none"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v", got)
	}
	// 没写原因的空选区按"没选中"报：父进程总能拿到一个原因
	if got := selectionEvent(4, selection{Via: "uia"}); got["reason"] != "none" {
		t.Fatalf("got %#v", got)
	}
	// 选到了字就不带原因（拿 UIA 时没成、后来复制拿到的）
	if got := selectionEvent(5, selection{Text: "x", Via: "copy", Reason: "failed"}); got["reason"] != nil {
		t.Fatalf("got %#v", got)
	}
}

func TestLongSelectionIsCutWithoutSplittingASurrogatePair(t *testing.T) {
	long := strings.Repeat("a", 65535) + "😀" + "tail"
	cut := clipUTF16(long, 65536)
	if units := len(utf16.Encode([]rune(cut))); units > 65536 {
		t.Fatalf("还有 %d 个单元", units)
	}
	if !strings.HasSuffix(cut, "a") || strings.ContainsRune(cut, '�') {
		t.Fatal("代理对被劈开了")
	}
	if clipUTF16("短的", 65536) != "短的" {
		t.Fatal("短的不该动")
	}
}

func TestUnionOfBoundingRectangles(t *testing.T) {
	// UIA 的 GetBoundingRectangles：每 4 个一组 left、top、width、height。两行的选区
	got, ok := unionRects([]float64{100, 200, 300, 20, 50, 220, 120, 20})
	if !ok || got != (screenRect{X: 50, Y: 200, Width: 350, Height: 40}) {
		t.Fatalf("got %+v %v", got, ok)
	}
	// 空的、宽高为 0 的（折叠的选区、屏幕外）不算；没有剩下的就是不知道位置
	if _, ok := unionRects(nil); ok {
		t.Fatal("空的也给了位置")
	}
	if _, ok := unionRects([]float64{1, 2, 0, 0}); ok {
		t.Fatal("宽高为 0 也给了位置")
	}
	// 不是 4 的倍数的尾巴不管
	if got, ok := unionRects([]float64{1, 2, 3, 4, 9}); !ok || got != (screenRect{X: 1, Y: 2, Width: 3, Height: 4}) {
		t.Fatalf("got %+v %v", got, ok)
	}
}
