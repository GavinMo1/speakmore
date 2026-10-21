package main

// 往外交东西的两个出口，都不让发的一方等。发的一方多半是钩子线程：钩子回调和消息循环都在它上面，
// 它一等，回调就超时，系统会悄悄把钩子卸掉，小帮手还活着却再也听不到键。
// 这个文件只有纯逻辑，不碰 Windows 的接口，在任何系统上都能 go test。

import (
	"fmt"
	"sync"
	"sync/atomic"
)

// 报给父进程的事件。父进程读得慢、缓冲满了就丢，记下丢了几条；写的那一头腾出地方后先补报一条 error
type outbox struct {
	lines   chan []byte
	dropped atomic.Int64
}

func newOutbox(size int) *outbox { return &outbox{lines: make(chan []byte, size)} }

func (o *outbox) send(e event) {
	select {
	case o.lines <- encodeEvent(e):
	default:
		o.dropped.Add(1)
	}
}

// 写的那一头取下一行：丢过事件的话先补报丢了几条
func (o *outbox) next() ([]byte, bool) {
	if n := o.dropped.Swap(0); n > 0 {
		return encodeEvent(event{"event": "error", "message": fmt.Sprintf("父进程读得太慢，丢了 %d 条事件", n)}), true
	}
	line, ok := <-o.lines
	return line, ok
}

func (o *outbox) pending() int { return len(o.lines) }

// 要交给钩子线程去做的事。不用定长的 channel：钩子线程自己也往里放（回调里要插掩码键），满了一等就是自己等自己
type taskQueue struct {
	mu    sync.Mutex
	items []func()
}

func (q *taskQueue) push(task func()) {
	q.mu.Lock()
	q.items = append(q.items, task)
	q.mu.Unlock()
}

// 取走现在排着的全部，按放进来的顺序
func (q *taskQueue) takeAll() []func() {
	q.mu.Lock()
	items := q.items
	q.items = nil
	q.mu.Unlock()
	return items
}
