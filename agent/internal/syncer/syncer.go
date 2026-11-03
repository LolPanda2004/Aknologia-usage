// Package syncer talks to the Aknologia server: sign-in, hourly sync, config, budget notifications.
package syncer

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"io"
	"log"
	"net/http"
	"os"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/aknologia/usage/agent/internal/notify"
	"github.com/aknologia/usage/agent/internal/paths"
	"github.com/aknologia/usage/agent/internal/pricing"
	"github.com/aknologia/usage/agent/internal/scan"
	"github.com/aknologia/usage/agent/internal/store"
)

type Agent struct {
	St        *store.Store
	Sources   []paths.Source
	Version   string
	http      *http.Client
	mu        sync.Mutex
	syncing   bool
	LastScan  scan.Result
	ScannedAt time.Time
	kick      chan struct{}
}

func New(st *store.Store, version string) *Agent {
	return &Agent{St: st, Sources: paths.Sources(), Version: version, http: &http.Client{Timeout: 60 * time.Second}, kick: make(chan struct{}, 1)}
}

var (
	ErrRemoved   = errors.New("removed")
	ErrSignedOut = errors.New("signed_out")
)

type APIError struct {
	Status        int
	Kind, Message string
}

func (e *APIError) Error() string { return e.Message }

// Call sends a request to the server. With auth=true it attaches the device token and handles removal / expiry.
func (a *Agent) Call(method, path string, body any, auth bool, out any) error {
	st := a.St.Snapshot()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, strings.TrimRight(st.Server, "/")+"/api/v1"+path, rd)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "aknologia-agent/"+a.Version)
	if auth {
		if st.Token == "" {
			return ErrSignedOut
		}
		req.Header.Set("Authorization", "Bearer "+st.Token)
	}
	resp, err := a.http.Do(req)
	if err != nil {
		return fmt.Errorf("Can’t reach %s. Your usage is saved and will sync later.", st.Server)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		var e struct{ Error, Message string }
		json.Unmarshal(raw, &e)
		if auth && e.Error == "removed" {
			a.St.Update(func(s *store.State) { s.Removed, s.Token = true, "" })
			return ErrRemoved
		}
		if auth && resp.StatusCode == 401 {
			a.St.Update(func(s *store.State) { s.Token = "" })
			return ErrSignedOut
		}
		if e.Message == "" {
			e.Message = resp.Status
		}
		return &APIError{Status: resp.StatusCode, Kind: e.Error, Message: e.Message}
	}
	if out != nil {
		return json.Unmarshal(raw, out)
	}
	return nil
}

