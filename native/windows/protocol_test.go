package main

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestParsesTheThreeCommands(t *testing.T) {
	paste, err := parseCommand([]byte(`{"cmd":"paste","id":3,"text":"你好\n世界"}`))
	if err != nil || paste.Cmd != "paste" || *paste.ID != 3 || *paste.Text != "你好\n世界" {
		t.Fatalf("paste：%+v %v", paste, err)
	}
	capture, err := parseCommand([]byte(`{"cmd":"capture","regions":[{"id":"cancel","x":1.5,"y":2,"width":28,"height":28}]}`))
	if err != nil {
		t.Fatal(err)
	}
	regions, err := parseRegions(capture.Regions)
	if err != nil || len(regions) != 1 || regions[0] != (region{ID: "cancel", X: 1.5, Y: 2, Width: 28, Height: 28}) {
		t.Fatalf("regions：%+v %v", regions, err)
	}
	release, err := parseCommand([]byte(`{"cmd":"release"}`))
	if err != nil || release.Cmd != "release" {
		t.Fatalf("release：%+v %v", release, err)
	}
}

func TestRejectsLinesItCannotRead(t *testing.T) {
	for _, line := range []string{"", "not json", `{"id":1}`, `[]`} {
		if _, err := parseCommand([]byte(line)); err == nil {
			t.Fatalf("%q 没被拒绝", line)
		}
	}
}

func TestRejectsRegionsWithMissingFieldsOrNoArea(t *testing.T) {
	for _, raw := range []string{
		``,
		`null`,
		`{}`,
		`[{"x":0,"y":0,"width":1,"height":1}]`,
		`[{"id":"a","y":0,"width":1,"height":1}]`,
		`[{"id":"a","x":0,"y":0,"width":0,"height":1}]`,
		`[{"id":"a","x":0,"y":0,"width":1,"height":-1}]`,
	} {
		if _, err := parseRegions(json.RawMessage(raw)); err == nil {
			t.Fatalf("%q 没被拒绝", raw)
		}
	}
	// 空的一组是合法的：截 esc，不截点击（悬浮条上没画按钮时）
	if regions, err := parseRegions(json.RawMessage(`[]`)); err != nil || len(regions) != 0 {
		t.Fatalf("空的一组：%v %v", regions, err)
	}
}

func TestEventsAreOneLineOfJson(t *testing.T) {
	line := string(encodeEvent(event{"event": "pasted", "id": 1, "ok": false, "reason": "elevated"}))
	if !strings.HasSuffix(line, "\n") || strings.Count(line, "\n") != 1 {
		t.Fatalf("不是一行：%q", line)
	}
	var back map[string]any
	if err := json.Unmarshal([]byte(line), &back); err != nil || back["reason"] != "elevated" || back["id"] != float64(1) {
		t.Fatalf("%q → %v %v", line, back, err)
	}
}

// 拼一条 bind 命令，过一遍 parseCommand，拿出 bindings 那一段
func bindLine(t *testing.T, bindings string) json.RawMessage {
	t.Helper()
	cmd, err := parseCommand([]byte(`{"cmd":"bind","bindings":` + bindings + `}`))
	if err != nil || cmd.Cmd != "bind" {
		t.Fatalf("bind：%+v %v", cmd, err)
	}
	return cmd.Bindings
}

