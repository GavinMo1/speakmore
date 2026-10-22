package main

import (
	"reflect"
	"testing"
)

// 假的 MapVirtualKeyW(vk, MAPVK_VK_TO_VSC_EX)：只认测试里用到的几个
func fakeScanOf(vk uint32) (uint32, bool) {
	switch vk {
	case 0x7C: // F13
		return 0x64, false
	case 0x26: // 上箭头：扩展键
		return 0x48, true
	case 0x20: // 空格
		return 0x39, false
	}
	return 0, false
}

func noLookup(t *testing.T) func(uint32) (uint32, bool) {
	return func(vk uint32) (uint32, bool) {
		t.Fatalf("不该按 vk 0x%X 查扫描码", vk)
		return 0, false
	}
}

// 别的程序模拟的修饰键只填了不分左右的 vk：按扫描码、扩展位分出左右
func TestNormalizeSidesGenericModifiers(t *testing.T) {
	cases := []struct {
		name string
		in   keyInput
		want uint32
	}{
		{"Shift 扫描码 0x2A 是左", keyInput{vk: vkShift, scan: 0x2A}, vkLShift},
		{"Shift 扫描码 0x36 是右", keyInput{vk: vkShift, scan: 0x36}, vkRShift},
		{"Shift 扫描码 0x36 带扩展位也是右", keyInput{vk: vkShift, scan: 0x36, extended: true}, vkRShift},
		{"Shift 只给了 vk 当左", keyInput{vk: vkShift}, vkLShift},
		{"Ctrl 不带扩展位是左", keyInput{vk: vkControl, scan: 0x1D}, vkLControl},
		{"Ctrl 带扩展位是右", keyInput{vk: vkControl, scan: 0x1D, extended: true}, vkRControl},
		{"Alt 不带扩展位是左", keyInput{vk: vkMenu, scan: 0x38}, vkLMenu},
		{"Alt 带扩展位是右", keyInput{vk: vkMenu, scan: 0x38, extended: true}, vkRMenu},
		{"已经分了左右的不动", keyInput{vk: vkRMenu, scan: 0x38, extended: true}, vkRMenu},
	}
	for _, c := range cases {
		if got := normalize(c.in, noLookup(t)); got.vk != c.want {
			t.Errorf("%s：得到 0x%X，应为 0x%X", c.name, got.vk, c.want)
		}
	}
}

// 普通键只填了 vk、扫描码是 0：按 vk 查一个；查到的是扩展键就带上扩展位
func TestNormalizeLooksUpMissingScanCodes(t *testing.T) {
	if got := normalize(keyInput{vk: 0x7C}, fakeScanOf); got.scan != 0x64 || got.extended {
		t.Errorf("F13：%+v", got)
	}
	if got := normalize(keyInput{vk: 0x26}, fakeScanOf); got.scan != 0x48 || !got.extended {
		t.Errorf("上箭头：%+v", got)
	}
	// 有扫描码的、修饰键、不是物理键的 vk、vk 也是 0 的：都不查
	for _, in := range []keyInput{
		{vk: 0x7C, scan: 0x64},
		{vk: vkRControl},
		{vk: 0xE7},
		{vk: vkMask},
		{},
	} {
		normalize(in, noLookup(t))
	}
}

// 模拟输入 Unicode 字符的 VK_PACKET，扫描码那一栏是字符本身：'9' 是 0x39，正好是空格的扫描码。
// 它要当成别的键（打断），不能凑成右 Alt+空格
func TestVirtualKeysAreOtherKeysNotTheirScanCode(t *testing.T) {
	m := newMatcher(func(keyID, heldKey) bool { return true })
	m.bind([]binding{
		{ID: "dictate#0", Mods: []uint32{vkRMenu}},
		{ID: "x#0", Mods: []uint32{vkRMenu}, Key: 0x39, HasKey: true},
	})
	m.onKey(keyInput{vk: vkRMenu, scan: 0x38, extended: true, down: true, time: 1})
	got := m.onKey(normalize(keyInput{vk: 0xE7, scan: '9', down: true, time: 2}, noLookup(t)))
	if want := []event{{"event": "interrupted", "id": "dictate#0"}}; !reflect.DeepEqual(got.events, want) || got.swallow {
		t.Fatalf("VK_PACKET 应该只是打断：%+v", got)
	}
}

// 别的工具只填 vk 模拟的右 Ctrl（不分左右的 VK_CONTROL 加扩展位）和 F13（扫描码 0）：补全以后照样凑成右 Ctrl+F13、吞掉 F13
func TestVKOnlyInjectedChordStillMatches(t *testing.T) {
	m := newMatcher(func(keyID, heldKey) bool { return true })
	m.bind([]binding{{ID: "x#0", Mods: []uint32{vkRControl}, Key: 0x64, HasKey: true}})
	m.onKey(normalize(keyInput{vk: vkControl, extended: true, down: true, time: 1}, fakeScanOf))
	got := m.onKey(normalize(keyInput{vk: 0x7C, down: true, time: 2}, fakeScanOf))
	if want := []event{{"event": "binding", "id": "x#0", "down": true}}; !reflect.DeepEqual(got.events, want) || !got.swallow {
		t.Fatalf("应该凑成 x#0 并吞掉 F13：%+v", got)
	}
	if got := m.onKey(normalize(keyInput{vk: 0x7C, down: false, time: 3}, fakeScanOf)); !got.swallow {
		t.Fatalf("F13 的松开也要吞：%+v", got)
	}
}
