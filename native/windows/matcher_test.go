package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

// 两个小帮手共用的按键轨迹样例（native/fixtures/hotkeys/，写法见那里的 README）。Windows 读 win/ 这一份

type fixtureBinding struct {
	ID   string   `json:"id"`
	When string   `json:"when"`
	Mods []uint32 `json:"mods"`
	Key  *uint32  `json:"key"`
}

type fixtureKey struct {
	VK       uint32 `json:"vk"`
	Scan     uint32 `json:"scan"`
	Extended bool   `json:"extended"`
}

type fixtureStep struct {
	VK       *uint32          `json:"vk"`
	Scan     uint32           `json:"scan"`
	Extended bool             `json:"extended"`
	Down     bool             `json:"down"`
	Injected bool             `json:"injected"`
	T        uint32           `json:"t"`
	Capture  *bool            `json:"capture"`
	LostUp   *fixtureKey      `json:"lostUp"`
	Reset    bool             `json:"reset"`
	Bind     []fixtureBinding `json:"bind"`
	Expect   struct {
		Events  []event `json:"events"`
		Swallow bool    `json:"swallow"`
		Mask    bool    `json:"mask"`
	} `json:"expect"`
}

type fixtureCase struct {
	Name     string           `json:"name"`
	Bindings []fixtureBinding `json:"bindings"`
	Steps    []fixtureStep    `json:"steps"`
}

func toBindings(list []fixtureBinding) []binding {
	out := make([]binding, 0, len(list))
	for _, b := range list {
		item := binding{ID: b.ID, Mods: b.Mods, Capturing: b.When == "capturing"}
		if b.Key != nil {
			item.Key, item.HasKey = *b.Key, true
		}
		out = append(out, item)
	}
	return out
}

func inputOf(k fixtureKey, down, injected bool, t uint32) keyInput {
	return keyInput{vk: k.VK, scan: k.Scan, extended: k.Extended, down: down, ours: injected, time: t}
}

func loadFixtures(t *testing.T) []fixtureCase {
	t.Helper()
	files, err := filepath.Glob("../fixtures/hotkeys/win/*.json")
	if err != nil || len(files) == 0 {
		t.Fatalf("找不到样例（先跑 node scripts/build/hotkey-fixtures.mjs）：%v", err)
	}
	var all []fixtureCase
	for _, file := range files {
		data, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		var parsed struct {
			Cases []fixtureCase `json:"cases"`
		}
		if err := json.Unmarshal(data, &parsed); err != nil {
			t.Fatalf("%s：%v", file, err)
		}
		all = append(all, parsed.Cases...)
	}
	return all
}

// 事件过一遍 JSON：样例里的 down 是 bool、id 是 string，和 encodeEvent 写出去的一致
func normalized(events []event) []event {
	if len(events) == 0 {
		return nil
	}
	data, _ := json.Marshal(events)
	var out []event
	json.Unmarshal(data, &out)
	return out
}

func TestMatcherFollowsSharedFixtures(t *testing.T) {
	cases := loadFixtures(t)
	if len(cases) < 25 {
		t.Fatalf("只读到 %d 个样例", len(cases))
	}
	for _, c := range cases {
		t.Run(c.Name, func(t *testing.T) {
			// 松开的事件丢了的键：系统接口说它已经松开
			lost := map[keyID]bool{}
			m := newMatcher(func(id keyID, _ heldKey) bool { return !lost[id] })
			m.bind(toBindings(c.Bindings))
			for i, step := range c.Steps {
				var got outcome
				switch {
				case step.VK != nil:
					in := inputOf(fixtureKey{VK: *step.VK, Scan: step.Scan, Extended: step.Extended}, step.Down, step.Injected, step.T)
					if in.down {
						delete(lost, keyIDOf(in))
					}
					got = m.onKey(in)
				case step.Capture != nil:
					m.setCapturing(*step.Capture)
				case step.LostUp != nil:
					lost[keyIDOf(inputOf(*step.LostUp, false, false, 0))] = true
				case step.Reset:
					got = outcome{events: m.reset()}
				case step.Bind != nil:
					got = outcome{events: m.bind(toBindings(step.Bind))}
				default:
					t.Fatalf("第 %d 步认不出", i+1)
				}
				if events := normalized(got.events); !reflect.DeepEqual(events, normalized(step.Expect.Events)) {
					t.Fatalf("第 %d 步报的事件：得到 %v，应为 %v", i+1, events, step.Expect.Events)
				}
				if got.swallow != step.Expect.Swallow {
					t.Fatalf("第 %d 步吞不吞：得到 %v，应为 %v", i+1, got.swallow, step.Expect.Swallow)
				}
				if got.mask != step.Expect.Mask {
					t.Fatalf("第 %d 步插不插掩码：得到 %v，应为 %v", i+1, got.mask, step.Expect.Mask)
				}
			}
		})
	}
}

// 右 Shift 有的键盘带扩展位、有的不带：修饰键按 vk 认，两种都是同一个键
func TestRightShiftWithOrWithoutExtendedFlagIsTheSameKey(t *testing.T) {
	m := newMatcher(func(keyID, heldKey) bool { return true })
	m.bind([]binding{{ID: "x#0", Mods: []uint32{vkRControl, 0xA1}}})
	m.onKey(keyInput{vk: vkRControl, scan: 0x1D, extended: true, down: true, time: 1})
	got := m.onKey(keyInput{vk: 0xA1, scan: 0x36, extended: true, down: true, time: 2})
	if want := []event{{"event": "binding", "id": "x#0", "down": true}}; !reflect.DeepEqual(got.events, want) {
		t.Fatalf("带扩展位的右 Shift 没认出来：%v", got.events)
	}
}
