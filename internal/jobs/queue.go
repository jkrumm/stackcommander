package jobs

import (
	"context"
	"sync"
	"time"
)

// Queue is a buffered FIFO job runner backed by a Go channel.
// Only one job runs at a time — sequential execution is guaranteed.
// The context passed to NewQueue is forwarded to each job function, allowing
// callers to interrupt in-flight work (e.g. on SIGTERM).
type Queue struct {
	mu      sync.Mutex
	ctx     context.Context
	ch      chan func(context.Context)
	wg      sync.WaitGroup
	drained bool
}

// NewQueue creates and starts a Queue. The given context is passed to each
// job function as it is dequeued — cancelling ctx interrupts the current job.
func NewQueue(ctx context.Context) *Queue {
	q := &Queue{ctx: ctx, ch: make(chan func(context.Context), 1024)}
	q.wg.Add(1)
	go q.worker()
	return q
}

func (q *Queue) worker() {
	defer q.wg.Done()
	for fn := range q.ch {
		fn(q.ctx)
	}
}

// Enqueue adds fn to the back of the queue. No-ops after Drain is called.
func (q *Queue) Enqueue(fn func(context.Context)) {
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
