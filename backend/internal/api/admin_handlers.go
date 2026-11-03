package api

import (
	"database/sql"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/aknologia/usage/backend/internal/auth"
	"github.com/aknologia/usage/backend/internal/mail"
	"github.com/lib/pq"
)

type member struct {
	ID, Email, Name, Role, Status string
	BudgetCents                   int
	CustomBudget                  bool
	Created                       time.Time
	Removed                       sql.NullTime
}

func (s *Server) orgMembers(orgID string) ([]member, error) {
	rows, err := s.DB.Query(`SELECT u.id, u.email, u.name, u.role, u.status, coalesce(u.budget_cents, o.default_budget_cents), u.budget_cents IS NOT NULL, u.created_at, u.removed_at
		FROM users u JOIN orgs o ON o.id = u.org_id WHERE u.org_id = $1 AND u.status <> 'unverified' ORDER BY u.created_at`, orgID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []member
	for rows.Next() {
		var m member
		rows.Scan(&m.ID, &m.Email, &m.Name, &m.Role, &m.Status, &m.BudgetCents, &m.CustomBudget, &m.Created, &m.Removed)
		out = append(out, m)
	}
	return out, nil
}

func ids(ms []member, keep func(member) bool) []string {
	out := []string{}
	for _, m := range ms {
		if keep == nil || keep(m) {
			out = append(out, m.ID)
		}
	}
	return out
}

func display(m member) string {
	if m.Name != "" {
		return m.Name
	}
	return m.Email
}

func (s *Server) adminOverview(w http.ResponseWriter, r *http.Request) {
	u := current(r)
	tz := s.orgTZ(u.OrgID)
	rq := monthRange(tz, r.URL.Query().Get("month"))
	if d, _ := strconv.Atoi(r.URL.Query().Get("days")); d > 0 {
		rq = daysRange(tz, d)
	}
	ms, err := s.orgMembers(u.OrgID)
	if err != nil {
		serverErr(w, err)
		return
	}
	all := ids(ms, nil)
	tot, err := s.totals(all, rq)
	if err != nil {
		serverErr(w, err)
		return
	}
	prev := rangeQ{From: rq.From.AddDate(0, -1, 0), To: rq.From, TZ: tz}
	ptot, _ := s.totals(all, prev)
	var cost, saved, prevCost int64
	var active, prevActive float64
	var in, cr, cw int64
	activeMembers, pending, budgetsTotal := 0, 0, 0
	type row map[string]any
	rows := []row{}
	over, near := []string{}, []string{}
	health := map[string]int{"over": 0, "near": 0, "under": 0, "notStarted": 0}
	cph := []row{}
	for _, m := range ms {
		t := tot[m.ID]
		cost += t.CostMicros
		saved += t.SavingsMicros
		active += t.ActiveSeconds
		in, cr, cw = in+t.In, cr+t.CR, cw+t.CW
		prevCost += ptot[m.ID].CostMicros
		prevActive += ptot[m.ID].ActiveSeconds
		if m.Status == "removed" {
			continue
		}
		if m.Status == "invited" {
			pending++
		}
		budgetsTotal += m.BudgetCents
		spentC := float64(t.CostMicros) / 1e4
		p := pct(spentC, float64(m.BudgetCents))
		status := "On track"
		switch {
		case m.Status == "invited":
			status = "Invite pending"
			health["notStarted"]++
		case t.CostMicros == 0:
			status = "Not started"
			health["notStarted"]++
		case p >= 100:
			status = "Over budget"
			health["over"]++
			over = append(over, display(m))
		case p >= 80:
			status = "Near budget"
			health["near"]++
			near = append(near, display(m))
		default:
			health["under"]++
		}
		if t.CostMicros > 0 {
			activeMembers++
		}
		claudeShare := 0.0
		if t.CostMicros > 0 {
			claudeShare = math.Round(float64(t.ClaudeMicros) / float64(t.CostMicros) * 100)
		}
		var last any
		if t.LastActive != nil {
			last = t.LastActive
		}
		rows = append(rows, row{"id": m.ID, "name": display(m), "email": m.Email, "initials": initials(m.Name, m.Email), "status": status, "memberStatus": m.Status,
			"activeHours": hours(t.ActiveSeconds), "spend": usd(t.CostMicros), "budget": float64(m.BudgetCents) / 100, "pct": p, "claudeShare": claudeShare, "lastActive": last})
		if h := t.ActiveSeconds / 3600; h >= 1 {
			cph = append(cph, row{"name": display(m), "value": math.Round(usd(t.CostMicros)/h*100) / 100})
		}
	}
	sortBy(rows, func(a, b row) bool { return a["pct"].(float64) > b["pct"].(float64) })
	sortBy(cph, func(a, b row) bool { return a["value"].(float64) > b["value"].(float64) })
	if len(cph) > 7 {
		cph = cph[:7]
	}
	perHour, prevPerHour := 0.0, 0.0
	if active > 0 {
		perHour = math.Round(usd(cost)/(active/3600)*100) / 100
	}
	if prevActive > 0 {
		prevPerHour = math.Round(usd(prevCost)/(prevActive/3600)*100) / 100
	}
	cacheShare := 0.0
	if in+cr+cw > 0 {
		cacheShare = math.Round(float64(cr) / float64(in+cr+cw) * 100)
	}
	daily, _ := s.daily(all, rq)
	models, _ := s.models(all, rq)
	// daily active members
	dau := []row{}
	dr, err := s.DB.Query(`SELECT (ts AT TIME ZONE $4)::date, count(DISTINCT user_id) FROM usage_events WHERE user_id = ANY($1) AND ts >= $2 AND ts < $3 GROUP BY 1 ORDER BY 1`, pq.Array(all), rq.From, rq.To, tz)
	if err == nil {
		for dr.Next() {
			var d time.Time
			var n int
			dr.Scan(&d, &n)
			dau = append(dau, row{"day": d.Format("2006-01-02"), "members": n})
		}
		dr.Close()
	}
	// data health
	var devices, synced2h, unreadDevices, unreadLines int
	outdated := []string{}
	hr, err := s.DB.Query(`SELECT d.name, coalesce(nullif(u.name, ''), u.email), d.app_version, d.last_sync, d.unread_lines FROM devices d JOIN users u ON u.id = d.user_id
		WHERE u.org_id = $1 AND d.kind = 'desktop' AND d.revoked_at IS NULL AND u.status = 'active'`, u.OrgID)
	if err == nil {
		for hr.Next() {
			var dn, un, ver string
			var ls sql.NullTime
			var unread int
			hr.Scan(&dn, &un, &ver, &ls, &unread)
			devices++
			if ls.Valid && time.Since(ls.Time) < 2*time.Hour {
				synced2h++
			}
			if ver != "" && versionLess(ver, s.Cfg.MinAgent) {
				outdated = append(outdated, un)
			}
			if unread > 0 {
				unreadDevices++
				unreadLines += unread
			}
		}
		hr.Close()
	}
	// Requests whose model has no price are left out of spend; list them so an admin can add a price.
	unpriced := []map[string]any{}
	if ur, err := s.DB.Query(`SELECT d.model, sum(d.unpriced_events) FROM daily_usage d JOIN users x ON x.id = d.user_id
		WHERE x.org_id = $1 AND d.unpriced_events > 0 AND d.day >= ($2 AT TIME ZONE $4)::date AND d.day < ($3 AT TIME ZONE $4)::date
		GROUP BY 1 ORDER BY 2 DESC`, u.OrgID, rq.From, rq.To, rq.TZ); err == nil {
		for ur.Next() {
			var model string
			var n int
			ur.Scan(&model, &n)
			unpriced = append(unpriced, map[string]any{"model": model, "events": n})
		}
		ur.Close()
	}
	var refreshed sql.NullTime
	s.DB.QueryRow(`SELECT last_refreshed_at FROM orgs WHERE id = $1`, u.OrgID).Scan(&refreshed)
	daysIn := rq.To.Sub(rq.From).Hours() / 24
	elapsed := math.Min(daysIn, time.Since(rq.From).Hours()/24)
	projected := 0.0
	if elapsed > 0.5 {
		projected = usd(cost) / elapsed * daysIn
	}
	var refreshedAt any
	if refreshed.Valid {
		refreshedAt = refreshed.Time
	}
	writeJSON(w, 200, map[string]any{
		"range":  map[string]any{"from": rq.From, "to": rq.To, "label": fmtMonth(rq.From), "daysElapsed": math.Ceil(elapsed), "days": daysIn},
		"kpis":   map[string]any{"spend": usd(cost), "budgets": float64(budgetsTotal) / 100, "projected": math.Round(projected), "activeHours": hours(active), "activeMembers": activeMembers, "members": len(ms) - countStatus(ms, "removed"), "pendingInvites": pending, "costPerHour": perHour, "prevCostPerHour": prevPerHour, "saved": usd(saved), "cacheShare": cacheShare},
		"alerts": map[string]any{"over": over, "near": near},
		"daily":  daily, "models": models, "members": rows, "costPerHour": cph, "budgetHealth": health, "dailyActive": dau,
		"dataHealth": map[string]any{"devices": devices, "synced2h": synced2h, "outdated": outdated, "unreadDevices": unreadDevices, "unreadLines": unreadLines, "minVersion": s.Cfg.MinAgent,
			"unpricedModels": unpriced, "priceListVersion": s.Price.Catalog().Version},
		"refreshedAt": refreshedAt,
	})
}

func countStatus(ms []member, st string) int {
	n := 0
	for _, m := range ms {
		if m.Status == st {
			n++
		}
	}
	return n
}

func versionLess(a, b string) bool {
	pa, pb := strings.Split(a, "."), strings.Split(b, ".")
	for i := 0; i < 3; i++ {
		var x, y int
		if i < len(pa) {
			x, _ = strconv.Atoi(pa[i])
		}
		if i < len(pb) {
			y, _ = strconv.Atoi(pb[i])
		}
		if x != y {
			return x < y
		}
	}
	return false
}

func (s *Server) adminMembers(w http.ResponseWriter, r *http.Request) {
	u := current(r)
	ms, err := s.orgMembers(u.OrgID)
	if err != nil {
		serverErr(w, err)
		return
	}
	var seats int
	s.DB.QueryRow(`SELECT seats FROM orgs WHERE id = $1`, u.OrgID).Scan(&seats)
	devs := map[string][]string{}
	dr, _ := s.DB.Query(`SELECT d.user_id, d.os FROM devices d JOIN users x ON x.id = d.user_id WHERE x.org_id = $1 AND d.revoked_at IS NULL AND d.kind = 'desktop'`, u.OrgID)
	for dr != nil && dr.Next() {
		var id, os string
		dr.Scan(&id, &os)
		devs[id] = append(devs[id], os)
	}
	if dr != nil {
		dr.Close()
	}
	exp := map[string]time.Time{}
	ir, _ := s.DB.Query(`SELECT i.user_id, max(i.expires_at) FROM invites i JOIN users x ON x.id = i.user_id WHERE x.org_id = $1 AND i.used_at IS NULL GROUP BY 1`, u.OrgID)
	for ir != nil && ir.Next() {
		var id string
		var t time.Time
		ir.Scan(&id, &t)
		exp[id] = t
	}
	if ir != nil {
		ir.Close()
	}
	weekAgo := time.Now().AddDate(0, 0, -7)
	activeWeek := 0
	var aw int
	s.DB.QueryRow(`SELECT count(DISTINCT e.user_id) FROM usage_events e JOIN users x ON x.id = e.user_id WHERE x.org_id = $1 AND e.ts > $2`, u.OrgID, weekAgo).Scan(&aw)
	activeWeek = aw
	out := []map[string]any{}
	used, invited, removedMonth := 0, 0, 0
	for _, m := range ms {
		if m.Status != "removed" {
			used++
		}
		if m.Status == "invited" {
			invited++
		}
		if m.Removed.Valid && m.Removed.Time.After(time.Now().AddDate(0, -1, 0)) {
			removedMonth++
		}
		row := map[string]any{"id": m.ID, "name": display(m), "email": m.Email, "initials": initials(m.Name, m.Email), "role": m.Role, "status": m.Status,
			"budget": float64(m.BudgetCents) / 100, "customBudget": m.CustomBudget, "devices": devs[m.ID], "since": m.Created, "self": m.ID == u.ID}
		if t, ok := exp[m.ID]; ok {
			row["inviteExpires"] = t
		}
		if m.Removed.Valid {
			row["removedAt"] = m.Removed.Time
		}
		out = append(out, row)
	}
	writeJSON(w, 200, map[string]any{"seats": seats, "used": used, "invited": invited, "activeWeek": activeWeek, "removedThisMonth": removedMonth, "members": out})
}

func (s *Server) sendInvite(orgID, userID, email, inviterName string) error {
	code := auth.InviteCode()
	expires := time.Now().AddDate(0, 0, 14)
	s.DB.Exec(`UPDATE invites SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, userID)
	if _, err := s.DB.Exec(`INSERT INTO invites (code_hash, user_id, expires_at) VALUES ($1, $2, $3)`, auth.Hash(code), userID, expires); err != nil {
		return err
	}
	var orgName string
	s.DB.QueryRow(`SELECT name FROM orgs WHERE id = $1`, orgID).Scan(&orgName)
	if s.Cfg.DevMode {
		logDev("invite code for %s: %s", email, code)
	}
	return s.Mail.Send(mail.Invite(email, orgName, inviterName, code, s.Cfg.PublicURL+"/app/#/accept?email="+url.QueryEscape(email), s.Cfg.DownloadURL, expires))
}

func (s *Server) adminInvite(w http.ResponseWriter, r *http.Request) {
	u := current(r)
	var in struct {
		Emails      []string `json:"emails"`
		Role        string   `json:"role"`
		BudgetCents *int     `json:"budgetCents"`
	}
	if readJSON(r, &in) != nil || len(in.Emails) == 0 {
		bad(w, "Add at least one email.")
		return
	}
	if in.Role != "admin" {
		in.Role = "member"
	}
	var seats, used int
	s.DB.QueryRow(`SELECT seats, (SELECT count(*) FROM users WHERE org_id = $1 AND status IN ('active', 'invited')) FROM orgs WHERE id = $1`, u.OrgID).Scan(&seats, &used)
	clean, seen := []string{}, map[string]bool{}
	for _, e := range in.Emails {
		if e = normEmail(e); strings.Contains(e, "@") && !seen[e] {
			seen[e] = true
			clean = append(clean, e)
		}
	}
	// Only people who don't hold a seat yet need one: re-sending to a pending invite or an active member doesn't.
	var holding int
	s.DB.QueryRow(`SELECT count(*) FROM users WHERE org_id = $1 AND status IN ('active', 'invited') AND lower(email) = ANY($2)`, u.OrgID, pq.Array(clean)).Scan(&holding)
	if used+len(clean)-holding > seats {
		writeErr(w, 402, "seats", fmt.Sprintf("You have %d of %d seats left. Add seats in Settings and billing, or invite fewer people.", seats-used, seats))
		return
	}
	results := []map[string]string{}
	inviter := u.Name
	if inviter == "" {
		inviter = u.Email
	}
	for _, e := range clean {
		var id, org, status string
		err := s.DB.QueryRow(`SELECT id, org_id, status FROM users WHERE lower(email) = $1`, e).Scan(&id, &org, &status)
		switch {
		case err == sql.ErrNoRows:
			if err := s.DB.QueryRow(`INSERT INTO users (org_id, email, role, status, budget_cents) VALUES ($1, $2, $3, 'invited', $4) RETURNING id`, u.OrgID, e, in.Role, in.BudgetCents).Scan(&id); err != nil {
				results = append(results, map[string]string{"email": e, "result": "error"})
				continue
			}
		case err != nil:
			results = append(results, map[string]string{"email": e, "result": "error"})
			continue
		case org != u.OrgID:
			results = append(results, map[string]string{"email": e, "result": "belongs_to_another_org"})
			continue
		case status == "active":
			results = append(results, map[string]string{"email": e, "result": "already_member"})
			continue
		default: // invited or removed: re-invite
			s.DB.Exec(`UPDATE users SET status = 'invited', role = $1, budget_cents = $2, removed_at = NULL, password_hash = NULL WHERE id = $3`, in.Role, in.BudgetCents, id)
		}
		if err := s.sendInvite(u.OrgID, id, e, inviter); err != nil {
			results = append(results, map[string]string{"email": e, "result": "email_failed"})
			continue
		}
		results = append(results, map[string]string{"email": e, "result": "invited"})
	}
	writeJSON(w, 200, map[string]any{"results": results})
}

func (s *Server) memberInOrg(w http.ResponseWriter, r *http.Request) (string, string, string, bool) {
	var email, status, name string
	err := s.DB.QueryRow(`SELECT email, status, name FROM users WHERE id = $1 AND org_id = $2`, r.PathValue("id"), current(r).OrgID).Scan(&email, &status, &name)
	if err != nil {
		writeErr(w, 404, "not_found", "That member isn’t in your organization.")
		return "", "", "", false
	}
	return email, status, name, true
}

func (s *Server) adminResendInvite(w http.ResponseWriter, r *http.Request) {
	email, status, _, ok := s.memberInOrg(w, r)
	if !ok {
		return
	}
	if status != "invited" {
		bad(w, "Only pending invites can be resent.")
		return
	}
	u := current(r)
	if err := s.sendInvite(u.OrgID, r.PathValue("id"), email, u.Name); err != nil {
		serverErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) adminUpdateMember(w http.ResponseWriter, r *http.Request) {
	if _, _, _, ok := s.memberInOrg(w, r); !ok {
		return
	}
	var in map[string]json.RawMessage
	readJSON(r, &in)
	id := r.PathValue("id")
	if v, ok := in["budgetCents"]; ok {
		var c *int
		json.Unmarshal(v, &c)
		s.DB.Exec(`UPDATE users SET budget_cents = $1 WHERE id = $2`, c, id) // a new amount gets its own alerts (see budget_alerts key)
		s.evaluateBudget(id, current(r).OrgID)                               // a lower budget may already be crossed
	}
	if v, ok := in["role"]; ok {
		var role string
		json.Unmarshal(v, &role)
		if role == "member" {
			var admins int
			s.DB.QueryRow(`SELECT count(*) FROM users WHERE org_id = $1 AND role = 'admin' AND status = 'active' AND id <> $2`, current(r).OrgID, id).Scan(&admins)
			if admins == 0 {
				bad(w, "Your organization needs at least one admin.")
				return
			}
		}
		if role == "admin" || role == "member" {
			s.DB.Exec(`UPDATE users SET role = $1 WHERE id = $2`, role, id)
		}
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) adminRemoveMember(w http.ResponseWriter, r *http.Request) {
	u := current(r)
	email, status, name, ok := s.memberInOrg(w, r)
	if !ok {
		return
	}
	id := r.PathValue("id")
	if id == u.ID {
		bad(w, "You can’t remove yourself. Ask another admin.")
		return
	}
	deleteHistory := r.URL.Query().Get("deleteHistory") == "true"
	if status == "invited" { // cancel invite: no usage exists, no email needed
		s.DB.Exec(`DELETE FROM users WHERE id = $1`, id)
		writeJSON(w, 200, map[string]any{"ok": true, "cancelled": true})
		return
	}
	// The password hash is kept so a removed member who signs in with it is told they were removed (status blocks
	// access either way); re-inviting clears it.
	s.DB.Exec(`UPDATE users SET status = 'removed', removed_at = now() WHERE id = $1`, id)
	s.DB.Exec(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, id)
	s.DB.Exec(`UPDATE devices SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, id)
	if deleteHistory {
		s.DB.Exec(`DELETE FROM usage_events WHERE user_id = $1`, id)
		s.DB.Exec(`DELETE FROM daily_usage WHERE user_id = $1`, id)
	}
	if status == "active" {
		var orgName string
		s.DB.QueryRow(`SELECT name FROM orgs WHERE id = $1`, u.OrgID).Scan(&orgName)
		first := strings.Fields(name + " ")
		greet := email
		if len(first) > 0 {
			greet = first[0]
		}
		s.Mail.Send(mail.Removed(email, greet, orgName, u.Name))
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) adminMemberUsage(w http.ResponseWriter, r *http.Request) {
	u := current(r)
	if _, _, _, ok := s.memberInOrg(w, r); !ok {
		return
	}
	id := r.PathValue("id")
	tz := s.orgTZ(u.OrgID)
	rq := monthRange(tz, r.URL.Query().Get("month"))
	ms, _ := s.orgMembers(u.OrgID)
	all := ids(ms, func(m member) bool { return m.Status != "invited" })
	tot, err := s.totals(all, rq)
	if err != nil {
		serverErr(w, err)
		return
	}
	var me member
	var teamCost, teamActive, teamSessionsMin float64
	var teamCR, teamIn, n int64
	for _, m := range ms {
		if m.ID == id {
			me = m
		}
		t := tot[m.ID]
		if t != nil && t.CostMicros > 0 {
			teamCost += usd(t.CostMicros)
			teamActive += t.ActiveSeconds
			teamCR += t.CR
			teamIn += t.In + t.CW + t.CR
			teamSessionsMin += float64(t.Sessions)
			n++
		}
	}
	t := tot[id]
	if t == nil {
		t = &userTotals{}
	}
	avg := func(x float64) float64 {
		if n == 0 {
			return 0
		}
		return x / float64(n)
	}
	cph, teamCph := 0.0, 0.0
	if t.ActiveSeconds > 0 {
		cph = usd(t.CostMicros) / (t.ActiveSeconds / 3600)
	}
	if teamActive > 0 {
		teamCph = teamCost / (teamActive / 3600)
	}
	cache, teamCache := 0.0, 0.0
	if t.In+t.CW+t.CR > 0 {
		cache = math.Round(float64(t.CR) / float64(t.In+t.CW+t.CR) * 100)
	}
	if teamIn > 0 {
		teamCache = math.Round(float64(teamCR) / float64(teamIn) * 100)
	}
	daily, _ := s.daily([]string{id}, rq)
	models, _ := s.models([]string{id}, rq)
	teamModels, _ := s.models(all, rq)
	tm := map[string]float64{}
	for _, m := range teamModels {
		tm[m.Model] = m.Share
	}
	mm := []map[string]any{}
	for _, m := range models {
		mm = append(mm, map[string]any{"model": m.Model, "tool": m.Tool, "cost": m.Cost, "share": m.Share, "teamShare": tm[m.Model]})
	}
	sessions, _ := s.recentSessions(id, 8)
	devices := []map[string]any{}
	dr, _ := s.DB.Query(`SELECT name, os, app_version, last_sync, unread_lines FROM devices WHERE user_id = $1 AND kind = 'desktop' AND revoked_at IS NULL`, id)
	for dr != nil && dr.Next() {
		var name, os, ver string
		var ls sql.NullTime
		var unread int
		dr.Scan(&name, &os, &ver, &ls, &unread)
		d := map[string]any{"name": name, "os": os, "appVersion": ver, "unreadLines": unread}
		if ls.Valid {
			d["lastSync"] = ls.Time
		}
		devices = append(devices, d)
	}
	if dr != nil {
		dr.Close()
	}
	history := []map[string]any{}
	hr, _ := s.DB.Query(`SELECT threshold, sent_at, sent_to FROM budget_alerts WHERE user_id = $1 ORDER BY sent_at DESC LIMIT 10`, id)
	for hr != nil && hr.Next() {
		var th int
		var at time.Time
		var to string
		hr.Scan(&th, &at, &to)
		history = append(history, map[string]any{"threshold": th, "at": at, "sentTo": to})
	}
	if hr != nil {
		hr.Close()
	}
	b, _ := s.budgetStatus(id, u.OrgID)
	var last any
	if t.LastActive != nil {
		last = t.LastActive
	}
	writeJSON(w, 200, map[string]any{
		"member": map[string]any{"id": me.ID, "name": display(me), "email": me.Email, "initials": initials(me.Name, me.Email), "role": me.Role, "status": me.Status, "since": me.Created, "lastActive": last},
		"budget": b,
		"kpis": map[string]any{"activeHours": hours(t.ActiveSeconds), "teamActiveHours": hours(avg(teamActive)), "spend": usd(t.CostMicros), "teamSpend": math.Round(avg(teamCost)*100) / 100,
			"costPerHour": math.Round(cph*100) / 100, "teamCostPerHour": math.Round(teamCph*100) / 100, "sessions": t.Sessions, "cacheShare": cache, "teamCacheShare": teamCache},
		"daily": daily, "models": mm, "sessions": sessions, "devices": devices, "alerts": history,
	})
}

func (s *Server) adminBudgets(w http.ResponseWriter, r *http.Request) {
	u := current(r)
	var def int
	var a80, a100, weekly, em bool
	var inbox []string
	s.DB.QueryRow(`SELECT default_budget_cents, alert_80, alert_100, weekly_summary, email_member_at_100, alert_inboxes FROM orgs WHERE id = $1`, u.OrgID).
		Scan(&def, &a80, &a100, &weekly, &em, pq.Array(&inbox))
	ms, _ := s.orgMembers(u.OrgID)
	active := ids(ms, func(m member) bool { return m.Status == "active" })
	rq := monthRange(s.orgTZ(u.OrgID), "")
	tot, _ := s.totals(active, rq)
	days := rq.To.Sub(rq.From).Hours() / 24
	elapsed := math.Max(0.5, time.Since(rq.From).Hours()/24)
	sent := map[string][]string{}
	// Alerts sent for each member's current budget this month (alerts for an earlier amount stay in the log).
	ar, _ := s.DB.Query(`SELECT a.user_id, a.threshold FROM budget_alerts a JOIN users u ON u.id = a.user_id JOIN orgs o ON o.id = u.org_id
		WHERE a.month = $1::date AND a.budget_cents = coalesce(u.budget_cents, o.default_budget_cents) ORDER BY a.threshold`, rq.From)
	for ar != nil && ar.Next() {
		var id string
		var th int
		ar.Scan(&id, &th)
		sent[id] = append(sent[id], strconv.Itoa(th)+"%")
	}
	if ar != nil {
		ar.Close()
	}
	rows := []map[string]any{}
	totalBudget, totalProjected := 0.0, 0.0
	customCount := 0
	for _, m := range ms {
		if m.Status != "active" && m.Status != "invited" {
			continue
		}
		spent := 0.0
		if t := tot[m.ID]; t != nil {
			spent = usd(t.CostMicros)
		}
		proj := math.Round(spent / elapsed * days)
		totalBudget += float64(m.BudgetCents) / 100
		totalProjected += proj
		if m.CustomBudget {
			customCount++
		}
		rows = append(rows, map[string]any{"id": m.ID, "name": display(m), "budget": float64(m.BudgetCents) / 100, "custom": m.CustomBudget, "spent": spent,
			"pct": pct(spent, float64(m.BudgetCents)/100), "projected": proj, "alerts": sent[m.ID]})
	}
	sortBy(rows, func(a, b map[string]any) bool { return a["pct"].(float64) > b["pct"].(float64) })
	log := []map[string]any{}
	lr, _ := s.DB.Query(`SELECT coalesce(nullif(u.name, ''), u.email), a.threshold, a.sent_at, a.sent_to FROM budget_alerts a JOIN users u ON u.id = a.user_id WHERE u.org_id = $1 ORDER BY a.sent_at DESC LIMIT 25`, u.OrgID)
	for lr != nil && lr.Next() {
		var name, to string
		var th int
		var at time.Time
		lr.Scan(&name, &th, &at, &to)
		log = append(log, map[string]any{"name": name, "threshold": th, "at": at, "sentTo": to})
	}
	if lr != nil {
		lr.Close()
	}
	writeJSON(w, 200, map[string]any{"defaultBudget": float64(def) / 100, "alert80": a80, "alert100": a100, "weeklySummary": weekly, "emailMemberAt100": em, "inboxes": inbox,
		"totalBudget": totalBudget, "projected": totalProjected, "customCount": customCount, "members": rows, "log": log})
}

func (s *Server) adminUpdateBudgets(w http.ResponseWriter, r *http.Request) {
	u := current(r)
	var in struct {
		DefaultBudget    *float64            `json:"defaultBudget"`
		Alert80          *bool               `json:"alert80"`
		Alert100         *bool               `json:"alert100"`
		WeeklySummary    *bool               `json:"weeklySummary"`
		EmailMemberAt100 *bool               `json:"emailMemberAt100"`
		Inboxes          []string            `json:"inboxes"`
		Members          map[string]*float64 `json:"members"` // userId -> dollars, null = team default
	}
	if readJSON(r, &in) != nil {
		bad(w, "Check the values and try again.")
		return
	}
	if in.DefaultBudget != nil {
		s.DB.Exec(`UPDATE orgs SET default_budget_cents = $1 WHERE id = $2`, int(math.Round(*in.DefaultBudget*100)), u.OrgID)
	}
	set := func(col string, v *bool) {
		if v != nil {
			s.DB.Exec(`UPDATE orgs SET `+col+` = $1 WHERE id = $2`, *v, u.OrgID)
		}
	}
	set("alert_80", in.Alert80)
	set("alert_100", in.Alert100)
	set("weekly_summary", in.WeeklySummary)
	set("email_member_at_100", in.EmailMemberAt100)
	if in.Inboxes != nil {
		clean := []string{}
		for _, e := range in.Inboxes {
			if e = normEmail(e); strings.Contains(e, "@") {
				clean = append(clean, e)
			}
		}
		s.DB.Exec(`UPDATE orgs SET alert_inboxes = $1 WHERE id = $2`, pq.Array(clean), u.OrgID)
	}
	for id, v := range in.Members {
		var c *int
		if v != nil {
			x := int(math.Round(*v * 100))
			c = &x
		}
		s.DB.Exec(`UPDATE users SET budget_cents = $1 WHERE id = $2 AND org_id = $3`, c, id, u.OrgID)
	}
	// A changed budget may already be crossed: check now instead of waiting for the next sync.
	if in.DefaultBudget != nil || len(in.Members) > 0 || in.Alert80 != nil || in.Alert100 != nil {
		ms, _ := s.orgMembers(u.OrgID)
		for _, m := range ms {
			if m.Status == "active" {
				s.evaluateBudget(m.ID, u.OrgID)
			}
		}
	}
	s.adminBudgets(w, r)
}

func (s *Server) adminOrg(w http.ResponseWriter, r *http.Request) {
	u := current(r)
	var name, tz string
	s.DB.QueryRow(`SELECT name, timezone FROM orgs WHERE id = $1`, u.OrgID).Scan(&name, &tz)
	admins := []map[string]any{}
	rows, _ := s.DB.Query(`SELECT id, coalesce(nullif(name, ''), email), email, status FROM users WHERE org_id = $1 AND role = 'admin' AND status <> 'removed' ORDER BY created_at`, u.OrgID)
	for rows != nil && rows.Next() {
		var id, n, e, st string
		rows.Scan(&id, &n, &e, &st)
		admins = append(admins, map[string]any{"id": id, "name": n, "email": e, "status": st, "self": id == u.ID})
	}
	if rows != nil {
		rows.Close()
	}
	writeJSON(w, 200, map[string]any{"name": name, "timezone": tz, "admins": admins})
}

func (s *Server) adminUpdateOrg(w http.ResponseWriter, r *http.Request) {
	var in struct{ Name, Timezone string }
	readJSON(r, &in)
	u := current(r)
	if in.Name != "" {
		s.DB.Exec(`UPDATE orgs SET name = $1 WHERE id = $2`, strings.TrimSpace(in.Name), u.OrgID)
	}
	if in.Timezone != "" {
		if _, err := time.LoadLocation(in.Timezone); err != nil {
			bad(w, "Unknown time zone.")
			return
		}
		s.DB.Exec(`UPDATE orgs SET timezone = $1 WHERE id = $2`, in.Timezone, u.OrgID)
	}
	s.adminOrg(w, r)
}

var planPrices = map[string][2]float64{"starter": {0, 0}, "team": {9, 12}, "business": {18, 22}, "enterprise": {0, 0}} // annual, monthly per member

func (s *Server) adminBilling(w http.ResponseWriter, r *http.Request) {
	u := current(r)
	var plan, period string
	var seats, used int
	var renews sql.NullTime
	var email, details sql.NullString
	s.DB.QueryRow(`SELECT plan, billing_period, seats, renews_on, billing_email, billing_details, (SELECT count(*) FROM users WHERE org_id = $1 AND status IN ('active', 'invited')) FROM orgs WHERE id = $1`, u.OrgID).
		Scan(&plan, &period, &seats, &renews, &email, &details, &used)
	p := planPrices[plan]
	per := p[0]
	if period == "monthly" {
		per = p[1]
	}
	inv := []map[string]any{}
	rows, _ := s.DB.Query(`SELECT number, description, amount_cents, status, issued_on FROM invoices WHERE org_id = $1 ORDER BY issued_on DESC`, u.OrgID)
	for rows != nil && rows.Next() {
		var n, d, st string
		var a int
		var on time.Time
		rows.Scan(&n, &d, &a, &st, &on)
		inv = append(inv, map[string]any{"number": n, "description": d, "amount": float64(a) / 100, "status": st, "date": on.Format("2006-01-02")})
	}
	if rows != nil {
		rows.Close()
	}
	var ren any
	if renews.Valid {
		ren = renews.Time.Format("2006-01-02")
	}
	writeJSON(w, 200, map[string]any{"plan": plan, "period": period, "seats": seats, "used": used, "pricePerSeat": per, "monthly": per * float64(seats),
		"annualTotal": per * float64(seats) * 12, "renewsOn": ren, "billingEmail": email.String, "billingDetails": details.String, "invoices": inv,
		"paymentMethod": nil, "paymentsConfigured": false})
}

func (s *Server) adminSetSeats(w http.ResponseWriter, r *http.Request) {
	u := current(r)
	var in struct {
		Seats int    `json:"seats"`
		Plan  string `json:"plan"`
	}
	readJSON(r, &in)
	var used int
	s.DB.QueryRow(`SELECT count(*) FROM users WHERE org_id = $1 AND status IN ('active', 'invited')`, u.OrgID).Scan(&used)
	if in.Seats < used || in.Seats > 10000 {
		bad(w, fmt.Sprintf("Seats must be at least %d, the number of members and pending invites.", used))
		return
	}
	if in.Plan == "starter" && in.Seats > 3 {
		bad(w, "The Starter plan includes up to 3 members.")
		return
	}
	// Validate everything before changing anything, so a rejected change leaves the plan as it was.
	if _, ok := planPrices[in.Plan]; ok {
		s.DB.Exec(`UPDATE orgs SET plan = $1, seats = $2 WHERE id = $3`, in.Plan, in.Seats, u.OrgID)
	} else {
		s.DB.Exec(`UPDATE orgs SET seats = $1 WHERE id = $2`, in.Seats, u.OrgID)
	}
	s.adminBilling(w, r)
}

func (s *Server) adminRefresh(w http.ResponseWriter, r *http.Request) {
	u := current(r)
	ms, _ := s.orgMembers(u.OrgID)
	start := time.Now()
	if err := s.Price.Reload(s.DB); err != nil {
		serverErr(w, err)
		return
	}
	// One member at a time, so one member's bad data can't stop the rest of the org from refreshing.
	failed := 0
	for _, id := range ids(ms, nil) {
		if err := s.reprice(id); err != nil {
			log.Printf("refresh reprice %s: %v", id, err)
			failed++
			continue
		}
		if err := s.rollup([]string{id}, time.Now().AddDate(0, 0, -800)); err != nil {
			log.Printf("refresh rollup %s: %v", id, err)
			failed++
		}
	}
	for _, m := range ms {
		if m.Status == "active" {
			s.evaluateBudget(m.ID, u.OrgID)
		}
	}
	s.DB.Exec(`UPDATE orgs SET last_refreshed_at = now() WHERE id = $1`, u.OrgID)
	var events int64
	s.DB.QueryRow(`SELECT count(*) FROM usage_events e JOIN users x ON x.id = e.user_id WHERE x.org_id = $1`, u.OrgID).Scan(&events)
	writeJSON(w, 200, map[string]any{"ok": failed == 0, "failedMembers": failed, "events": events, "tookMs": time.Since(start).Milliseconds(), "refreshedAt": time.Now()})
}

func (s *Server) adminExport(w http.ResponseWriter, r *http.Request) {
	u := current(r)
	from, to := r.URL.Query().Get("from"), r.URL.Query().Get("to")
	if from == "" {
		from = time.Now().AddDate(0, -1, 0).Format("2006-01-02")
	}
	if to == "" {
		to = time.Now().AddDate(0, 0, 1).Format("2006-01-02")
	}
	if _, err := time.Parse("2006-01-02", from); err != nil {
		bad(w, "Use a from date like 2026-10-01.")
		return
	}
	if _, err := time.Parse("2006-01-02", to); err != nil {
		bad(w, "Use a to date like 2026-10-31.")
		return
	}
	rows, err := s.DB.Query(`SELECT d.day, u.email, coalesce(u.name, ''), d.tool, d.model, d.input_tokens, d.output_tokens, d.cache_write_tokens, d.cache_read_tokens, d.cost_micros
		FROM daily_usage d JOIN users u ON u.id = d.user_id WHERE u.org_id = $1 AND d.day >= $2::date AND d.day < $3::date ORDER BY d.day, u.email`, u.OrgID, from, to)
	if err != nil {
		serverErr(w, err)
		return
	}
	defer rows.Close()
	w.Header().Set("Content-Type", "text/csv")
	w.Header().Set("Content-Disposition", `attachment; filename="aknologia-usage-`+from+`-to-`+to+`.csv"`)
	cw := csv.NewWriter(w)
	cw.Write([]string{"day", "email", "name", "tool", "model", "input_tokens", "output_tokens", "cache_write_tokens", "cache_read_tokens", "cost_usd"})
	for rows.Next() {
		var day time.Time
		var e, n, t, m string
		var a, b, c, d, cost int64
		rows.Scan(&day, &e, &n, &t, &m, &a, &b, &c, &d, &cost)
		cw.Write([]string{day.Format("2006-01-02"), csvSafe(e), csvSafe(n), t, csvSafe(m), strconv.FormatInt(a, 10), strconv.FormatInt(b, 10), strconv.FormatInt(c, 10), strconv.FormatInt(d, 10), fmt.Sprintf("%.4f", float64(cost)/1e6)})
	}
	cw.Flush()
}

// csvSafe stops spreadsheet apps from running text as a formula (a member could name themselves =HYPERLINK(...)).
func csvSafe(v string) string {
	if v != "" && strings.ContainsRune("=+-@\t\r", rune(v[0])) {
		return "'" + v
	}
	return v
}

func (s *Server) adminDeleteStart(w http.ResponseWriter, r *http.Request) {
	u := current(r)
	if err := s.issueOTP(u.Email, &u.ID, "delete_data", nil); err != nil {
		serverErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"sentTo": mask(u.Email)})
}

func (s *Server) adminDeleteConfirm(w http.ResponseWriter, r *http.Request) {
	u := current(r)
	var in struct{ Code string }
	readJSON(r, &in)
	if _, err := s.checkOTP("user", u.ID, "delete_data", in.Code); err != nil {
		bad(w, err.Error())
		return
	}
	for _, q := range []string{`DELETE FROM usage_events WHERE user_id IN (SELECT id FROM users WHERE org_id = $1)`,
		`DELETE FROM daily_usage WHERE user_id IN (SELECT id FROM users WHERE org_id = $1)`,
		`DELETE FROM budget_alerts WHERE user_id IN (SELECT id FROM users WHERE org_id = $1)`} {
		if _, err := s.DB.Exec(q, u.OrgID); err != nil {
			serverErr(w, err)
			return
		}
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) adminPricing(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, s.Price.Catalog())
}

// ---------- support ----------

func (s *Server) listTickets(w http.ResponseWriter, r *http.Request) {
	u := current(r)
	rows, err := s.DB.Query(`SELECT id, kind, title, status, created_at FROM tickets WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`, u.ID)
	if err != nil {
		serverErr(w, err)
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id int64
		var kind, title, status string
		var at time.Time
		rows.Scan(&id, &kind, &title, &status, &at)
		out = append(out, map[string]any{"id": id, "kind": kind, "title": title, "status": status, "createdAt": at})
	}
	writeJSON(w, 200, out)
}

func (s *Server) createTicket(w http.ResponseWriter, r *http.Request) {
	u := current(r)
	var in struct {
		Kind, Title, Body, Severity, Started string
		Diagnostics                          map[string]any `json:"diagnostics"`
	}
	if readJSON(r, &in) != nil || strings.TrimSpace(in.Title) == "" || strings.TrimSpace(in.Body) == "" {
		bad(w, "Add a title and a description.")
		return
	}
	if in.Kind != "feature" && in.Kind != "question" {
		in.Kind = "bug"
	}
	var diag any
	if in.Diagnostics != nil {
		b, _ := json.Marshal(in.Diagnostics)
		diag = b
	}
	var id int64
	if err := s.DB.QueryRow(`INSERT INTO tickets (org_id, user_id, kind, title, body, severity, started, diagnostics) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
		u.OrgID, u.ID, in.Kind, trim(in.Title, 200), trim(in.Body, 10000), in.Severity, in.Started, diag).Scan(&id); err != nil {
		serverErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"id": id, "status": "Open"})
}
