package api

import (
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/aknologia/usage/backend/internal/mail"
	"github.com/aknologia/usage/backend/internal/pricing"
)

func logDev(format string, args ...any) { log.Printf("[dev] "+format, args...) }

type ingestEvent struct {
	Tool          string    `json:"tool"`
	SessionID     string    `json:"sessionId"`
	MessageID     string    `json:"messageId"`
	RequestID     string    `json:"requestId"`
	Model         string    `json:"model"`
	Input         int64     `json:"input"`
	Output        int64     `json:"output"`
	CacheWrite    int64     `json:"cacheWrite"`
	CacheRead     int64     `json:"cacheRead"`
	CacheWrite1h  int64     `json:"cacheWrite1h"` // part of CacheWrite written to the 1-hour cache
	Speed         string    `json:"speed"`        // "fast" = fast mode
	Geo           string    `json:"geo"`          // "us" = US-only inference
	WebSearches   int64     `json:"webSearches"`
	TS            time.Time `json:"ts"`
	ProjectHash   string    `json:"projectHash"`
	ParserVersion string    `json:"parserVersion"`
}

func (s *Server) agentConfig(w http.ResponseWriter, r *http.Request) {
	u := current(r)
	var salt, orgName string
	s.DB.QueryRow(`SELECT project_salt, name FROM orgs WHERE id = $1`, u.OrgID).Scan(&salt, &orgName)
	cat := s.Price.Catalog()
	// Agents before 1.1 match "match" as a substring, highest priority (lowest number) first: longer IDs first,
	// so claude-opus-5-5 wins over claude-opus-5.
	rates := []map[string]any{}
	for _, p := range cat.Models {
		rates = append(rates, map[string]any{"match": p.Model, "priority": 1000 - len(p.Model), "input": p.Input, "output": p.Output, "cacheWrite": p.CacheWrite5m, "cacheRead": p.CacheRead})
	}
	b, err := s.budgetStatus(u.ID, u.OrgID)
	if err != nil {
		serverErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{
		"status": u.Status, "syncMinute": s.Cfg.SyncMinute, "minAgentVersion": s.Cfg.MinAgent, "projectSalt": salt,
		"pricing": rates, "priceCatalog": cat, "budget": b, "org": orgName, "user": map[string]string{"name": u.Name, "email": u.Email, "role": u.Role},
	})
}

func (s *Server) budgetStatus(userID, orgID string) (map[string]any, error) {
	rq := monthRange(s.orgTZ(orgID), "")
	tot, err := s.totals([]string{userID}, rq)
	if err != nil {
		return nil, err
	}
	budget, custom := s.budgetFor(userID)
	spent := tot[userID].CostMicros / 10000
	days := rq.To.Sub(rq.From).Hours() / 24
	elapsed := time.Since(rq.From).Hours() / 24
	projected := 0.0
	if elapsed > 0.5 {
		projected = float64(spent) / elapsed * days
	}
	return map[string]any{"budgetCents": budget, "custom": custom, "spentCents": spent, "pct": pct(float64(spent), float64(budget)),
		"projectedCents": int(projected), "resetsOn": rq.To.Format("2006-01-02"), "month": fmtMonth(rq.From)}, nil
}