// Raw forwards a request body unchanged and returns the server's status and body (used by the local API proxy).
func (a *Agent) Raw(method, path string, body []byte) (int, []byte, error) {
	st := a.St.Snapshot()
	if st.Token == "" {
		return 401, []byte(`{"error":"signed_out","message":"Sign in to continue."}`), nil
	}
	req, _ := http.NewRequest(method, strings.TrimRight(st.Server, "/")+"/api/v1"+path, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+st.Token)
	resp, err := a.http.Do(req)
	if err != nil {
		return 502, []byte(`{"error":"offline","message":"Can’t reach the server right now."}`), nil
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode == 403 && bytes.Contains(b, []byte(`"removed"`)) {
		a.St.Update(func(s *store.State) { s.Removed, s.Token = true, "" })
	}
	return resp.StatusCode, b, nil
}

func hostname() string {
	h, _ := os.Hostname()
	return h
}

func osName() string {
	return map[string]string{"darwin": "macOS", "windows": "Windows", "linux": "Linux"}[runtime.GOOS]
}

type session struct {
	Token    string `json:"token"`
	DeviceID string `json:"deviceId"`
	User     struct{ Email, Name, Role string }
	Org      struct{ Name string }
}

func (a *Agent) adopt(s session) error {
	err := a.St.Update(func(st *store.State) {
		st.Token, st.DeviceID, st.Email, st.Name, st.Role, st.Org, st.Removed = s.Token, s.DeviceID, s.User.Email, s.User.Name, s.User.Role, s.Org.Name, false
	})
	if err == nil {
		go a.RefreshConfig()
		a.Kick()
	}
	return err
}

func (a *Agent) client() map[string]any {
	return map[string]any{"client": "desktop", "deviceName": hostname(), "os": osName(), "appVersion": a.Version}
}

func (a *Agent) Login(email, password string) error {
	body := a.client()
	body["email"], body["password"] = email, password
	var s session
	if err := a.Call("POST", "/auth/login", body, false, &s); err != nil {
		return err
	}
	return a.adopt(s)
}

func (a *Agent) AcceptInvite(email, code, password string) error {
	body := a.client()
	body["email"], body["code"], body["password"] = email, code, password
	var s session
	if err := a.Call("POST", "/auth/invite/accept", body, false, &s); err != nil {
		return err
	}
	return a.adopt(s)
}

func (a *Agent) Logout() {
	a.Call("POST", "/auth/logout", nil, true, nil)
	a.St.Update(func(s *store.State) { s.Token = "" })
}

// RefreshConfig pulls sync timing, pricing, project salt, and budget status.
func (a *Agent) RefreshConfig() error {
	var c struct {
		SyncMinute  int              `json:"syncMinute"`
		ProjectSalt string           `json:"projectSalt"`
		Catalog     *pricing.Catalog `json:"priceCatalog"`
		Budget      *store.Budget    `json:"budget"`
		Org         string           `json:"org"`
		User        struct{ Name, Email, Role string }
	}
	if err := a.Call("GET", "/agent/config", nil, true, &c); err != nil {
		return err
	}
	a.St.Update(func(s *store.State) {
		s.SyncMinute, s.ProjectSalt, s.Budget, s.Org, s.Name, s.Role = c.SyncMinute, c.ProjectSalt, c.Budget, c.Org, c.User.Name, c.User.Role
		if c.Catalog != nil && len(c.Catalog.Models) > 0 {
			s.Catalog = c.Catalog
		}
	})
	a.budgetNotice()
	return nil
}

// budgetNotice shows an OS notification the first time this month the member crosses 80% and 100%.
func (a *Agent) budgetNotice() {
	st := a.St.Snapshot()
	if st.Budget == nil || !st.Prefs.BudgetNotifications || st.Budget.BudgetCents <= 0 {
		return
	}
	level := 0
	if st.Budget.Pct >= 100 {
		level = 100
	} else if st.Budget.Pct >= 80 {
		level = 80
	}
	month := st.Budget.Month
	if month != st.NotifiedMon {
		st.NotifiedPct = 0
	}
	if level > st.NotifiedPct {
		title := fmt.Sprintf("You’ve used %d%% of your monthly budget", level)
		if level == 100 {
			title = "Monthly budget reached"
		}
		notify.Show(title, fmt.Sprintf("You’ve used $%.2f of the $%.2f %s budget set by your admin.", float64(st.Budget.SpentCents)/100, float64(st.Budget.BudgetCents)/100, month))
		a.St.Update(func(s *store.State) { s.NotifiedPct, s.NotifiedMon = level, month })
	}
}

func (a *Agent) projectHash(cwd, salt string) string {
	if cwd == "" {
		return ""
	}
	m := hmac.New(sha256.New, []byte(salt))
	m.Write([]byte(cwd))
	return hex.EncodeToString(m.Sum(nil))[:16]
}

func (a *Agent) unread() int {
	n := 0
	for _, s := range a.Sources {
		n += a.St.Unread(s.Tool, s.Roots)
	}
	return n
}

// SyncNow sends every queued event in batches. Safe to call concurrently; only one sync runs at a time.
func (a *Agent) SyncNow() error {
	a.mu.Lock()
	if a.syncing {
		a.mu.Unlock()
		return nil
	}
	a.syncing = true
	a.mu.Unlock()
	defer func() { a.mu.Lock(); a.syncing = false; a.mu.Unlock() }()
	st := a.St.Snapshot()
	if st.Token == "" || st.Removed || st.Prefs.Paused {
		return nil
	}
	if st.ProjectSalt == "" {
		if err := a.RefreshConfig(); err != nil {
			return a.fail(err)
		}
		st = a.St.Snapshot()
	}
	for {
		b := a.St.Pending(500)
		if len(b.Events) == 0 {
			break
		}
		batch := make([]map[string]any, 0, len(b.Events))
		for _, e := range b.Events {
			batch = append(batch, map[string]any{"tool": e.Tool, "sessionId": e.SessionID, "messageId": e.MessageID, "requestId": e.RequestID, "model": e.Model,
				"input": e.Input, "output": e.Output, "cacheWrite": e.CacheWrite, "cacheRead": e.CacheRead, "cacheWrite1h": e.CacheWrite1h, "speed": e.Speed,
				"geo": e.Geo, "webSearches": e.WebSearches, "ts": e.TS, "projectHash": a.projectHash(e.Cwd, st.ProjectSalt), "parserVersion": e.Parser})
		}
		var res struct{ Accepted, Duplicates, Rejected int }
		if err := a.Call("POST", "/ingest/batch", map[string]any{"appVersion": a.Version, "unreadLines": a.unread(), "events": batch}, true, &res); err != nil {
			return a.fail(err)
		}
		a.St.Ack(b)
	}
	a.St.Update(func(s *store.State) { s.LastSync, s.LastError = time.Now(), "" })
	a.RefreshConfig()
	a.pullNotifications()
	return nil
}

func (a *Agent) fail(err error) error {
	a.St.Update(func(s *store.State) { s.LastError = err.Error() })
	return err
}

func (a *Agent) pullNotifications() {
	var ns []struct {
		ID          int64
		Kind, Title string
		Body        string
		Read        bool
	}
	if a.Call("GET", "/me/notifications", nil, true, &ns) != nil {
		return
	}
	for _, n := range ns {
		if !n.Read && !strings.HasPrefix(n.Kind, "budget_") { // budget notices are shown from config to avoid duplicates
			notify.Show(n.Title, n.Body)
		}
		if !n.Read {
			a.Call("POST", fmt.Sprintf("/me/notifications/%d/read", n.ID), nil, true, nil)
		}
	}
}

func (a *Agent) Syncing() bool { a.mu.Lock(); defer a.mu.Unlock(); return a.syncing }

// NextSync is the next hourly window: minute SyncMinute past the hour plus a stable per-device jitter of up to 2 minutes.
func (a *Agent) NextSync(now time.Time) time.Time {
	st := a.St.Snapshot()
	h := fnv.New32a()
	h.Write([]byte(st.DeviceID))
	jitter := time.Duration(h.Sum32()%120) * time.Second
	t := now.Truncate(time.Hour).Add(time.Duration(st.SyncMinute)*time.Minute + jitter)
	if !t.After(now) {
		t = t.Add(time.Hour)
	}
	return t
}

func (a *Agent) Kick() {
	select {
	case a.kick <- struct{}{}:
	default:
	}
}

// ForceSync scans immediately and sends everything new.
func (a *Agent) ForceSync() error {
	for i := 0; i < 120 && a.Syncing(); i++ { // let an automatic sync that is already running finish first
		time.Sleep(250 * time.Millisecond)
	}
	a.Scan()
	return a.SyncNow()
}

func (a *Agent) Scan() {
	st := a.St.Snapshot()
	if st.Removed || st.Prefs.Paused {
		return
	}
	res, err := scan.Once(a.St, a.Sources)
	if err != nil {
		log.Printf("scan: %v", err)
	}
	a.mu.Lock()
	a.LastScan, a.ScannedAt = res, time.Now()
	a.mu.Unlock()
}

// Run scans every 20 seconds and syncs on the hourly window, until stop is closed.
func (a *Agent) Run(stop <-chan struct{}) {
	a.Scan()
	if a.St.Snapshot().Token != "" {
		go a.RefreshConfig()
	}
	scanT := time.NewTicker(20 * time.Second)
	defer scanT.Stop()
	next := a.NextSync(time.Now())
	for {
		select {
		case <-stop:
			return
		case <-a.kick:
			a.Scan()
			a.SyncNow()
			next = a.NextSync(time.Now())
		case <-scanT.C:
			a.Scan()
			if time.Now().After(next) {
				if err := a.SyncNow(); err != nil {
					log.Printf("sync: %v", err)
				}
				next = a.NextSync(time.Now())
			}
		}
	}
}

func (a *Agent) Next() time.Time { return a.NextSync(time.Now()) }
