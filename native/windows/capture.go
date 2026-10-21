package main

// 听写进行中截住悬浮条上的点击（纯逻辑）：低级鼠标钩子把左键的按下松开交给这里，这里说吞不吞、报不报 click。
// 截着的时候（父进程说"开始截"之后、"不截了"之前），悬浮条那几块里的左键点击要吞掉：点击落到我们的窗口上
// 会抢走焦点。手还没松开的那一下要吞完整：按下吞了、松开却放出去的话，前台应用会收到没头没尾的半个事件。
// esc 不在这里：它是一个只在截着时生效的绑定，由 matcher 管。

type clickCapture struct {
	capturing bool
	regions   []region
	// 按下已经被吞掉、还在等松开的那一块（"" 是没有）
	pressed string
}

// 鼠标钩子现在该不该装着：截着，或者被吞掉的那一下还没松开
func (c *clickCapture) wantsHook() bool { return c.capturing || c.pressed != "" }

func (c *clickCapture) setCapturing(on bool, regions []region) {
	c.capturing = on
	if on {
		c.regions = regions
	} else {
		c.regions = nil
	}
}

func (c *clickCapture) regionAt(x, y float64) string {
	for _, r := range c.regions {
		if r.contains(x, y) {
			return r.ID
		}
	}
	return ""
}

// 鼠标左键。和普通按钮一样，按下和松开在同一块里才算点了它：按下之后拖出去再松手是反悔。
// 移动不吞：Windows 上吞了移动，光标就不动了；按下已经吞掉，别的应用看到的只是没按键的移动
func (c *clickCapture) onLeftButton(down bool, x, y float64) outcome {
	if down {
		if !c.capturing {
			return outcome{}
		}
		id := c.regionAt(x, y)
		if id == "" {
			return outcome{}
		}
		c.pressed = id
		return outcome{swallow: true}
	}
	if c.pressed == "" {
		return outcome{}
	}
	pressed := c.pressed
	c.pressed = ""
	if c.capturing && c.regionAt(x, y) == pressed {
		return outcome{swallow: true, events: []event{{"event": "click", "id": pressed}}}
	}
	return outcome{swallow: true}
}