func (s *Server) ingestBatch(w http.ResponseWriter, r *http.Request) {
	u := current(r)
	var in struct {
		AppVersion  string        `json:"appVersion"`
		UnreadLines int           `json:"unreadLines"`
		Events      []ingestEvent `json:"events"`
	}
	if err := readJSON(r, &in); err != nil {
		bad(w, "Malformed batch.")
		return
	}
	if len(in.Events) > 2000 {
		bad(w, "Send at most 2000 events per batch.")
		return
	}
	tx, err := s.DB.Begin()
	if err != nil {
		serverErr(w, err)
		return
	}
	defer tx.Rollback()
	// An event the device sends again may only grow (a streamed reply's final token count, or billing details an
	// older agent didn't record); nothing that lowers its cost is accepted, so recorded spend can't be rewritten down.
	stmt, err := tx.Prepare(`INSERT INTO usage_events (user_id, device_id, tool, session_id, message_id, request_id, model, input_tokens, output_tokens,
		cache_write_tokens, cache_read_tokens, ts, project_hash, parser_version, cache_write_1h_tokens, speed, inference_geo, web_search_requests, cost_micros, savings_micros)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
		ON CONFLICT (user_id, tool, session_id, message_id, request_id) DO UPDATE SET
			input_tokens = EXCLUDED.input_tokens, output_tokens = EXCLUDED.output_tokens, cache_write_tokens = EXCLUDED.cache_write_tokens,
			cache_read_tokens = EXCLUDED.cache_read_tokens, cache_write_1h_tokens = EXCLUDED.cache_write_1h_tokens, speed = EXCLUDED.speed,
			inference_geo = EXCLUDED.inference_geo, web_search_requests = EXCLUDED.web_search_requests, parser_version = EXCLUDED.parser_version,
			cost_micros = EXCLUDED.cost_micros, savings_micros = EXCLUDED.savings_micros
		WHERE usage_events.model = EXCLUDED.model
			AND EXCLUDED.input_tokens >= usage_events.input_tokens AND EXCLUDED.output_tokens >= usage_events.output_tokens
			AND EXCLUDED.cache_write_tokens >= usage_events.cache_write_tokens AND EXCLUDED.cache_read_tokens >= usage_events.cache_read_tokens
			AND EXCLUDED.cache_write_1h_tokens >= usage_events.cache_write_1h_tokens AND EXCLUDED.web_search_requests >= usage_events.web_search_requests
			AND usage_events.speed IN ('', EXCLUDED.speed) AND usage_events.inference_geo IN ('', EXCLUDED.inference_geo)
			AND (usage_events.input_tokens, usage_events.output_tokens, usage_events.cache_write_tokens, usage_events.cache_read_tokens,
				usage_events.cache_write_1h_tokens, usage_events.speed, usage_events.inference_geo, usage_events.web_search_requests)
				IS DISTINCT FROM (EXCLUDED.input_tokens, EXCLUDED.output_tokens, EXCLUDED.cache_write_tokens, EXCLUDED.cache_read_tokens,
				EXCLUDED.cache_write_1h_tokens, EXCLUDED.speed, EXCLUDED.inference_geo, EXCLUDED.web_search_requests)
		RETURNING (xmax = 0)`)
	if err != nil {
		serverErr(w, err)
		return
	}
	accepted, updated, dup, rejected := 0, 0, 0, 0
	rollupFrom := time.Now().AddDate(0, 0, -40) // also covers late events from laptops that were offline for weeks
	// Up to 2 years back; at most 1 hour ahead (laptop clock drift). Future events would count toward today's spend.
	minTS, maxTS := time.Now().AddDate(-2, 0, 0), time.Now().Add(time.Hour)
	for _, e := range in.Events {
		if (e.Tool != "claude_code" && e.Tool != "codex") || e.SessionID == "" || e.MessageID == "" || e.TS.Before(minTS) || e.TS.After(maxTS) ||
			e.Input < 0 || e.Output < 0 || e.CacheRead < 0 || e.CacheWrite < 0 || e.CacheWrite1h < 0 || e.CacheWrite1h > e.CacheWrite ||
			e.Input > maxEventTokens || e.Output > maxEventTokens || e.CacheRead > maxEventTokens || e.CacheWrite > maxEventTokens ||
			e.WebSearches < 0 || e.WebSearches > 10000 {
			rejected++
			continue
		}
		model := trim(e.Model, 120)
		c := s.Price.Price(pricing.Usage{Provider: providerOf(e.Tool), Model: model, Input: e.Input, Output: e.Output, CacheWrite: e.CacheWrite,
			CacheWrite1h: e.CacheWrite1h, CacheRead: e.CacheRead, WebSearches: e.WebSearches, Speed: trim(e.Speed, 16), Geo: trim(e.Geo, 16), At: e.TS})
		var cost any // NULL when the model has no price
		if c.Priced {
			cost = c.Total
		}
		var inserted bool
		err := stmt.QueryRow(u.ID, u.DeviceID, e.Tool, e.SessionID, e.MessageID, e.RequestID, model, e.Input, e.Output, e.CacheWrite, e.CacheRead, e.TS,
			trim(e.ProjectHash, 64), trim(e.ParserVersion, 32), e.CacheWrite1h, trim(e.Speed, 16), trim(e.Geo, 16), e.WebSearches, cost, c.Savings).Scan(&inserted)
		switch {
		case err == sql.ErrNoRows:
			dup++
			continue
		case err != nil:
			serverErr(w, err)
			return
		case inserted:
			accepted++
		default:
			updated++
		}
		if e.TS.Before(rollupFrom) {
			rollupFrom = e.TS
		}
	}
	stmt.Close()
	if u.DeviceID.Valid {
		tx.Exec(`UPDATE devices SET last_sync = now(), app_version = coalesce(nullif($1, ''), app_version), unread_lines = $2 WHERE id = $3`, in.AppVersion, in.UnreadLines, u.DeviceID.String)
	}
	if err := tx.Commit(); err != nil {
		serverErr(w, err)
		return
	}
	if accepted+updated > 0 {
		if err := s.rollup([]string{u.ID}, rollupFrom); err != nil {
			log.Printf("rollup: %v", err)
		}
		s.evaluateBudget(u.ID, u.OrgID)
	}
	writeJSON(w, 200, map[string]any{"accepted": accepted, "updated": updated, "duplicates": dup, "rejected": rejected})
}

func providerOf(tool string) string {
	if tool == "codex" {
		return "openai"
	}
	return "anthropic"
}

// maxEventTokens is far above any real single turn; it keeps daily sums well inside int64.
const maxEventTokens = 100_000_000

func trim(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}

