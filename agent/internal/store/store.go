// Package store keeps the agent's local data in plain files under the data folder:
//
//	events.jsonl  append-only usage events (the device's source of truth; resent if the server loses data)
//	cursors.json  per-file read position, so files are read incrementally
//	state.json    sign-in, sync progress, preferences, cached pricing and budget
//
// It deliberately has no dependencies; volumes are small (thousands of events a day at most).
package store

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/aknologia/usage/agent/internal/parse"
	"github.com/aknologia/usage/agent/internal/pricing"
)

type Cursor struct {
	Size   int64           `json:"size"`
	Offset int64           `json:"offset"`
	ModNS  int64           `json:"mod"`
	Codex  parse.FileState `json:"codex,omitempty"`
	Unread int             `json:"unread"`
}

type Budget struct {
	BudgetCents    int     `json:"budgetCents"`
	SpentCents     int     `json:"spentCents"`
	Pct            float64 `json:"pct"`
	ProjectedCents int     `json:"projectedCents"`
	ResetsOn       string  `json:"resetsOn"`
	Month          string  `json:"month"`
	Custom         bool    `json:"custom"`
}

type Prefs struct {
	Paused              bool `json:"paused"`
	BudgetNotifications bool `json:"budgetNotifications"`
	StartAtLogin        bool `json:"startAtLogin"`
}

type State struct {
	Server      string           `json:"server"`
	Token       string           `json:"token,omitempty"`
	DeviceID    string           `json:"deviceId,omitempty"`
	Email       string           `json:"email,omitempty"`
	Name        string           `json:"name,omitempty"`
	Role        string           `json:"role,omitempty"`
	Org         string           `json:"org,omitempty"`
	Removed     bool             `json:"removed"`
	Synced      int              `json:"synced"` // events.jsonl lines acknowledged by the server
	LastSync    time.Time        `json:"lastSync"`
	LastError   string           `json:"lastError,omitempty"`
	SyncMinute  int              `json:"syncMinute"`
	ProjectSalt string           `json:"projectSalt,omitempty"`
	Catalog     *pricing.Catalog `json:"priceCatalog,omitempty"` // list prices from the server; the built-in copy until the first sync
	Resend      []string         `json:"resend,omitempty"`       // keys of synced events that were updated and must be sent again
	ParserGen   string           `json:"parserGen,omitempty"`    // parser version the files were last read with
	Budget      *Budget          `json:"budget,omitempty"`
	NotifiedPct int              `json:"notifiedPct"`
	NotifiedMon string           `json:"notifiedMonth"`
	Prefs       Prefs            `json:"prefs"`
}

type Store struct {
	Dir     string
	mu      sync.Mutex
	State   State
	Cursors map[string]*Cursor
	events  []parse.Event
	idx     map[string]int  // event key -> position in events
	sending map[string]bool // keys in the batch being sent (from Pending until Ack)
	changed map[string]bool // keys of that batch updated while it was being sent: resend after Ack
}

func Open(dir, defaultServer string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	s := &Store{Dir: dir, Cursors: map[string]*Cursor{}, idx: map[string]int{}}
	s.State.Server = defaultServer
	s.State.Prefs = Prefs{BudgetNotifications: true, StartAtLogin: true}
	readJSON(filepath.Join(dir, "state.json"), &s.State)
	readJSON(filepath.Join(dir, "cursors.json"), &s.Cursors)
	if s.State.Server == "" {
		s.State.Server = defaultServer
	}
	f, err := os.Open(filepath.Join(dir, "events.jsonl"))
	if err == nil {
		sc := bufio.NewScanner(f)
		sc.Buffer(make([]byte, 1<<20), 1<<24)
		for sc.Scan() {
			var e parse.Event
			if json.Unmarshal(sc.Bytes(), &e) != nil {
				continue
			}
			if i, ok := s.idx[e.Key()]; ok { // a later line is an updated version of the same request
				s.events[i] = e
				continue
			}
			s.idx[e.Key()] = len(s.events)
			s.events = append(s.events, e)
		}
		f.Close()
	}
	if s.State.Synced > len(s.events) {
		s.State.Synced = len(s.events)
	}
	return s, nil
}

func readJSON(p string, v any) {
	if b, err := os.ReadFile(p); err == nil {
		json.Unmarshal(b, v)
	}
}

func writeJSON(p string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}

// Add stores new events. An event already stored is replaced only by a version that supersedes it (see
// supersedes); re-reading a file is always safe. It returns how many events were added or updated.
func (s *Store) Add(evs []parse.Event) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	f, err := os.OpenFile(filepath.Join(s.Dir, "events.jsonl"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return 0, err
	}
	defer f.Close()
	w := bufio.NewWriter(f)
	n, resend := 0, false
	for _, e := range evs {
		k := e.Key()
		i, ok := s.idx[k]
		if ok && !supersedes(s.events[i], e) {
			continue
		}
		b, _ := json.Marshal(e)
		w.Write(b)
		w.WriteByte('\n')
		n++
		if !ok {
			s.idx[k] = len(s.events)
			s.events = append(s.events, e)
			continue
		}
		s.events[i] = e
		if s.sending[k] {
			if s.changed == nil {
				s.changed = map[string]bool{}
			}
			s.changed[k] = true
		} else if i < s.State.Synced && !contains(s.State.Resend, k) {
			s.State.Resend = append(s.State.Resend, k)
			resend = true
		}
	}
	if err := w.Flush(); err != nil {
		return n, err
	}
	if resend {
		return n, writeJSON(filepath.Join(s.Dir, "state.json"), s.State)
	}
	return n, nil
}

