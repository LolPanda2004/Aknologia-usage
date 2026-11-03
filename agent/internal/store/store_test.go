package store

import (
	"testing"
	"time"

	"github.com/aknologia/usage/agent/internal/parse"
)

func ev(out int64) parse.Event {
	return parse.Event{Tool: "claude_code", SessionID: "s", MessageID: "m", RequestID: "r", Model: "claude-opus-5-5", Input: 10, Output: out,
		TS: time.Date(2026, 10, 1, 10, 0, 0, 0, time.UTC), Parser: parse.ClaudeVersion}
}

// Claude Code writes a streamed reply several times; the final line (largest output) must win, and if the
// first version was already synced, the final one must be sent again.
func TestStreamedReplyKeepsFinalVersionAndResends(t *testing.T) {
	dir := t.TempDir()
	st, err := Open(dir, "http://x")
	if err != nil {
		t.Fatal(err)
	}
	if n, _ := st.Add([]parse.Event{ev(1)}); n != 1 {
		t.Fatalf("first add: %d", n)
	}
	b := st.Pending(500)
	if len(b.Events) != 1 {
		t.Fatalf("pending: %d", len(b.Events))
	}
	st.Ack(b)
	if st.Queued() != 0 {
		t.Fatalf("queued after ack: %d", st.Queued())
	}

	if n, _ := st.Add([]parse.Event{ev(450)}); n != 1 {
		t.Fatal("final streamed line should replace the first")
	}
	if n, _ := st.Add([]parse.Event{ev(1)}); n != 0 {
		t.Fatal("an older, smaller version must not replace the final one")
	}
	if st.Queued() != 1 {
		t.Fatalf("the updated event should be queued again, queued=%d", st.Queued())
	}
	b = st.Pending(500)
	if len(b.Events) != 1 || b.Events[0].Output != 450 {
		t.Fatalf("resend batch: %+v", b.Events)
	}
	st.Ack(b)
	if st.Queued() != 0 {
		t.Fatalf("queued after resend ack: %d", st.Queued())
	}

	// Reopening replays events.jsonl: the later line replaces the earlier one.
	st2, err := Open(dir, "http://x")
	if err != nil {
		t.Fatal(err)
	}
	evs := st2.Events()
	if len(evs) != 1 || evs[0].Output != 450 {
		t.Fatalf("after reopen: %+v", evs)
	}
	if st2.Queued() != 0 {
		t.Fatalf("after reopen queued=%d", st2.Queued())
	}
}

func TestSummaryUsesListPrices(t *testing.T) {
	st, _ := Open(t.TempDir(), "http://x")
	e := ev(1000) // opus 5.5: 10 x $4 + 1000 x $20 per MTok = $0.02004
	e.TS = time.Now().Add(-time.Hour)
	unknown := ev(1000)
	unknown.MessageID, unknown.Model, unknown.TS = "m2", "claude-unknown-9", e.TS
	st.Add([]parse.Event{e, unknown})
	sum := st.Summary(1, time.Now())
	if sum.Cost != 0.02 {
		t.Fatalf("cost %v, want 0.02", sum.Cost)
	}
	if sum.Unpriced["claude-unknown-9"] != 1 {
		t.Fatalf("unknown model should be reported as unpriced: %+v", sum.Unpriced)
	}
}

// A streamed reply's final line can arrive while its first version is in a batch being sent. The final
// version must still reach the server afterwards.
func TestUpdateDuringInFlightBatchIsResent(t *testing.T) {
	st, _ := Open(t.TempDir(), "http://x")
	st.Add([]parse.Event{ev(1)})
	b := st.Pending(500) // batch with the first version is on its way
	st.Add([]parse.Event{ev(450)})
	st.Ack(b)
	b2 := st.Pending(500)
	if len(b2.Events) != 1 || b2.Events[0].Output != 450 {
		t.Fatalf("final version updated during the send must be resent, got %+v", b2.Events)
	}
	st.Ack(b2)

	// Same for an event that was already synced, is in the resend batch, and changes again meanwhile.
	st.Add([]parse.Event{ev(500)})
	b3 := st.Pending(500)
	st.Add([]parse.Event{ev(600)})
	st.Ack(b3)
	b4 := st.Pending(500)
	if len(b4.Events) != 1 || b4.Events[0].Output != 600 {
		t.Fatalf("second update during resend must be resent, got %+v", b4.Events)
	}
}

// Scanner and syncer run concurrently: streamed replies keep growing while batches are sent and acknowledged.
// At the end the "server" must hold the final version of every reply.
func TestConcurrentScanAndSyncLoseNothing(t *testing.T) {
	st, _ := Open(t.TempDir(), "http://x")
	server := map[string]int64{}
	done := make(chan struct{})
	go func() {
		defer close(done)
		for round := int64(1); round <= 50; round++ {
			var evs []parse.Event
			for m := 0; m < 40; m++ {
				e := ev(round * 10)
				e.MessageID = "m" + string(rune('A'+m%26)) + string(rune('a'+m/26))
				evs = append(evs, e)
			}
			st.Add(evs)
		}
	}()
	sync := func() {
		for {
			b := st.Pending(7)
			if len(b.Events) == 0 {
				return
			}
			for _, e := range b.Events {
				if e.Output > server[e.Key()] {
					server[e.Key()] = e.Output
				}
			}
			st.Ack(b)
		}
	}
	for running := true; running; {
		select {
		case <-done:
			running = false
		default:
			sync()
		}
	}
	sync()
	if len(server) != 40 {
		t.Fatalf("server has %d replies, want 40", len(server))
	}
	for k, out := range server {
		if out != 500 {
			t.Fatalf("%s: server has output %d, want the final 500", k, out)
		}
	}
}

// QA MEM-01: active hours must add exact seconds per session (as the server does), not per-session rounded minutes.
func TestActiveHoursAddExactSeconds(t *testing.T) {
	st, _ := Open(t.TempDir(), "http://x")
	base := time.Now().Add(-5 * time.Hour)
	var evs []parse.Event
	// 20 sessions of 2 turns 1 s apart: each is 30 s + 1 s = 31 s. Exact total 620 s = 0.2 h; rounding each session
	// to a whole minute first would give 20 min = 0.3 h.
	for i := 0; i < 20; i++ {
		for j := 0; j < 2; j++ {
			e := ev(1)
			e.SessionID, e.MessageID = "s"+string(rune('a'+i)), "m"+string(rune('a'+j))
			e.TS = base.Add(time.Duration(i)*10*time.Minute + time.Duration(j)*time.Second)
			evs = append(evs, e)
		}
	}
	st.Add(evs)
	if got := st.Summary(1, time.Now()).ActiveHours; got != 0.2 {
		t.Fatalf("active hours %v, want 0.2 (620 s)", got)
	}
}
