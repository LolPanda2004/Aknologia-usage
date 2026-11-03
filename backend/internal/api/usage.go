package api

import (
	"database/sql"
	"fmt"
	"log"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/aknologia/usage/backend/internal/pricing"
	"github.com/lib/pq"
)

// rollup recomputes daily_usage by adding up each request's stored cost (micro-dollars) for the given users from the org-local day containing `since`.
// The delete and the re-insert both cut off at that same org-local day, so no day is left half rebuilt.
func (s *Server) rollup(userIDs []string, since time.Time) error {
	if len(userIDs) == 0 {
		return nil
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM daily_usage d USING users u JOIN orgs o ON o.id = u.org_id
		WHERE d.user_id = u.id AND d.user_id = ANY($1) AND d.day >= ($2::timestamptz AT TIME ZONE o.timezone)::date`, pq.Array(userIDs), since); err != nil {
		return err
	}
	rows, err := tx.Query(`SELECT e.user_id, (e.ts AT TIME ZONE o.timezone)::date, e.tool, e.model,
		sum(input_tokens), sum(output_tokens), sum(cache_write_tokens), sum(cache_read_tokens), count(*),
		sum(cache_write_1h_tokens), coalesce(sum(cost_micros), 0), sum(savings_micros), count(*) FILTER (WHERE cost_micros IS NULL)
		FROM usage_events e JOIN users u ON u.id = e.user_id JOIN orgs o ON o.id = u.org_id
		WHERE e.user_id = ANY($1) AND e.ts >= $2::timestamptz - interval '1 day'
		AND (e.ts AT TIME ZONE o.timezone)::date >= ($2::timestamptz AT TIME ZONE o.timezone)::date
		GROUP BY 1, 2, 3, 4`, pq.Array(userIDs), since)
	if err != nil {
		return err
	}
	type agg struct {
		u, tool, model    string
		day               time.Time
		in, out, cw, cr   int64
		n                 int
		cw1h, cost, saved int64
		unpriced          int
	}
	var all []agg
	for rows.Next() {
		var a agg
		if err := rows.Scan(&a.u, &a.day, &a.tool, &a.model, &a.in, &a.out, &a.cw, &a.cr, &a.n, &a.cw1h, &a.cost, &a.saved, &a.unpriced); err != nil {
			rows.Close()
			return err
		}
		all = append(all, a)
	}
	rows.Close()
	for _, a := range all {
		if _, err := tx.Exec(`INSERT INTO daily_usage (user_id, day, tool, model, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, cost_micros, events,
			cache_write_1h_tokens, savings_micros, unpriced_events) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
			a.u, a.day, a.tool, a.model, a.in, a.out, a.cw, a.cr, a.cost, a.n, a.cw1h, a.saved, a.unpriced); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// reprice prices every stored request of a user again with the current price list (used by Refresh data,
// so a corrected or newly added price applies to history too).
func (s *Server) reprice(userID string) error {
	rows, err := s.DB.Query(`SELECT tool, session_id, message_id, request_id, model, input_tokens, output_tokens, cache_write_tokens,
		cache_write_1h_tokens, cache_read_tokens, web_search_requests, speed, inference_geo, ts FROM usage_events WHERE user_id = $1`, userID)
	if err != nil {
		return err
	}
	var tools, sids, mids, rids []string
	var costs, saved []int64
	for rows.Next() {
		var t, sid, mid, rid string
		var u pricing.Usage
		if err := rows.Scan(&t, &sid, &mid, &rid, &u.Model, &u.Input, &u.Output, &u.CacheWrite, &u.CacheWrite1h, &u.CacheRead, &u.WebSearches, &u.Speed, &u.Geo, &u.At); err != nil {
			rows.Close()
			return err
		}
		u.Provider = providerOf(t)
		c := s.Price.Price(u)
		cost := int64(-1) // -1 = unpriced, stored as NULL
		if c.Priced {
			cost = c.Total
		}
		tools, sids, mids, rids = append(tools, t), append(sids, sid), append(mids, mid), append(rids, rid)
		costs, saved = append(costs, cost), append(saved, c.Savings)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for i := 0; i < len(tools); i += 5000 {
		j := min(i+5000, len(tools))
		if _, err := s.DB.Exec(`UPDATE usage_events e SET cost_micros = NULLIF(v.cost, -1), savings_micros = v.saved
			FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::bigint[], $7::bigint[]) AS v(tool, sid, mid, rid, cost, saved)
			WHERE e.user_id = $1 AND e.tool = v.tool AND e.session_id = v.sid AND e.message_id = v.mid AND e.request_id = v.rid`,
			userID, pq.Array(tools[i:j]), pq.Array(sids[i:j]), pq.Array(mids[i:j]), pq.Array(rids[i:j]), pq.Array(costs[i:j]), pq.Array(saved[i:j])); err != nil {
			return err
		}
	}
	return nil
}

// PriceUnpriced prices every user's requests that have no stored cost (events from before per-request pricing,
// or models that now have a price) and rebuilds their daily totals. Run once at start.
func (s *Server) PriceUnpriced() {
	rows, err := s.DB.Query(`SELECT DISTINCT user_id FROM usage_events WHERE cost_micros IS NULL`)
	if err != nil {
		log.Printf("price unpriced: %v", err)
		return
	}
	var users []string
	for rows.Next() {
		var id string
		rows.Scan(&id)
		users = append(users, id)
	}
	rows.Close()
	for _, id := range users {
		if err := s.reprice(id); err != nil {
			log.Printf("price unpriced %s: %v", id, err)
			continue
		}
		if err := s.rollup([]string{id}, time.Now().AddDate(0, 0, -800)); err != nil {
			log.Printf("price unpriced rollup %s: %v", id, err)
		}
	}
	if len(users) > 0 {
		log.Printf("priced stored requests for %d users", len(users))
	}
}

type rangeQ struct {
	From, To time.Time // [From, To)
	TZ       string
}

func monthRange(tz string, month string) rangeQ {
	loc, err := time.LoadLocation(tz)
	if err != nil {
		loc = time.UTC
	}
	now := time.Now().In(loc)
	start := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, loc)
	if t, err := time.ParseInLocation("2006-01", month, loc); err == nil {
		start = t
	}
	return rangeQ{From: start, To: start.AddDate(0, 1, 0), TZ: tz}
}

func daysRange(tz string, days int) rangeQ {
	loc, err := time.LoadLocation(tz)
	if err != nil {
		loc = time.UTC
	}
	now := time.Now().In(loc)
	end := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc).AddDate(0, 0, 1)
	return rangeQ{From: end.AddDate(0, 0, -days), To: end, TZ: tz}
}