// supersedes reports whether b is a newer version of the same request a: Claude Code writes a streamed reply
// several times with growing output, and newer parsers record more billing details. Mirrors the server's rule:
// same model, no token count goes down, speed and geo only filled in, and something changed.
func supersedes(a, b parse.Event) bool {
	if a.Model != b.Model || b.Input < a.Input || b.Output < a.Output || b.CacheWrite < a.CacheWrite || b.CacheRead < a.CacheRead ||
		b.CacheWrite1h < a.CacheWrite1h || b.WebSearches < a.WebSearches || (a.Speed != "" && a.Speed != b.Speed) || (a.Geo != "" && a.Geo != b.Geo) {
		return false
	}
	return b.Input != a.Input || b.Output != a.Output || b.CacheWrite != a.CacheWrite || b.CacheRead != a.CacheRead ||
		b.CacheWrite1h != a.CacheWrite1h || b.WebSearches != a.WebSearches || b.Speed != a.Speed || b.Geo != a.Geo
}

func contains(xs []string, x string) bool {
	for _, v := range xs {
		if v == x {
			return true
		}
	}
	return false
}

func (s *Store) Events() []parse.Event {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]parse.Event(nil), s.events...)
}

// Batch is one ingest batch: updated events that were already synced, then events not yet acknowledged.
type Batch struct {
	Events []parse.Event
	end    int
	resend []string
}

// Pending returns up to n events to send. Ack the batch once the server has accepted it.
func (s *Store) Pending(n int) Batch {
	s.mu.Lock()
	defer s.mu.Unlock()
	var b Batch
	for _, k := range s.State.Resend {
		if len(b.Events) >= n {
			break
		}
		if i, ok := s.idx[k]; ok {
			b.Events = append(b.Events, s.events[i])
		}
		b.resend = append(b.resend, k)
	}
	b.end = s.State.Synced + n - len(b.Events)
	if b.end > len(s.events) {
		b.end = len(s.events)
	}
	if b.end > s.State.Synced {
		b.Events = append(b.Events, s.events[s.State.Synced:b.end]...)
	} else {
		b.end = s.State.Synced
	}
	s.sending, s.changed = map[string]bool{}, nil
	for _, e := range b.Events {
		s.sending[e.Key()] = true
	}
	return b
}

// Ack records that the server accepted a batch. Events updated while it was being sent are queued again.
func (s *Store) Ack(b Batch) error {
	return s.Update(func(st *State) {
		if b.end > st.Synced {
			st.Synced = b.end
		}
		keep := []string{}
		for _, k := range st.Resend {
			if !contains(b.resend, k) || s.changed[k] {
				keep = append(keep, k)
			}
		}
		for k := range s.changed {
			if !contains(keep, k) {
				keep = append(keep, k)
			}
		}
		st.Resend = keep
		s.sending, s.changed = nil, nil
	})
}

func (s *Store) Queued() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.events) - s.State.Synced + len(s.State.Resend)
}

func (s *Store) Update(fn func(st *State)) error {
	s.mu.Lock()
	fn(&s.State)
	st := s.State
	s.mu.Unlock()
	return writeJSON(filepath.Join(s.Dir, "state.json"), st)
}

func (s *Store) Snapshot() State {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.State
}

func (s *Store) SaveCursors() error {
	s.mu.Lock()
	c := map[string]*Cursor{}
	for k, v := range s.Cursors {
		cp := *v
		c[k] = &cp
	}
	s.mu.Unlock()
	return writeJSON(filepath.Join(s.Dir, "cursors.json"), c)
}

func (s *Store) Cursor(path string) *Cursor {
	s.mu.Lock()
	defer s.mu.Unlock()
	c := s.Cursors[path]
	if c == nil {
		c = &Cursor{}
		s.Cursors[path] = c
	}
	return c
}

// ResetCursors makes the next scan read files under roots from the start.
func (s *Store) ResetCursors(roots []string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for p, c := range s.Cursors {
		for _, r := range roots {
			if len(p) > len(r) && p[:len(r)] == r {
				*c = Cursor{}
			}
		}
	}
}

func (s *Store) Unread(tool string, roots []string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for p, c := range s.Cursors {
		for _, r := range roots {
			if len(p) > len(r) && p[:len(r)] == r {
				n += c.Unread
			}
		}
	}
	return n
}

func (s *Store) FileCount(roots []string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for p := range s.Cursors {
		for _, r := range roots {
			if len(p) > len(r) && p[:len(r)] == r {
				n++
			}
		}
	}
	return n
}
