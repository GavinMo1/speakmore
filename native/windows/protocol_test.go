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

func TestParsesRecordOnAndOff(t *testing.T) {
	for line, want := range map[string]bool{`{"cmd":"record","on":true}`: true, `{"cmd":"record","on":false}`: false} {
		cmd, err := parseCommand([]byte(line))
		if err != nil || cmd.Cmd != "record" {
			t.Fatalf("%s：%+v %v", line, cmd, err)
		}
		if on, err := parseRecord(cmd.On); err != nil || on != want {
			t.Fatalf("%s：得到 %v %v", line, on, err)
		}
	}
}

func TestRecordWithoutABooleanOnIsAnError(t *testing.T) {
	for _, line := range []string{
		`{"cmd":"record"}`,
		`{"cmd":"record","on":null}`,
		`{"cmd":"record","on":1}`,
		`{"cmd":"record","on":"true"}`,
	} {
		cmd, err := parseCommand([]byte(line))
		if err != nil {
			t.Fatalf("%s：整行就没认：%v", line, err)
		}
		if _, err := parseRecord(cmd.On); err == nil || err.Error() != "record 需要 on：true 或 false" {
			t.Fatalf("%s：%v", line, err)
		}
	}
}

func probeCommand(t *testing.T, line string) command {
	t.Helper()
	cmd, err := parseCommand([]byte(line))
	if err != nil || cmd.Cmd != "probe" {
		t.Fatalf("%s：%+v %v", line, cmd, err)
	}
	return cmd
}

// 有普通键的：交给系统去试登记，mods、key 的写法同 bind。单个普通键也试（F14 这类别的程序也会不带修饰键登记）
func TestProbeOfAComboWithAKeyIsAskedOfTheSystem(t *testing.T) {
	for line, want := range map[string]binding{
		`{"cmd":"probe","id":7,"mods":[163],"key":100}`:  {Mods: []uint32{0xA3}, Key: 0x64, HasKey: true},
		`{"cmd":"probe","id":7,"mods":[91],"key":57416}`: {Mods: []uint32{0x5B}, Key: 0xE048, HasKey: true},
		`{"cmd":"probe","id":7,"mods":[],"key":101}`:     {Mods: []uint32{}, Key: 0x65, HasKey: true},
	} {
		id, combo, reply := parseProbe(probeCommand(t, line))
		if reply != nil || id != 7 || !reflect.DeepEqual(combo, want) {
			t.Fatalf("%s：得到 %d %+v %v", line, id, combo, reply)
		}
	}
}

// 只有修饰键的：RegisterHotKey 登记不了这种，别的程序也就占不了，当场回 conflict:false
func TestProbeOfModifiersOnlyAnswersNoConflictAtOnce(t *testing.T) {
	for _, line := range []string{
		`{"cmd":"probe","id":7,"mods":[163]}`,
		`{"cmd":"probe","id":7,"mods":[163,161]}`,
		`{"cmd":"probe","id":7,"mods":[163],"key":null}`,
	} {
		_, _, reply := parseProbe(probeCommand(t, line))
		expectEvents(t, line, reply, event{"event": "probed", "id": 7, "conflict": false})
	}
}