func usd(micros int64) float64 { return math.Round(float64(micros)/1e4) / 100 }

type userTotals struct {
	CostMicros, SavingsMicros int64
	In, Out, CW, CR           int64
	ActiveSeconds             float64
	Sessions                  int
	ClaudeMicros, CodexMicros int64
	LastActive                *time.Time
}

// totals returns per-user totals for a range. Active time counts gaps under 5 minutes between turns in a session.
func (s *Server) totals(userIDs []string, rq rangeQ) (map[string]*userTotals, error) {
	out := map[string]*userTotals{}
	for _, id := range userIDs {
		out[id] = &userTotals{}
	}
	if len(userIDs) == 0 {
		return out, nil
	}
	rows, err := s.DB.Query(`SELECT user_id, tool, model, sum(input_tokens), sum(output_tokens), sum(cache_write_tokens), sum(cache_read_tokens), sum(cost_micros), sum(savings_micros)
		FROM daily_usage WHERE user_id = ANY($1) AND day >= ($2 AT TIME ZONE $4)::date AND day < ($3 AT TIME ZONE $4)::date GROUP BY 1, 2, 3`,
		pq.Array(userIDs), rq.From, rq.To, rq.TZ)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var u, tool, model string
		var in, o, cw, cr, c, saved int64
		rows.Scan(&u, &tool, &model, &in, &o, &cw, &cr, &c, &saved)
		t := out[u]
		t.In, t.Out, t.CW, t.CR, t.CostMicros = t.In+in, t.Out+o, t.CW+cw, t.CR+cr, t.CostMicros+c
		t.SavingsMicros += saved
		if tool == "codex" {
			t.CodexMicros += c
		} else {
			t.ClaudeMicros += c
		}
	}
	rows.Close()
	rows, err = s.DB.Query(`WITH e AS (
		SELECT user_id, tool, session_id, ts, lag(ts) OVER (PARTITION BY user_id, tool, session_id ORDER BY ts) AS prev
		FROM usage_events WHERE user_id = ANY($1) AND ts >= $2 AND ts < $3)
		SELECT user_id, sum(CASE WHEN prev IS NOT NULL AND ts - prev <= interval '5 minutes' THEN extract(epoch FROM ts - prev) ELSE 30 END),
		count(DISTINCT tool || session_id), max(ts) FROM e GROUP BY user_id`, pq.Array(userIDs), rq.From, rq.To)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var u string
		var sec float64
		var n int
		var last time.Time
		rows.Scan(&u, &sec, &n, &last)
		t := out[u]
		t.ActiveSeconds, t.Sessions = sec, n
		l := last
		t.LastActive = &l
	}
	rows.Close()
	return out, nil
}