func TestBindInstallsEveryBindingThatFollowsTheRules(t *testing.T) {
	bindings, rejected, err := parseBindings(bindLine(t, `[
		{"id":"dictate#0","mods":[165],"when":"always"},
		{"id":"cancel#0","mods":[],"key":1,"when":"capturing"},
		{"id":"paste#0","mods":[162,160],"when":"always"},
		{"id":"up#0","mods":[163],"key":57416,"when":"always"},
		{"id":"byte#0","mods":[],"key":255,"when":"always"},
		{"id":"low#0","mods":[],"key":57345,"when":"always"},
		{"id":"high#0","mods":[],"key":57599,"when":"always"},
		{"id":"win#0","mods":[91],"key":null,"when":"always"}
	]`), true)
	want := []binding{
		{ID: "dictate#0", Mods: []uint32{0xA5}},
		{ID: "cancel#0", Mods: []uint32{}, Key: 1, HasKey: true, Capturing: true},
		{ID: "paste#0", Mods: []uint32{0xA2, 0xA0}},
		{ID: "up#0", Mods: []uint32{0xA3}, Key: 0xE048, HasKey: true},
		{ID: "byte#0", Mods: []uint32{}, Key: 0xFF, HasKey: true},
		{ID: "low#0", Mods: []uint32{}, Key: 0xE001, HasKey: true},
		{ID: "high#0", Mods: []uint32{}, Key: 0xE0FF, HasKey: true},
		// key 写成 null 和不写一样
		{ID: "win#0", Mods: []uint32{0x5B}},
	}
	if err != nil || len(rejected) != 0 || !reflect.DeepEqual(bindings, want) {
		t.Fatalf("得到 %+v，拒了 %+v，%v", bindings, rejected, err)
	}
	// 空的一组也合法：一个热键都不听
	if bindings, rejected, err := parseBindings(bindLine(t, `[]`), true); err != nil || len(bindings) != 0 || len(rejected) != 0 {
		t.Fatalf("空的一组：%+v %+v %v", bindings, rejected, err)
	}
}

func TestBindRejectsEachBindingThatBreaksARuleAndInstallsTheRest(t *testing.T) {
	good := `{"id":"dictate#0","mods":[165],"when":"always"}`
	for _, c := range []struct{ name, bad, id string }{
		{"id 是空的", `{"id":"","mods":[165],"when":"always"}`, ""},
		{"mods 里有不是修饰键的", `{"id":"x#0","mods":[65],"when":"always"}`, "x#0"},
		{"mods 里有不分左右的 Ctrl", `{"id":"x#0","mods":[17],"when":"always"}`, "x#0"},
		{"mods 里重复", `{"id":"x#0","mods":[165,165],"when":"always"}`, "x#0"},
		{"mods 超过两个", `{"id":"x#0","mods":[160,162,164],"when":"always"}`, "x#0"},
		{"key 是 0", `{"id":"x#0","mods":[],"key":0,"when":"always"}`, "x#0"},
		{"key 超出一个字节、又不是扩展键", `{"id":"x#0","mods":[],"key":256,"when":"always"}`, "x#0"},
		{"扩展键只有前缀", `{"id":"x#0","mods":[],"key":57344,"when":"always"}`, "x#0"},
		{"扩展键超出一个字节", `{"id":"x#0","mods":[],"key":57600,"when":"always"}`, "x#0"},
		{"一个键都没有", `{"id":"x#0","mods":[],"when":"always"}`, "x#0"},
		{"修饰键加普通键超过两个", `{"id":"x#0","mods":[162,160],"key":30,"when":"always"}`, "x#0"},
		{"capturing 没有普通键", `{"id":"x#0","mods":[],"when":"capturing"}`, "x#0"},
		{"capturing 带修饰键", `{"id":"x#0","mods":[162],"key":1,"when":"capturing"}`, "x#0"},
		{"when 不认识", `{"id":"x#0","mods":[165],"when":"sometimes"}`, "x#0"},
	} {
		t.Run(c.name, func(t *testing.T) {
			bindings, rejected, err := parseBindings(bindLine(t, "["+good+","+c.bad+"]"), true)
			if err != nil || len(bindings) != 1 || bindings[0].ID != "dictate#0" {
				t.Fatalf("合规矩的那个没装上：%+v %v", bindings, err)
			}
			if want := []rejection{{ID: c.id, Reason: "invalid"}}; !reflect.DeepEqual(rejected, want) {
				t.Fatalf("拒了 %+v，应为 %+v", rejected, want)
			}
		})
	}
}

