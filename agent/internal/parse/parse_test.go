package parse

import (
	"bufio"
	"os"
	"strings"
	"testing"
)

func lines(t *testing.T, p string) [][]byte {
	f, err := os.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	var out [][]byte
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		out = append(out, append([]byte(nil), sc.Bytes()...))
	}
	return out
}

func TestClaude(t *testing.T) {
	var evs []Event
	unread := 0
	for _, l := range lines(t, "testdata/claude.jsonl") {
		r := Claude(l, "file-session")
		if r.Unread {
			unread++
		}
		if r.Event != nil {
			evs = append(evs, *r.Event)
		}
	}
	if len(evs) != 2 { // the duplicate streaming line is returned; the store dedups it by key
		t.Fatalf("want 2 events, got %d", len(evs))
	}
	e := evs[0]
	if e.Key() != evs[1].Key() {
		t.Fatal("duplicate streamed message should share a key")
	}
	if e.Model != "claude-opus-5-5" || e.Input != 12 || e.Output != 340 || e.CacheWrite != 2048 || e.CacheRead != 18000 || e.RequestID != "req_1" {
		t.Fatalf("bad fields: %+v", e)
	}
	if strings.Contains(e.Model+e.Cwd+e.SessionID+e.MessageID, "SECRET") {
		t.Fatal("content leaked into event")
	}
	if unread != 1 {
		t.Fatalf("want 1 unread line (bad timestamp), got %d", unread)
	}
}

func TestCodex(t *testing.T) {
	st := &FileState{}
	var evs []Event
	var off int64
	for _, l := range lines(t, "testdata/codex.jsonl") {
		r := Codex(l, off, st)
		off += int64(len(l)) + 1
		if r.Event != nil {
			evs = append(evs, *r.Event)
		}
	}
	if len(evs) != 1 {
		t.Fatalf("want 1 event (repeat report skipped), got %d", len(evs))
	}
	e := evs[0]
	if e.SessionID != "cx-1" || e.Model != "gpt-5-codex" || e.Input != 1000 || e.CacheRead != 4000 || e.Output != 1200 || e.Cwd != "/Users/priya/code/web-dashboard" {
		t.Fatalf("bad fields: %+v", e)
	}
}

func TestClaudeBillingDetails(t *testing.T) {
	line := []byte(`{"type":"assistant","sessionId":"s1","requestId":"r1","timestamp":"2026-10-01T10:00:00.000Z","cwd":"/w","message":{"id":"m1","model":"claude-opus-5-5","content":[{"type":"text","text":"SECRET_REPLY"}],` +
		`"usage":{"input_tokens":5,"output_tokens":9,"cache_creation_input_tokens":700,"cache_read_input_tokens":40,"cache_creation":{"ephemeral_5m_input_tokens":300,"ephemeral_1h_input_tokens":400},` +
		`"service_tier":"standard","speed":"fast","inference_geo":"us","server_tool_use":{"web_search_requests":2}}}}`)
	r := Claude(line, "")
	e := r.Event
	if e == nil {
		t.Fatal("no event")
	}
	if e.CacheWrite != 700 || e.CacheWrite1h != 400 || e.Speed != "fast" || e.Geo != "us" || e.WebSearches != 2 || e.Parser != ClaudeVersion {
		t.Fatalf("bad billing fields: %+v", *e)
	}
}
