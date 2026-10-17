package main

import (
	"encoding/json"
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
