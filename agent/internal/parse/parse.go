// Package parse turns Claude Code and Codex session lines into usage events.
// Only whitelisted metadata is read; prompts, replies, tool output and file contents are never extracted.
package parse

import (
	"encoding/json"
	"strconv"
	"strings"
	"time"
)

const (
	ClaudeVersion = "claude-2" // claude-2: 1-hour cache writes, fast mode, inference geo, web searches
	CodexVersion  = "codex-1"
)

type Event struct {
	Tool       string `json:"tool"`
	SessionID  string `json:"sessionId"`
	MessageID  string `json:"messageId"`
	RequestID  string `json:"requestId"`
	Model      string `json:"model"`
	Input      int64  `json:"input"`
	Output     int64  `json:"output"`
	CacheWrite int64  `json:"cacheWrite"`
	CacheRead  int64  `json:"cacheRead"`
	// Billing details (Claude Code): the part of CacheWrite written to the 1-hour cache, fast mode, US-only
	// inference and server web searches. They change the list price of a request.
	CacheWrite1h int64     `json:"cacheWrite1h,omitempty"`
	Speed        string    `json:"speed,omitempty"`
	Geo          string    `json:"geo,omitempty"`
	WebSearches  int64     `json:"webSearches,omitempty"`
	TS           time.Time `json:"ts"`
	Cwd          string    `json:"cwd"` // stays on this device; only a keyed hash is synced
	Parser       string    `json:"parser"`
}

func (e Event) Key() string {
	return e.Tool + "|" + e.SessionID + "|" + e.MessageID + "|" + e.RequestID
}

// FileState carries what a Codex rollout file told us in earlier lines (session id, model, folder).
type FileState struct {
	Session   string `json:"session,omitempty"`
	Model     string `json:"model,omitempty"`
	Cwd       string `json:"cwd,omitempty"`
	LastTotal int64  `json:"lastTotal,omitempty"`
}

// Result: ev is set when the line is a usage event; unread is true when the line looked like usage but couldn't be understood.
type Result struct {
	Event  *Event
	Unread bool
}

func num(v any) int64 {
	switch x := v.(type) {
	case float64:
		return int64(x)
	case json.Number:
		n, _ := x.Int64()
		return n
	case string:
		n, _ := strconv.ParseInt(x, 10, 64)
		return n
	}
	return 0
}

func str(v any) string {
	s, _ := v.(string)
	return s
}

func obj(v any) map[string]any {
	m, _ := v.(map[string]any)
	return m
}

func ts(v any) (time.Time, bool) {
	s := str(v)
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02T15:04:05.000Z"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}

// Claude parses one line of a Claude Code project transcript (~/.claude/projects/<folder>/<session>.jsonl).
func Claude(line []byte, fileSession string) Result {
	if !strings.Contains(string(line), `"usage"`) { // cheap filter: most lines are not assistant turns
		return Result{}
	}
	var m map[string]any
	if json.Unmarshal(line, &m) != nil {
		return Result{Unread: true}
	}
	if str(m["type"]) != "assistant" {
		return Result{}
	}
	msg := obj(m["message"])
	u := obj(msg["usage"])
	t, ok := ts(m["timestamp"])
	if msg == nil || u == nil || !ok {
		return Result{Unread: true}
	}
	model := str(msg["model"])
	if model == "<synthetic>" {
		return Result{}
	}
	sid := str(m["sessionId"])
	if sid == "" {
		sid = fileSession
	}
	mid := str(msg["id"])
	if mid == "" {
		mid = str(m["uuid"])
	}
	if sid == "" || mid == "" {
		return Result{Unread: true}
	}
	cw := num(u["cache_creation_input_tokens"])
	var cw1h int64
	if cc := obj(u["cache_creation"]); cc != nil {
		cw5 := num(cc["ephemeral_5m_input_tokens"])
		cw1h = num(cc["ephemeral_1h_input_tokens"])
		if cw < cw5+cw1h {
			cw = cw5 + cw1h
		}
	}
	return Result{Event: &Event{Tool: "claude_code", SessionID: sid, MessageID: mid, RequestID: str(m["requestId"]), Model: model,
		Input: num(u["input_tokens"]), Output: num(u["output_tokens"]), CacheWrite: cw, CacheRead: num(u["cache_read_input_tokens"]),
		CacheWrite1h: cw1h, Speed: str(u["speed"]), Geo: str(u["inference_geo"]), WebSearches: num(obj(u["server_tool_use"])["web_search_requests"]),
		TS: t, Cwd: str(m["cwd"]), Parser: ClaudeVersion}}
}

// Codex parses one line of a Codex rollout file (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl).
// offset is the byte offset of the line and makes a stable message id.
//
// Token mapping (documented in docs/PARSERS.md): Codex reports input_tokens including cached tokens, so
// input = input_tokens - cached_input_tokens and cacheRead = cached_input_tokens. Output uses output_tokens,
// which already counts reasoning tokens.
func Codex(line []byte, offset int64, st *FileState) Result {
	var m map[string]any
	if json.Unmarshal(line, &m) != nil {
		if strings.Contains(string(line), "token_count") {
			return Result{Unread: true}
		}
		return Result{}
	}
	kind := str(m["type"])
	p := obj(m["payload"])
	if p == nil {
		p = m // older files put fields at the top level
	}
	switch kind {
	case "session_meta":
		if id := str(p["id"]); id != "" {
			st.Session = id
		}
		if c := str(p["cwd"]); c != "" {
			st.Cwd = c
		}
		if md := str(p["model"]); md != "" {
			st.Model = md
		}
		return Result{}
	case "turn_context":
		if md := str(p["model"]); md != "" {
			st.Model = md
		}
		if c := str(p["cwd"]); c != "" {
			st.Cwd = c
		}
		return Result{}
	case "event_msg", "token_count":
	default:
		return Result{}
	}
	if kind == "event_msg" && str(p["type"]) != "token_count" {
		return Result{}
	}
	info := obj(p["info"])
	if info == nil { // token_count without info is emitted at turn start; nothing to count
		return Result{}
	}
	last := obj(info["last_token_usage"])
	total := obj(info["total_token_usage"])
	t, ok := ts(m["timestamp"])
	if last == nil || !ok || st.Session == "" {
		return Result{Unread: true}
	}
	if total != nil {
		tt := num(total["total_tokens"])
		if tt != 0 && tt == st.LastTotal { // repeated report of the same turn
			return Result{}
		}
		st.LastTotal = tt
	}
	in, cached := num(last["input_tokens"]), num(last["cached_input_tokens"])
	if cached > in {
		cached = in
	}
	return Result{Event: &Event{Tool: "codex", SessionID: st.Session, MessageID: "off:" + strconv.FormatInt(offset, 10), Model: st.Model,
		Input: in - cached, Output: num(last["output_tokens"]), CacheRead: cached, TS: t, Cwd: st.Cwd, Parser: CodexVersion}}
}