// 事件只带 id：同一个 id 出现两次，父进程分不清是哪一个触发的，所以都不装
func TestBindRejectsEveryBindingWhoseIDIsRepeated(t *testing.T) {
	bindings, rejected, err := parseBindings(bindLine(t, `[
		{"id":"a#0","mods":[165],"when":"always"},
		{"id":"b#0","mods":[163],"when":"always"},
		{"id":"a#0","mods":[164],"when":"always"}
	]`), true)
	if err != nil || len(bindings) != 1 || bindings[0].ID != "b#0" {
		t.Fatalf("装上的：%+v %v", bindings, err)
	}
	if want := []rejection{{ID: "a#0", Reason: "invalid"}, {ID: "a#0", Reason: "invalid"}}; !reflect.DeepEqual(rejected, want) {
		t.Fatalf("拒了 %+v", rejected)
	}
}

func TestBindWithTheWrongShapeIsAnErrorAndInstallsNothing(t *testing.T) {
	for _, raw := range []string{
		``,
		`null`,
		`{}`,
		`"dictate#0"`,
		`[1]`,
		`[null]`,
		`[[]]`,
		`[{"mods":[165],"when":"always"}]`,
		`[{"id":"a#0","when":"always"}]`,
		`[{"id":"a#0","mods":null,"when":"always"}]`,
		`[{"id":"a#0","mods":[165]}]`,
		`[{"id":1,"mods":[165],"when":"always"}]`,
		`[{"id":"a#0","mods":165,"when":"always"}]`,
		`[{"id":"a#0","mods":["AltRight"],"when":"always"}]`,
		`[{"id":"a#0","mods":[-1],"when":"always"}]`,
		`[{"id":"a#0","mods":[165.5],"when":"always"}]`,
		`[{"id":"a#0","mods":[],"key":"Escape","when":"capturing"}]`,
		`[{"id":"a#0","mods":[],"key":-1,"when":"capturing"}]`,
		`[{"id":"a#0","mods":[165],"when":true}]`,
		// 前面的都对、后面一个形状不对，也整条不认：形状不对是父进程写错了，不是这一个绑定的事
		`[{"id":"a#0","mods":[165],"when":"always"},{"id":"b#0"}]`,
	} {
		t.Run(raw, func(t *testing.T) {
			bindings, rejected, err := parseBindings(json.RawMessage(raw), true)
			if err == nil || err.Error() != "bind 需要 bindings：一组 { id, mods, key?, when }" || bindings != nil || rejected != nil {
				t.Fatalf("得到 %+v %+v %v", bindings, rejected, err)
			}
		})
	}
}

// 键盘钩子没装上：合规矩的也一个都装不了；不合规矩的照样说 invalid（装上钩子也装不了它）
func TestBindWithoutKeyboardHookRejectsEveryBinding(t *testing.T) {
	bindings, rejected, err := parseBindings(bindLine(t, `[
		{"id":"dictate#0","mods":[165],"when":"always"},
		{"id":"bad#0","mods":[65],"when":"always"},
		{"id":"cancel#0","mods":[],"key":1,"when":"capturing"}
	]`), false)
	want := []rejection{{ID: "dictate#0", Reason: "needs_listen"}, {ID: "bad#0", Reason: "invalid"}, {ID: "cancel#0", Reason: "needs_listen"}}
	if err != nil || len(bindings) != 0 || !reflect.DeepEqual(rejected, want) {
		t.Fatalf("得到 %+v，拒了 %+v，%v", bindings, rejected, err)
	}
}

// 父进程按数组读 rejected：一个都没拒也要写成 []，不能是 null
func TestBoundAlwaysCarriesAnArrayOfRejections(t *testing.T) {
	_, rejected, _ := parseBindings(bindLine(t, `[{"id":"dictate#0","mods":[165],"when":"always"}]`), true)
	if line := string(encodeEvent(boundEvent(rejected))); line != `{"event":"bound","rejected":[]}`+"\n" {
		t.Fatalf("没有被拒的：%q", line)
	}
	line := string(encodeEvent(boundEvent([]rejection{{ID: "x#0", Reason: "invalid"}})))
	if line != `{"event":"bound","rejected":[{"id":"x#0","reason":"invalid"}]}`+"\n" {
		t.Fatalf("有被拒的：%q", line)
	}
}
