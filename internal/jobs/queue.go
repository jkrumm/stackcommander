package jobs

import (
	"sync"
	"time"
)

// Queue is a buffered FIFO job runner backed by a Go channel.
// Only one job runs at a time — sequential execution is guaranteed.
type Queue struct {
	mu      sync.Mutex
	ch      chan func()
	wg      sync.WaitGroup
	drained bool
}

// NewQueue creates and starts a Queue.
func NewQueue() *Queue {
	q := &Queue{ch: make(chan func(), 1024)}
	q.wg.Add(1)
	go q.worker()
	return q
}

func (q *Queue) worker() {
	defer q.wg.Done()
	for fn := range q.ch {
		fn()
	}
}

// Enqueue adds fn to the back of the queue. No-ops after Drain is called.
func (q *Queue) Enqueue(fn func()) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.drained {
		return
	}
	q.ch <- fn
}

// Drain stops accepting new work, waits for all queued and in-flight jobs to
// complete, and returns true if they finish within timeout.
func (q *Queue) Drain(timeout time.Duration) bool {
	q.mu.Lock()
	if q.drained {
		q.mu.Unlock()
		return true
	}
	q.drained = true
	close(q.ch)
	q.mu.Unlock()

	done := make(chan struct{})
	go func() {
		q.wg.Wait()
		close(done)
	}()

	select {
	case <-done:
		return true
	case <-time.After(timeout):
		return false
	}
}
