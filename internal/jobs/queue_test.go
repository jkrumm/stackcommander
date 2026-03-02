package jobs_test

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jkrumm/rollhook/internal/jobs"
)

func TestQueue_FIFO(t *testing.T) {
	q := jobs.NewQueue(context.Background())
	var mu sync.Mutex
	var results []int

	for i := range 3 {
		n := i
		q.Enqueue(func(_ context.Context) {
			mu.Lock()
			results = append(results, n)
			mu.Unlock()
		})
	}

	q.Drain(5 * time.Second)

	mu.Lock()
	defer mu.Unlock()
	if len(results) != 3 || results[0] != 0 || results[1] != 1 || results[2] != 2 {
		t.Errorf("expected FIFO [0 1 2], got %v", results)
	}
}

func TestQueue_Sequential(t *testing.T) {
	q := jobs.NewQueue(context.Background())
	var active atomic.Int32
	var overlap atomic.Bool

	for range 5 {
		q.Enqueue(func(_ context.Context) {
			if active.Add(1) > 1 {
				overlap.Store(true)
			}
			time.Sleep(10 * time.Millisecond)
			active.Add(-1)
		})
	}

	q.Drain(5 * time.Second)

	if overlap.Load() {
		t.Error("concurrent execution detected — sequential guarantee violated")
	}
}

func TestQueue_Drain(t *testing.T) {
	q := jobs.NewQueue(context.Background())
	var done atomic.Bool

	q.Enqueue(func(_ context.Context) {
		time.Sleep(20 * time.Millisecond)
		done.Store(true)
	})

	ok := q.Drain(5 * time.Second)
	if !ok {
		t.Fatal("Drain timed out unexpectedly")
	}
	if !done.Load() {
		t.Error("job had not finished when Drain returned true")
	}
}

func TestQueue_DrainNoopsAfterFirst(t *testing.T) {
	q := jobs.NewQueue(context.Background())
	q.Drain(time.Second)

	// Second Drain should return true immediately without panic.
	ok := q.Drain(time.Second)
	if !ok {
		t.Error("second Drain call should return true immediately")
	}
}

func TestQueue_EnqueueAfterDrainIsNoOp(t *testing.T) {
	q := jobs.NewQueue(context.Background())
	q.Drain(time.Second)

	// Enqueue after drain must not panic and must not run the job.
	var ran atomic.Bool
	q.Enqueue(func(_ context.Context) { ran.Store(true) })
	time.Sleep(20 * time.Millisecond)
	if ran.Load() {
		t.Error("job enqueued after Drain should not execute")
	}
}

func TestQueue_ContextCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	q := jobs.NewQueue(ctx)

	started := make(chan struct{})
	stopped := make(chan struct{})

	q.Enqueue(func(ctx context.Context) {
		close(started)
		<-ctx.Done() // blocks until context is cancelled
		close(stopped)
	})

	<-started
	cancel()

	select {
	case <-stopped:
		// ok — job received cancellation signal
	case <-time.After(time.Second):
		t.Fatal("job did not receive context cancellation within 1s")
	}
}
