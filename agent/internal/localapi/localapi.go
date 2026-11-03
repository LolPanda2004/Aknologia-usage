// Package localapi serves the desktop window on 127.0.0.1. Every request must carry the per-install
// token from <data dir>/agent.token, which only the signed-in OS user can read.
package localapi

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/aknologia/usage/agent/internal/autostart"
	"github.com/aknologia/usage/agent/internal/store"
	"github.com/aknologia/usage/agent/internal/syncer"
)

type API struct {
	A     *syncer.Agent
	Token string
	Exe   string
}

// EnsureToken creates (once) and returns the local API token.
func EnsureToken(dir string) (string, error) {
	p := filepath.Join(dir, "agent.token")
	if b, err := os.ReadFile(p); err == nil && len(b) >= 32 {
		return strings.TrimSpace(string(b)), nil
	}
	b := make([]byte, 24)
	rand.Read(b)
	t := hex.EncodeToString(b)
	return t, os.WriteFile(p, []byte(t), 0o600)
}

func (api *API) Handler() http.Handler {
	m := http.NewServeMux()
	m.HandleFunc("GET /v1/status", api.status)
	m.HandleFunc("POST /v1/auth/login", api.login)
	m.HandleFunc("POST /v1/auth/accept-invite", api.acceptInvite)
	m.HandleFunc("POST /v1/auth/forgot", api.passthroughPublic("/auth/password/forgot"))
	m.HandleFunc("POST /v1/auth/reset", api.passthroughPublic("/auth/password/reset"))
	m.HandleFunc("POST /v1/auth/logout", func(w http.ResponseWriter, r *http.Request) { api.A.Logout(); ok(w) })
	m.HandleFunc("GET /v1/summary", api.summary)
	m.HandleFunc("GET /v1/sessions", api.sessions)
	m.HandleFunc("POST /v1/sync", api.sync)
	m.HandleFunc("PUT /v1/prefs", api.prefs)
	m.HandleFunc("PUT /v1/server", api.setServer)
	m.HandleFunc("/v1/server/", api.proxy)
	return api.guard(m)
}

func (api *API) guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == "" || origin == "wails://wails" || strings.HasPrefix(origin, "http://wails.localhost") || strings.HasPrefix(origin, "http://localhost") || strings.HasPrefix(origin, "http://127.0.0.1") {
			if origin != "" {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Agent-Token")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			}
		} else {
			http.Error(w, "forbidden origin", 403)
			return
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(204)
			return
		}
		if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Agent-Token")), []byte(api.Token)) != 1 {
			writeJSON(w, 401, map[string]string{"error": "agent_token", "message": "The desktop window isn’t paired with the agent."})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}
func ok(w http.ResponseWriter) { writeJSON(w, 200, map[string]bool{"ok": true}) }

func fail(w http.ResponseWriter, err error) {
	var ae *syncer.APIError
	switch {
	case errors.As(err, &ae):
		writeJSON(w, ae.Status, map[string]string{"error": ae.Kind, "message": ae.Message})
	case errors.Is(err, syncer.ErrRemoved):
		writeJSON(w, 403, map[string]string{"error": "removed", "message": "You were removed from your organization. Tracking has stopped."})
	case errors.Is(err, syncer.ErrSignedOut):
		writeJSON(w, 401, map[string]string{"error": "signed_out", "message": "Sign in to continue."})
	default:
		writeJSON(w, 502, map[string]string{"error": "offline", "message": err.Error()})
	}
}

