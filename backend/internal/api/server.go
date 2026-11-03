// Package api implements the HTTP API used by the admin console, the desktop agent, and the landing page.
package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/aknologia/usage/backend/internal/auth"
	"github.com/aknologia/usage/backend/internal/config"
	"github.com/aknologia/usage/backend/internal/mail"
	"github.com/aknologia/usage/backend/internal/pricing"
)

type Server struct {
	DB    *sql.DB
	Cfg   config.Config
	Mail  *mail.Sender
	Price *pricing.Table
	lim   *limiter
}

type User struct {
	ID, OrgID, Email, Name, Role, Status string
	DeviceID                             sql.NullString
	TokenHash                            string
}

type ctxKey struct{}

func New(db *sql.DB, cfg config.Config, m *mail.Sender, p *pricing.Table) *Server {
	return &Server{DB: db, Cfg: cfg, Mail: m, Price: p, lim: &limiter{hits: map[string][]time.Time{}}}
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	pub := func(p string, h http.HandlerFunc) { mux.HandleFunc(p, h) }
	authed := func(p string, h http.HandlerFunc) { mux.Handle(p, s.requireUser(h)) }
	admin := func(p string, h http.HandlerFunc) { mux.Handle(p, s.requireUser(s.requireAdmin(h))) }

	pub("GET /api/v1/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"ok": true, "time": time.Now()})
	})
	pub("POST /api/v1/auth/signup", s.limit(s.signup))
	pub("POST /api/v1/auth/verify-email", s.limit(s.verifyEmail))
	pub("POST /api/v1/auth/login", s.limit(s.login))
	pub("POST /api/v1/auth/invite/accept", s.limit(s.acceptInvite))
	pub("POST /api/v1/auth/password/forgot", s.limit(s.forgotPassword))
	pub("POST /api/v1/auth/password/reset", s.limit(s.resetPassword))
	pub("POST /api/v1/demo-requests", s.limit(s.demoRequest))

	authed("POST /api/v1/auth/logout", s.logout)
	authed("GET /api/v1/me", s.me)
	authed("POST /api/v1/me/password/start", s.changePasswordStart)
	authed("POST /api/v1/me/password/confirm", s.changePasswordConfirm)
	authed("POST /api/v1/me/backup-email", s.backupEmailStart)
	authed("POST /api/v1/me/backup-email/verify", s.backupEmailVerify)
	authed("DELETE /api/v1/me/backup-email", s.backupEmailRemove)
	authed("PATCH /api/v1/me/settings", s.updateMySettings)
	authed("GET /api/v1/me/devices", s.myDevices)
	authed("DELETE /api/v1/me/devices/{id}", s.revokeMyDevice)
	authed("GET /api/v1/me/usage", s.myUsage)
	authed("GET /api/v1/me/notifications", s.myNotifications)
	authed("POST /api/v1/me/notifications/{id}/read", s.readNotification)
	authed("GET /api/v1/agent/config", s.agentConfig)
	authed("POST /api/v1/ingest/batch", s.ingestBatch)
	authed("GET /api/v1/support/tickets", s.listTickets)
	authed("POST /api/v1/support/tickets", s.createTicket)

	admin("GET /api/v1/admin/overview", s.adminOverview)
	admin("GET /api/v1/admin/members", s.adminMembers)
	admin("POST /api/v1/admin/members/invite", s.adminInvite)
	admin("POST /api/v1/admin/members/{id}/resend", s.adminResendInvite)
	admin("PATCH /api/v1/admin/members/{id}", s.adminUpdateMember)
	admin("DELETE /api/v1/admin/members/{id}", s.adminRemoveMember)
	admin("GET /api/v1/admin/members/{id}/usage", s.adminMemberUsage)
	admin("GET /api/v1/admin/budgets", s.adminBudgets)
	admin("PUT /api/v1/admin/budgets", s.adminUpdateBudgets)
	admin("GET /api/v1/admin/org", s.adminOrg)
	admin("PUT /api/v1/admin/org", s.adminUpdateOrg)
	admin("GET /api/v1/admin/billing", s.adminBilling)
	admin("POST /api/v1/admin/billing/seats", s.adminSetSeats)
	admin("POST /api/v1/admin/refresh", s.adminRefresh)
	admin("GET /api/v1/admin/export.csv", s.adminExport)
	admin("POST /api/v1/admin/data/delete/start", s.adminDeleteStart)
	admin("POST /api/v1/admin/data/delete/confirm", s.adminDeleteConfirm)
	admin("GET /api/v1/admin/pricing", s.adminPricing)

	// Admin console SPA at /app/, landing page at /.
	mux.Handle("/app/", http.StripPrefix("/app", spa(s.Cfg.WebDir)))
	mux.Handle("/", static(s.Cfg.LandingDir))
	return s.cors(logRequests(mux))
}

// ---------- middleware ----------

