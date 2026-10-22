package main

import (
	"strings"
	"testing"
	"time"
)

// 在钩子线程上发事件不能等：缓冲满了也要马上返回，丢掉的条数之后补报
func TestOutboxSendNeverBlocksWhenFull(t *testing.T) {
	box := newOutbox(2)
	done := make(chan struct{})
	go func() {
		for i := 0; i < 1000; i++ {
			box.send(event{"event": "binding", "id": "dictate#0", "down": true})
		}
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("缓冲满了以后 send 卡住了")
	}
	first, ok := box.next()
	if !ok || !strings.Contains(string(first), `"event":"error"`) || !strings.Contains(string(first), "998") {
		t.Fatalf("腾出地方后头一条应该补报丢了 998 条，拿到 %q", first)
	}
	for i := 0; i < 2; i++ {
		line, ok := box.next()
		if !ok || !strings.Contains(string(line), `"event":"binding"`) {
			t.Fatalf("第 %d 条应该是没丢的那两条之一，拿到 %q", i+1, line)
		}
	}
}

func TestOutboxReportsNothingExtraWhenNothingDropped(t *testing.T) {
	box := newOutbox(4)
	box.send(event{"event": "ready"})
	line, _ := box.next()
	if !strings.Contains(string(line), `"event":"ready"`) {
		t.Fatalf("没丢东西时不该补报：%q", line)
	}
}

// 钩子线程自己也往任务队列里放（回调里要插掩码键），队列再长也不能让它等自己
func TestTaskQueuePushNeverBlocksAndKeepsOrder(t *testing.T) {
	var queue taskQueue
	var ran []int
	done := make(chan struct{})
	go func() {
		for i := 0; i < 10000; i++ {
			queue.push(func() { ran = append(ran, i) })
		}
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("没人取的时候 push 卡住了")
	}
	for _, task := range queue.takeAll() {
		task()
	}
	if len(ran) != 10000 || ran[0] != 0 || ran[9999] != 9999 {
		t.Fatalf("顺序或条数不对：%d 条", len(ran))
	}
	if left := queue.takeAll(); len(left) != 0 {
		t.Fatalf("取完了还剩 %d 条", len(left))
	}
}