type dayPoint struct {
	Day    string  `json:"day"`
	Claude float64 `json:"claude"`
	Codex  float64 `json:"codex"`
}

func (s *Server) daily(userIDs []string, rq rangeQ) ([]dayPoint, error) {
	rows, err := s.DB.Query(`SELECT day, tool, sum(cost_micros) FROM daily_usage WHERE user_id = ANY($1) AND day >= ($2 AT TIME ZONE $4)::date AND day < ($3 AT TIME ZONE $4)::date GROUP BY 1, 2`,
		pq.Array(userIDs), rq.From, rq.To, rq.TZ)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	m := map[string]*dayPoint{}
	for rows.Next() {
		var d time.Time
		var tool string
		var c int64
		rows.Scan(&d, &tool, &c)
		k := d.Format("2006-01-02")
		if m[k] == nil {
			m[k] = &dayPoint{Day: k}
		}
		if tool == "codex" {
			m[k].Codex += usd(c)
		} else {
			m[k].Claude += usd(c)
		}
	}
	loc, _ := time.LoadLocation(rq.TZ)
	if loc == nil {
		loc = time.UTC
	}
	out := []dayPoint{}
	end := rq.To
	if now := time.Now(); now.Before(end) {
		end = now
	}
	for d := rq.From.In(loc); d.Before(end); d = d.AddDate(0, 0, 1) {
		k := d.Format("2006-01-02")
		if p := m[k]; p != nil {
			out = append(out, *p)
		} else {
			out = append(out, dayPoint{Day: k})
		}
	}
	return out, nil
}

type modelShare struct {
	Model string  `json:"model"`
	Tool  string  `json:"tool"`
	Cost  float64 `json:"cost"`
	Share float64 `json:"share"`
}

func (s *Server) models(userIDs []string, rq rangeQ) ([]modelShare, error) {
	rows, err := s.DB.Query(`SELECT model, tool, sum(cost_micros) FROM daily_usage WHERE user_id = ANY($1) AND day >= ($2 AT TIME ZONE $4)::date AND day < ($3 AT TIME ZONE $4)::date GROUP BY 1, 2 ORDER BY 3 DESC`,
		pq.Array(userIDs), rq.From, rq.To, rq.TZ)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []modelShare
	var total int64
	type raw struct {
		m, t string
		c    int64
	}
	var rs []raw
	for rows.Next() {
		var r raw
		rows.Scan(&r.m, &r.t, &r.c)
		rs = append(rs, r)
		total += r.c
	}
	for _, r := range rs {
		share := 0.0
		if total > 0 {
			share = math.Round(float64(r.c)/float64(total)*1000) / 10
		}
		name := r.m
		if name == "" {
			name = map[string]string{"codex": "Codex default model", "claude_code": "Claude (unknown model)"}[r.t]
		}
		out = append(out, modelShare{Model: name, Tool: r.t, Cost: usd(r.c), Share: share})
	}
	if out == nil {
		out = []modelShare{}
	}
	return out, nil
}