// id 是整数就一定回一条 probed（父进程在等它）：形状不对的回 conflict:false，另报一条 error 说哪里不对
func TestProbeWithTheWrongShapeStillAnswersItsID(t *testing.T) {
	const mods, key, rule = "probe 的 mods 不对：要一组修饰键的 vk，同 bind",
		"probe 的 key 不对：要一个普通键的扫描码，同 bind",
		"probe 的组合不合规矩：同 bind，修饰键 0 到 2 个、不重复，合起来 1 到 2 个键"
	for _, c := range []struct{ line, message string }{
		{`{"cmd":"probe","id":7,"key":100}`, mods},
		{`{"cmd":"probe","id":7,"mods":null,"key":100}`, mods},
		{`{"cmd":"probe","id":7,"mods":163,"key":100}`, mods},
		{`{"cmd":"probe","id":7,"mods":["ControlRight"],"key":100}`, mods},
		{`{"cmd":"probe","id":7,"mods":[-1],"key":100}`, mods},
		{`{"cmd":"probe","id":7,"mods":[163],"key":"F13"}`, key},
		{`{"cmd":"probe","id":7,"mods":[163],"key":-1}`, key},
		{`{"cmd":"probe","id":7,"mods":[163],"key":1.5}`, key},
		{`{"cmd":"probe","id":7,"mods":[65],"key":100}`, rule},
		{`{"cmd":"probe","id":7,"mods":[17],"key":100}`, rule},
		{`{"cmd":"probe","id":7,"mods":[163,163],"key":100}`, rule},
		{`{"cmd":"probe","id":7,"mods":[163,161],"key":100}`, rule},
		{`{"cmd":"probe","id":7,"mods":[163],"key":0}`, rule},
		{`{"cmd":"probe","id":7,"mods":[163],"key":57344}`, rule},
		{`{"cmd":"probe","id":7,"mods":[]}`, rule},
	} {
		_, _, reply := parseProbe(probeCommand(t, c.line))
		expectEvents(t, c.line, reply, event{"event": "probed", "id": 7, "conflict": false}, event{"event": "error", "message": c.message})
	}
}

// 没有 id 就回不了 probed：只报 error。id 不是整数的，整行就看不懂
func TestProbeWithoutAnIDOnlyReportsAnError(t *testing.T) {
	for _, line := range []string{`{"cmd":"probe","mods":[163],"key":100}`, `{"cmd":"probe","id":null,"mods":[163],"key":100}`} {
		_, _, reply := parseProbe(probeCommand(t, line))
		expectEvents(t, line, reply, event{"event": "error", "message": "probe 需要整数 id"})
	}
	for _, line := range []string{`{"cmd":"probe","id":"7","mods":[163],"key":100}`, `{"cmd":"probe","id":7.5,"mods":[163],"key":100}`} {
		if _, err := parseCommand([]byte(line)); err == nil {
			t.Fatalf("%s 没被拒绝", line)
		}
	}
}

// RegisterHotKey 的修饰键不分左右：左右合并成 MOD_*，一律带 MOD_NOREPEAT；单个普通键只有 MOD_NOREPEAT
func TestProbeMergesBothSidesIntoRegisterHotKeyModifiers(t *testing.T) {
	for _, c := range []struct {
		mods []uint32
		want uint32
	}{
		{[]uint32{}, 0x4000},
		{[]uint32{vkLShift}, 0x4004},
		{[]uint32{vkRShift}, 0x4004},
		{[]uint32{vkLControl}, 0x4002},
		{[]uint32{vkRControl, vkRMenu}, 0x4003},
		{[]uint32{vkLMenu}, 0x4001},
		{[]uint32{vkLWin}, 0x4008},
		{[]uint32{vkRWin, vkLShift}, 0x400C},
	} {
		if got := registerModifiers(c.mods); got != c.want {
			t.Errorf("%v：得到 0x%X，应为 0x%X", c.mods, got, c.want)
		}
	}
}

// 试登记的结果：登记上了是没被占；1409（ERROR_HOTKEY_ALREADY_REGISTERED）是别的程序登记过；别的失败照没被占报，另报带错误码的 error
func TestProbeResultFollowsTheRegisterHotKeyError(t *testing.T) {
	expectEvents(t, "登记上了", probeResult(7, true, 0), event{"event": "probed", "id": 7, "conflict": false})
	expectEvents(t, "1409", probeResult(7, false, 1409), event{"event": "probed", "id": 7, "conflict": true, "source": "registered"})
	expectEvents(t, "别的失败", probeResult(7, false, 87),
		event{"event": "probed", "id": 7, "conflict": false},
		event{"event": "error", "message": "试登记组合没成功（错误码 87），查不出是不是被别的程序占了"})
}