func (s *Server) requireUser(next http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h0 := r.Header.Get("Authorization")
		tok := ""
		if len(h0) > 7 && strings.EqualFold(h0[:7], "Bearer ") { // only the Bearer scheme is accepted
			tok = strings.TrimSpace(h0[7:])
		}
		if tok == "" {
			writeErr(w, 401, "unauthorized", "Sign in to continue.")
			return
		}
		h := auth.Hash(tok)
		var u User
		var expires time.Time
		var revoked sql.NullTime
		err := s.DB.QueryRow(`SELECT u.id, u.org_id, u.email, u.name, u.role, u.status, s.device_id, s.expires_at, s.revoked_at
			FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1`, h).
			Scan(&u.ID, &u.OrgID, &u.Email, &u.Name, &u.Role, &u.Status, &u.DeviceID, &expires, &revoked)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			serverErr(w, err)
			return
		}
		if err == nil && u.Status == "removed" { // checked first so a removed member's agent can stop tracking
			writeErr(w, 403, "removed", "You were removed from this organization. Tracking has stopped.")
			return
		}
		if errors.Is(err, sql.ErrNoRows) || revoked.Valid || time.Now().After(expires) {
			writeErr(w, 401, "unauthorized", "Your session has ended. Sign in again.")
			return
		}
		u.TokenHash = h
		if u.DeviceID.Valid {
			s.DB.Exec(`UPDATE devices SET last_seen = now() WHERE id = $1`, u.DeviceID.String)
		}
		next(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, &u)))
	})
}

func (s *Server) requireAdmin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if current(r).Role != "admin" {
			writeErr(w, 403, "forbidden", "Only admins can do that.")
			return
		}
		next(w, r)
	}
}

func current(r *http.Request) *User { return r.Context().Value(ctxKey{}).(*User) }

// isLocalOrigin is true for http://localhost[:port] and http://127.0.0.1[:port] exactly (not look-alikes such as
// http://localhost.evil.example). Allowed in dev mode only: in production the desktop window talks to the agent.
func isLocalOrigin(origin string) bool {
	u, err := url.Parse(origin)
	if err != nil || u.Scheme != "http" || u.Path != "" || u.User != nil {
		return false
	}
	h := u.Hostname()
	return h == "localhost" || h == "127.0.0.1"
}

func (s *Server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		allowed := origin != "" && (origin == s.Cfg.PublicURL || (s.Cfg.DevMode && isLocalOrigin(origin)))
		for _, o := range s.Cfg.CORSOrigins {
			if o == origin {
				allowed = true
			}
		}
		if allowed {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(204)
			return
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		next.ServeHTTP(w, r)
	})
}

func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		if strings.HasPrefix(r.URL.Path, "/api/") {
			log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start).Round(time.Millisecond))
		}
	})
}

// limiter: at most 20 auth requests per IP per 10 minutes, to slow down code and password guessing.
type limiter struct {
	mu   sync.Mutex
	hits map[string][]time.Time
}

// clientIP is the rate-limit key. A client can put anything in X-Forwarded-For; only the entries appended by our
// own proxies can be trusted. With hops = 0 (no proxy) the socket address is used. With hops = N, the Nth entry from
// the right is the address the outermost trusted proxy saw.
func clientIP(r *http.Request, hops int) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if hops <= 0 {
		return host
	}
	parts := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
	if len(parts) < hops {
		return host
	}
	if ip := strings.TrimSpace(parts[len(parts)-hops]); ip != "" {
		return ip
	}
	return host
}

func (s *Server) limit(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ip := clientIP(r, s.Cfg.ProxyHops)
		s.lim.mu.Lock()
		cut := time.Now().Add(-10 * time.Minute)
		keep := s.lim.hits[ip][:0]
		for _, t := range s.lim.hits[ip] {
			if t.After(cut) {
				keep = append(keep, t)
			}
		}
		keep = append(keep, time.Now())
		s.lim.hits[ip] = keep
		n := len(keep)
		s.lim.mu.Unlock()
		if n > 20 && !s.Cfg.DevMode {
			writeErr(w, 429, "rate_limited", "Too many attempts. Wait a few minutes and try again.")
			return
		}
		next(w, r)
	}
}

// ---------- helpers ----------

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, kind, msg string) {
	writeJSON(w, code, map[string]string{"error": kind, "message": msg})
}

func serverErr(w http.ResponseWriter, err error) {
	if errors.Is(err, mail.ErrNotConfigured) {
		writeErr(w, 503, "email_not_configured", "This server can't send email yet, so no code was sent. Ask your admin to set up email (SMTP).")
		return
	}
	log.Printf("error: %v", err)
	writeErr(w, 500, "server_error", "Something went wrong on our side. Try again in a minute.")
}

func readJSON(r *http.Request, v any) error {
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 8<<20))
	return dec.Decode(v)
}

func bad(w http.ResponseWriter, msg string) { writeErr(w, 400, "invalid", msg) }

func spa(dir string) http.Handler {
	fs := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := filepath.Join(dir, filepath.Clean("/"+r.URL.Path))
		if st, err := os.Stat(p); err != nil || st.IsDir() {
			http.ServeFile(w, r, filepath.Join(dir, "index.html"))
			return
		}
		fs.ServeHTTP(w, r)
	})
}

func static(dir string) http.Handler { return http.FileServer(http.Dir(dir)) }