func (s *Server) orgTZ(orgID string) string {
	var tz string
	s.DB.QueryRow(`SELECT timezone FROM orgs WHERE id = $1`, orgID).Scan(&tz)
	if tz == "" {
		tz = "UTC"
	}
	return tz
}

// budgetFor returns the member's effective monthly budget in cents.
func (s *Server) budgetFor(userID string) (int, bool) {
	var own sql.NullInt64
	var def int
	s.DB.QueryRow(`SELECT u.budget_cents, o.default_budget_cents FROM users u JOIN orgs o ON o.id = u.org_id WHERE u.id = $1`, userID).Scan(&own, &def)
	if own.Valid {
		return int(own.Int64), true
	}
	return def, false
}

type sessionRow struct {
	Started string  `json:"started"`
	Project string  `json:"project"`
	Tool    string  `json:"tool"`
	Model   string  `json:"model"`
	Active  float64 `json:"activeMinutes"`
	Cost    float64 `json:"cost"`
	Tokens  int64   `json:"tokens"`
}

func (s *Server) recentSessions(userID string, limit int) ([]sessionRow, error) {
	rows, err := s.DB.Query(`WITH e AS (
		SELECT tool, session_id, ts, model, project_hash, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, cost_micros,
		lag(ts) OVER (PARTITION BY tool, session_id ORDER BY ts) prev FROM usage_events WHERE user_id = $1 AND ts > now() - interval '30 days')
		SELECT tool, session_id, min(ts), max(project_hash), mode() WITHIN GROUP (ORDER BY model),
		sum(CASE WHEN prev IS NOT NULL AND ts - prev <= interval '5 minutes' THEN extract(epoch FROM ts - prev) ELSE 30 END),
		sum(input_tokens), sum(output_tokens), sum(cache_write_tokens), sum(cache_read_tokens), coalesce(sum(cost_micros), 0)
		FROM e GROUP BY tool, session_id ORDER BY min(ts) DESC LIMIT $2`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []sessionRow{}
	for rows.Next() {
		var tool, sid, proj, model string
		var started time.Time
		var sec float64
		var in, o, cw, cr, cost int64
		rows.Scan(&tool, &sid, &started, &proj, &model, &sec, &in, &o, &cw, &cr, &cost)
		if len(proj) > 6 {
			proj = "proj-" + proj[:6]
		}
		out = append(out, sessionRow{Started: started.Format(time.RFC3339), Project: proj, Tool: tool, Model: model,
			Active: math.Round(sec / 60), Cost: usd(cost), Tokens: in + o + cw + cr})
	}
	return out, nil
}

func initials(name, email string) string {
	f := strings.Fields(name)
	switch {
	case len(f) >= 2:
		return strings.ToUpper(string([]rune(f[0])[:1]) + string([]rune(f[len(f)-1])[:1]))
	case len(f) == 1:
		return strings.ToUpper(string([]rune(f[0])[:1]))
	default:
		return strings.ToUpper(email[:1])
	}
}

func hours(sec float64) float64 { return math.Round(sec/360) / 10 }

func sortBy[T any](xs []T, less func(a, b T) bool) {
	sort.Slice(xs, func(i, j int) bool { return less(xs[i], xs[j]) })
}

func pct(a, b float64) float64 {
	if b <= 0 {
		return 0
	}
	return math.Round(a / b * 100)
}

func fmtMonth(t time.Time) string { return fmt.Sprintf("%s %d", t.Month(), t.Year()) }