// evaluateBudget sends each 80% / 100% alert at most once per member per month.
func (s *Server) evaluateBudget(userID, orgID string) {
	var a80, a100, emailMember bool
	var inboxes []string
	var orgName string
	rows := s.DB.QueryRow(`SELECT name, alert_80, alert_100, email_member_at_100, array_to_string(alert_inboxes, ',') FROM orgs WHERE id = $1`, orgID)
	var inboxCSV string
	if err := rows.Scan(&orgName, &a80, &a100, &emailMember, &inboxCSV); err != nil {
		return
	}
	for _, e := range strings.Split(inboxCSV, ",") {
		if e = strings.TrimSpace(e); e != "" {
			inboxes = append(inboxes, e)
		}
	}
	if len(inboxes) == 0 {
		r, _ := s.DB.Query(`SELECT email FROM users WHERE org_id = $1 AND role = 'admin' AND status = 'active'`, orgID)
		for r != nil && r.Next() {
			var e string
			r.Scan(&e)
			inboxes = append(inboxes, e)
		}
		if r != nil {
			r.Close()
		}
	}
	b, err := s.budgetStatus(userID, orgID)
	if err != nil {
		return
	}
	spent, budget, projected := b["spentCents"].(int64), b["budgetCents"].(int), b["projectedCents"].(int)
	if budget <= 0 {
		return
	}
	var name, email string
	s.DB.QueryRow(`SELECT coalesce(nullif(name, ''), email), email FROM users WHERE id = $1`, userID).Scan(&name, &email)
	monthStart := monthRange(s.orgTZ(orgID), "").From
	for _, th := range []int{80, 100} {
		if (th == 80 && !a80) || (th == 100 && !a100) || float64(spent) < float64(budget)*float64(th)/100 {
			continue
		}
		var inserted bool
		err := s.DB.QueryRow(`INSERT INTO budget_alerts (user_id, month, threshold, spent_cents, budget_cents, sent_to) VALUES ($1, $2::date, $3, $4, $5, $6)
			ON CONFLICT DO NOTHING RETURNING true`, userID, monthStart, th, spent, budget, strings.Join(inboxes, ", ")).Scan(&inserted)
		if err == sql.ErrNoRows || !inserted {
			continue
		}
		s.Mail.Send(mail.BudgetAlert(inboxes, name, th, float64(spent)/100, float64(budget)/100, float64(projected)/100, s.Cfg.PublicURL+"/app/#/members/"+userID))
		title := fmt.Sprintf("You’ve used %d%% of your monthly budget", th)
		if th == 100 {
			title = "Monthly budget reached"
		}
		body := fmt.Sprintf("You’ve used $%.2f of the $%.2f budget set by your admin. Nothing is blocked.", float64(spent)/100, float64(budget)/100)
		s.DB.Exec(`INSERT INTO notifications (user_id, kind, title, body) VALUES ($1, $2, $3, $4)`, userID, "budget_"+strconv.Itoa(th), title, body)
		if th == 100 && emailMember {
			s.Mail.Send(mail.BudgetAlert([]string{email}, "You", th, float64(spent)/100, float64(budget)/100, float64(projected)/100, s.Cfg.PublicURL))
		}
	}
}

func (s *Server) myUsage(w http.ResponseWriter, r *http.Request) {
	u := current(r)
	days, _ := strconv.Atoi(r.URL.Query().Get("days"))
	if days <= 0 || days > 400 {
		days = 7
	}
	tz := s.orgTZ(u.OrgID)
	rq := daysRange(tz, days)
	tot, err := s.totals([]string{u.ID}, rq)
	if err != nil {
		serverErr(w, err)
		return
	}
	t := tot[u.ID]
	daily, _ := s.daily([]string{u.ID}, rq)
	models, _ := s.models([]string{u.ID}, rq)
	b, _ := s.budgetStatus(u.ID, u.OrgID)
	writeJSON(w, 200, map[string]any{"days": days, "costUsd": usd(t.CostMicros), "savedUsd": usd(t.SavingsMicros), "activeHours": hours(t.ActiveSeconds),
		"sessions": t.Sessions, "tokens": t.In + t.Out + t.CW + t.CR, "daily": daily, "models": models, "budget": b})
}

func (s *Server) myNotifications(w http.ResponseWriter, r *http.Request) {
	rows, err := s.DB.Query(`SELECT id, kind, title, body, created_at, read_at IS NOT NULL FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30`, current(r).ID)
	if err != nil {
		serverErr(w, err)
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id int64
		var kind, title, body string
		var at time.Time
		var read bool
		rows.Scan(&id, &kind, &title, &body, &at, &read)
		out = append(out, map[string]any{"id": id, "kind": kind, "title": title, "body": body, "createdAt": at, "read": read})
	}
	writeJSON(w, 200, out)
}

func (s *Server) readNotification(w http.ResponseWriter, r *http.Request) {
	s.DB.Exec(`UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2`, r.PathValue("id"), current(r).ID)
	writeJSON(w, 200, map[string]any{"ok": true})
}