func (api *API) status(w http.ResponseWriter, r *http.Request) {
	st := api.A.St.Snapshot()
	now := time.Now()
	srcs := []map[string]any{}
	for _, s := range api.A.Sources {
		found := ""
		for _, root := range s.Roots {
			if fi, err := os.Stat(root); err == nil && fi.IsDir() {
				found = root
				break
			}
		}
		srcs = append(srcs, map[string]any{"tool": s.Tool, "path": found, "roots": s.Roots, "found": found != "", "files": api.A.St.FileCount(s.Roots),
			"unread": api.A.St.Unread(s.Tool, s.Roots), "eventsToday": api.A.St.EventsToday(s.Tool, now)})
	}
	writeJSON(w, 200, map[string]any{
		"signedIn": st.Token != "", "removed": st.Removed, "server": st.Server, "email": st.Email, "name": st.Name, "role": st.Role, "org": st.Org,
		"lastSync": st.LastSync, "lastError": st.LastError, "nextSync": api.A.Next(), "queued": api.A.St.Queued(), "syncing": api.A.Syncing(),
		"prefs": st.Prefs, "budget": st.Budget, "sources": srcs, "version": api.A.Version, "scannedAt": api.A.ScannedAt,
	})
}

func decode(r *http.Request, v any) error {
	return json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(v)
}

func (api *API) login(w http.ResponseWriter, r *http.Request) {
	var in struct{ Email, Password string }
	decode(r, &in)
	if err := api.A.Login(in.Email, in.Password); err != nil {
		fail(w, err)
		return
	}
	api.status(w, r)
}

func (api *API) acceptInvite(w http.ResponseWriter, r *http.Request) {
	var in struct{ Email, Code, Password string }
	decode(r, &in)
	if err := api.A.AcceptInvite(in.Email, in.Code, in.Password); err != nil {
		fail(w, err)
		return
	}
	api.status(w, r)
}

func (api *API) passthroughPublic(path string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		decode(r, &body)
		var out map[string]any
		if err := api.A.Call("POST", path, body, false, &out); err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, 200, out)
	}
}

func days(r *http.Request, def int) int {
	d, _ := strconv.Atoi(r.URL.Query().Get("days"))
	if d <= 0 || d > 400 {
		return def
	}
	return d
}

func (api *API) summary(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, api.A.St.Summary(days(r, 7), time.Now()))
}

func (api *API) sessions(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, api.A.St.SessionList(days(r, 30), time.Now()))
}

func (api *API) sync(w http.ResponseWriter, r *http.Request) {
	if err := api.A.ForceSync(); err != nil {
		fail(w, err)
		return
	}
	api.status(w, r)
}

func (api *API) prefs(w http.ResponseWriter, r *http.Request) {
	var in store.Prefs
	if decode(r, &in) != nil {
		writeJSON(w, 400, map[string]string{"error": "invalid", "message": "Invalid preferences."})
		return
	}
	before := api.A.St.Snapshot().Prefs
	api.A.St.Update(func(s *store.State) { s.Prefs = in })
	if in.StartAtLogin != before.StartAtLogin && api.Exe != "" {
		autostart.Set(in.StartAtLogin, api.Exe)
	}
	api.status(w, r)
}

func (api *API) setServer(w http.ResponseWriter, r *http.Request) {
	var in struct{ Server string }
	decode(r, &in)
	u := strings.TrimRight(strings.TrimSpace(in.Server), "/")
	if !strings.HasPrefix(u, "http://") && !strings.HasPrefix(u, "https://") {
		writeJSON(w, 400, map[string]string{"error": "invalid", "message": "Enter a URL starting with https://"})
		return
	}
	api.A.St.Update(func(s *store.State) { s.Server = u })
	api.status(w, r)
}

var allowedProxy = []string{"/me", "/support/tickets", "/agent/config"}

// proxy forwards signed-in account calls (password change, backup email, devices, tickets) to the server.
func (api *API) proxy(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/v1/server")
	allowed := false
	for _, p := range allowedProxy {
		if path == p || strings.HasPrefix(path, p+"/") {
			allowed = true
		}
	}
	if !allowed {
		writeJSON(w, 404, map[string]string{"error": "not_found", "message": "Unknown endpoint."})
		return
	}
	if r.URL.RawQuery != "" {
		path += "?" + r.URL.RawQuery
	}
	body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	code, out, _ := api.A.Raw(r.Method, path, body)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	w.Write(out)
}
