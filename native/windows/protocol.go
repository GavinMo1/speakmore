// Windows 上的原生小帮手：听热键、把文字贴进当前输入框、听写进行中截住 esc 和悬浮条上的点击。
// 和父进程的约定与 macOS 版（native/mac/main.swift）一字不差，父进程（src/app/helper.mjs）不分系统：
//
//	标准输出  {"event":"ready","listen":true,"trusted":true,"capture":true}
//	          {"event":"hotkey","down":true}
//	          {"event":"other_key"}
//	          {"event":"pasted","id":1,"ok":true}     ok 为 false 时文字留在剪贴板里，reason 说为什么
//	          {"event":"escape"}
//	          {"event":"click","id":"cancel"}
//	标准输入  {"cmd":"paste","id":1,"text":"…"}
//	          {"cmd":"capture","regions":[{"id":"cancel","x":0,"y":0,"width":28,"height":28}]}   屏幕上的物理像素
//	          {"cmd":"release"}
//
// 父进程退出（标准输入关闭）时自己也退出。和 macOS 不同的地方：
//   - Windows 没有"输入监控""辅助功能"这两项权限，listen、trusted 照实报装没装上钩子；
//   - 目标窗口是以管理员身份运行的、我们不是时，系统不让模拟的按键进去（UIPI），而且不报错：
//     这时不去按 Ctrl+V，把文字留在剪贴板里，报 ok:false、reason:"elevated"。
//
// 这个文件和 keys.go 只有纯逻辑，不碰 Windows 的接口，在任何系统上都能 go test。
package main

import (
	"encoding/json"
	"errors"
	"fmt"
)

// 一块屏幕区域：悬浮条上的一个按钮。坐标是屏幕上的物理像素，和低级鼠标钩子报的一致
type region struct {
	ID     string
	X, Y   float64
	Width  float64
	Height float64
}

// 和 macOS 的 CGRect.contains 一样：左、上边算在里面，右、下边不算
func (r region) contains(x, y float64) bool {
	return x >= r.X && x < r.X+r.Width && y >= r.Y && y < r.Y+r.Height
}

type command struct {
	Cmd     string          `json:"cmd"`
	ID      *int            `json:"id"`
	Text    *string         `json:"text"`
	Regions json.RawMessage `json:"regions"`
}

func parseCommand(line []byte) (command, error) {
	var parsed command
	if err := json.Unmarshal(line, &parsed); err != nil || parsed.Cmd == "" {
		return command{}, errors.New("看不懂的命令行")
	}
	return parsed, nil
}

func parseRegions(raw json.RawMessage) ([]region, error) {
	var items []struct {
		ID     *string  `json:"id"`
		X      *float64 `json:"x"`
		Y      *float64 `json:"y"`
		Width  *float64 `json:"width"`
		Height *float64 `json:"height"`
	}
	bad := errors.New("capture 需要 regions：一组 { id, x, y, width, height }")
	if len(raw) == 0 || json.Unmarshal(raw, &items) != nil || items == nil {
		return nil, bad
	}
	regions := make([]region, 0, len(items))
	for _, item := range items {
		if item.ID == nil || item.X == nil || item.Y == nil || item.Width == nil || item.Height == nil {
			return nil, bad
		}
		if *item.Width <= 0 || *item.Height <= 0 {
			return nil, bad
		}
		regions = append(regions, region{ID: *item.ID, X: *item.X, Y: *item.Y, Width: *item.Width, Height: *item.Height})
	}
	return regions, nil
}

// 一行要交给父进程的事件
type event map[string]any

func encodeEvent(e event) []byte {
	line, err := json.Marshal(e)
	if err != nil {
		// 只有我们自己拼的几种字段，不会走到这里；万一走到了也要说一声，不能静默丢掉
		line, _ = json.Marshal(event{"event": "error", "message": fmt.Sprintf("序列化失败：%v", err)})
	}
	return append(line, '\n')
}
