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

// 只有 Windows 有：低级钩子吞了按下，系统就不更新这个键的异步状态，GetAsyncKeyState 一直说它没按着
// （所有低级钩子都放行了，系统才改键的状态：https://devblogs.microsoft.com/oldnewthing/20140213-00/?p=1773 ）。
// 核对按住的键时要是信了它，按着右 Ctrl+Space 再按 K，就成了只按着右 Ctrl+K
func TestSwallowedKeyIsNotCheckedAgainstTheSystemState(t *testing.T) {
	// 修饰键从来不吞，系统查得准，照实说按着
	m := newMatcher(func(id keyID, _ heldKey) bool { return id.isModifier() })
	m.bind([]binding{
		{ID: "a#0", Mods: []uint32{vkRControl}, Key: 0x39, HasKey: true},
		{ID: "b#0", Mods: []uint32{vkRControl}, Key: 0x25, HasKey: true},
	})
	m.onKey(keyInput{vk: vkRControl, scan: 0x1D, extended: true, down: true, time: 1})
	if out := m.onKey(keyInput{vk: 0x20, scan: 0x39, down: true, time: 2}); !out.swallow {
		t.Fatalf("Space 凑成了 a#0，要吞：%+v", out)
	}
	got := m.onKey(keyInput{vk: 'K', scan: 0x25, down: true, time: 3})
	if want := []event{{"event": "interrupted", "id": "a#0"}}; !reflect.DeepEqual(got.events, want) || got.swallow {
		t.Fatalf("按着三个键，应该只是打断：%+v", got)
	}
	// 10 秒的清理照旧：吞掉的键松开要是丢了，靠它清。换一份表放掉按着的绑定，Space 的松开没来
	m.onKey(keyInput{vk: 'K', scan: 0x25, down: false, time: 4})
	m.onKey(keyInput{vk: vkRControl, scan: 0x1D, extended: true, down: false, time: 5})
	m.bind([]binding{{ID: "d#0", Mods: []uint32{vkRControl}}})
	m.onKey(keyInput{vk: vkRControl, scan: 0x1D, extended: true, down: true, time: 6})
	m.onKey(keyInput{vk: vkRControl, scan: 0x1D, extended: true, down: false, time: 7})
	got = m.onKey(keyInput{vk: vkRControl, scan: 0x1D, extended: true, down: true, time: 20_000})
	if want := []event{{"event": "binding", "id": "d#0", "down": true}}; !reflect.DeepEqual(got.events, want) {
		t.Fatalf("Space 的松开丢了 10 秒以上，单按右 Ctrl 应该照常按下：%+v", got)
	}
}
