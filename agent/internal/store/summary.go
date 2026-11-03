package store

import (
	"math"
	"path/filepath"
	"sort"
	"time"

	"github.com/aknologia/usage/agent/internal/parse"
	"github.com/aknologia/usage/agent/internal/pricing"
)

var builtinCatalog = pricing.DefaultCatalog()

// cost prices one request at list price with the server's price list (the built-in copy before the first sync).
func (s *Store) cost(e parse.Event) pricing.Cost {
	c := s.State.Catalog
	if c == nil || len(c.Models) == 0 {
		c = builtinCatalog
	}
	provider := "anthropic"
	if e.Tool == "codex" {
		provider = "openai"
	}
	return c.Price(pricing.Usage{Provider: provider, Model: e.Model, Input: e.Input, Output: e.Output, CacheWrite: e.CacheWrite, CacheWrite1h: e.CacheWrite1h,
		CacheRead: e.CacheRead, WebSearches: e.WebSearches, Speed: e.Speed, Geo: e.Geo, At: e.TS})
}

func round2(x float64) float64 { return math.Round(x*100) / 100 }

type Split struct {
	Label  string  `json:"label"`
	Tokens int64   `json:"tokens"`
	Cost   float64 `json:"cost"`
	Pct    float64 `json:"pct"`
}

type Session struct {
	ID       string    `json:"id"`
	Tool     string    `json:"tool"`
	Model    string    `json:"model"`
	Project  string    `json:"project"`
	Start    time.Time `json:"start"`
	End      time.Time `json:"end"`
	Active   float64   `json:"activeMinutes"` // rounded for display
	activeS  float64   // exact active seconds; totals add these, like the server, so they don't drift from rounding
	Turns    int       `json:"turns"`
	Tokens   int64     `json:"tokens"`
	Cost     float64   `json:"cost"`
	Split    []Split   `json:"split"`
	Activity []int64   `json:"activity"`
	Insight  string    `json:"insight"`
}

type Summary struct {
	Days        int                `json:"days"`
	From        time.Time          `json:"from"`
	ActiveHours float64            `json:"activeHours"`
	PrevHours   float64            `json:"prevActiveHours"`
	Cost        float64            `json:"cost"`
	Tokens      int64              `json:"tokens"`
	CacheShare  float64            `json:"cacheShare"`
	Saved       float64            `json:"saved"`
	Sessions    int                `json:"sessions"`
	ByTool      map[string]int     `json:"sessionsByTool"`
	CostByTool  map[string]float64 `json:"costByTool"`
	Daily       []map[string]any   `json:"daily"`
	Heat        [][]int            `json:"heat"` // 7 rows (Mon..Sun) x 12 two-hour blocks, levels 0-4
	PeakText    string             `json:"peak"`
	Models      []map[string]any   `json:"models"`
	Projects    []map[string]any   `json:"projects"`
	Recent      []Session          `json:"recent"`
	Priciest    *Session           `json:"priciest,omitempty"`
	BusiestDay  map[string]any     `json:"busiestDay,omitempty"`
	ProjectedMo float64            `json:"projectedMonth"`
	Unpriced    map[string]int     `json:"unpricedModels,omitempty"` // requests left out of cost because the model has no price
}

func project(cwd string) string {
	if cwd == "" {
		return "unknown project"
	}
	return filepath.Base(filepath.Clean(cwd))
}

// sessions groups events into sessions and computes active time (gaps under 5 minutes count; a lone turn counts 30 s).
func (s *Store) sessions(evs []parse.Event) []Session {
	type acc struct {
		evs []parse.Event
	}
	m := map[string]*acc{}
	for _, e := range evs {
		k := e.Tool + "|" + e.SessionID
		if m[k] == nil {
			m[k] = &acc{}
		}
		m[k].evs = append(m[k].evs, e)
	}
	out := []Session{}
	for _, a := range m {
		sort.Slice(a.evs, func(i, j int) bool { return a.evs[i].TS.Before(a.evs[j].TS) })
		var active float64
		var in, o, cw, cr int64
		var cin, co, ccw, ccr, other float64
		models := map[string]int{}
		cwd := ""
		for i, e := range a.evs {
			if i > 0 && e.TS.Sub(a.evs[i-1].TS) <= 5*time.Minute {
				active += e.TS.Sub(a.evs[i-1].TS).Seconds()
			} else {
				active += 30
			}
			c := s.cost(e)
			in, o, cw, cr = in+e.Input, o+e.Output, cw+e.CacheWrite, cr+e.CacheRead
			cin += c.Input / 1e6
			co += c.Output / 1e6
			ccw += c.CacheWrite / 1e6
			ccr += c.CacheRead / 1e6
			other += c.Other / 1e6
			models[e.Model]++
			if e.Cwd != "" {
				cwd = e.Cwd
			}
		}
		model, best := "", -1
		for k, v := range models {
			if v > best {
				model, best = k, v
			}
		}
		total := in + o + cw + cr
		cost := cin + co + ccw + ccr + other
		p := func(x int64) float64 {
			if total == 0 {
				return 0
			}
			return math.Round(float64(x) / float64(total) * 100)
		}
		start, end := a.evs[0].TS, a.evs[len(a.evs)-1].TS
		act := make([]int64, 24)
		span := end.Sub(start)
		for _, e := range a.evs {
			i := 0
			if span > 0 {
				i = int(float64(e.TS.Sub(start)) / float64(span) * 23.999)
			}
			act[i] += e.Input + e.Output + e.CacheWrite + e.CacheRead
		}
		sess := Session{ID: a.evs[0].SessionID, Tool: a.evs[0].Tool, Model: model, Project: project(cwd), Start: start, End: end,
			Active: math.Round(active / 60), activeS: active, Turns: len(a.evs), Tokens: total, Cost: round2(cost),
			Split:    []Split{{"Output", o, round2(co), p(o)}, {"Input", in, round2(cin), p(in)}, {"Cache write", cw, round2(ccw), p(cw)}, {"Cache read", cr, round2(ccr), p(cr)}},
			Activity: act}
		switch {
		case cost > 0 && co/cost > 0.4:
			sess.Insight = "Output tokens drove most of the cost. Long generated diffs on a large model add up quickly."
		case cost > 0 && ccr/cost > 0.4:
			sess.Insight = "Cache reads carried most of the cost because the same context was re-read on many turns."
		case cost > 0 && cin/cost > 0.3:
			sess.Insight = "Fresh input was a large share. Smaller context files would bring the cost down."
		default:
			sess.Insight = "A balanced session with most input served from cache."
		}
		out = append(out, sess)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Start.After(out[j].Start) })
	return out
}

// Summary computes the desktop overview for the last `days` days in local time.
func (s *Store) Summary(days int, now time.Time) Summary {
	if days <= 0 {
		days = 7
	}
	s.mu.Lock()
	all := append([]parse.Event(nil), s.events...)
	s.mu.Unlock()
	loc := now.Location()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	from := today.AddDate(0, 0, -days+1)
	prevFrom := from.AddDate(0, 0, -days)
	var cur, prev []parse.Event
	for _, e := range all {
		switch {
		case !e.TS.Before(from):
			cur = append(cur, e)
		case !e.TS.Before(prevFrom):
			prev = append(prev, e)
		}
	}
	sum := Summary{Days: days, From: from, ByTool: map[string]int{}, CostByTool: map[string]float64{}}
	sessions := s.sessions(cur)
	for _, p := range s.sessions(prev) {
		sum.PrevHours += p.activeS / 3600
	}
	sum.PrevHours = math.Round(sum.PrevHours*10) / 10
	var in, cw, cr int64
	dayCost := map[string][2]float64{}
	dayActive := map[string]float64{}
	modelCost := map[string]float64{}
	modelTool := map[string]string{}
	projH, projC := map[string]float64{}, map[string]float64{}
	heatSec := [7][12]float64{}
	for _, e := range cur {
		pc := s.cost(e)
		if !pc.Priced {
			if sum.Unpriced == nil {
				sum.Unpriced = map[string]int{}
			}
			sum.Unpriced[e.Model]++
		}
		c := float64(pc.Total) / 1e6
		sum.Saved += float64(pc.Savings) / 1e6
		in, cw, cr = in+e.Input, cw+e.CacheWrite, cr+e.CacheRead
		sum.Tokens += e.Input + e.Output + e.CacheWrite + e.CacheRead
		d := e.TS.In(loc).Format("2006-01-02")
		v := dayCost[d]
		if e.Tool == "codex" {
			v[1] += c
		} else {
			v[0] += c
		}
		dayCost[d] = v
		sum.CostByTool[e.Tool] += c
		name := e.Model
		if name == "" {
			name = map[string]string{"codex": "Codex default model", "claude_code": "Claude"}[e.Tool]
		}
		modelCost[name] += c
		modelTool[name] = e.Tool
		projC[project(e.Cwd)] += c
	}
	for _, ss := range sessions {
		sum.ActiveHours += ss.activeS / 3600
		sum.Sessions++
		sum.ByTool[ss.Tool]++
		projH[ss.Project] += ss.activeS / 3600
		d := ss.Start.In(loc)
		dayActive[d.Format("2006-01-02")] += ss.activeS / 3600
		wd := (int(d.Weekday()) + 6) % 7
		heatSec[wd][d.Hour()/2] += ss.activeS
	}
	sum.Cost = round2(sum.CostByTool["claude_code"] + sum.CostByTool["codex"]) // round once, like the server
	for k, v := range sum.CostByTool {
		sum.CostByTool[k] = round2(v)
	}
	sum.Saved = round2(sum.Saved)
	sum.ActiveHours = math.Round(sum.ActiveHours*10) / 10
	if in+cw+cr > 0 {
		sum.CacheShare = math.Round(float64(cr) / float64(in+cw+cr) * 100)
	}
	busiest := ""
	for i := 0; i < days; i++ {
		d := from.AddDate(0, 0, i)
		k := d.Format("2006-01-02")
		v := dayCost[k]
		sum.Daily = append(sum.Daily, map[string]any{"day": k, "label": d.Format("Mon"), "claude": round2(v[0]), "codex": round2(v[1]), "activeHours": math.Round(dayActive[k]*10) / 10})
		if busiest == "" || dayActive[k] > dayActive[busiest] {
			busiest = k
		}
	}
	if dayActive[busiest] > 0 {
		t, _ := time.ParseInLocation("2006-01-02", busiest, loc)
		sum.BusiestDay = map[string]any{"day": t.Format("Monday"), "hours": math.Round(dayActive[busiest]*10) / 10}
	}
	maxHeat := 0.0
	for _, r := range heatSec {
		for _, v := range r {
			maxHeat = math.Max(maxHeat, v)
		}
	}
	sum.Heat = make([][]int, 7)
	peakD, peakB := 0, 0
	for d := 0; d < 7; d++ {
		sum.Heat[d] = make([]int, 12)
		for b := 0; b < 12; b++ {
			if maxHeat > 0 && heatSec[d][b] > 0 {
				sum.Heat[d][b] = 1 + int(heatSec[d][b]/maxHeat*3.999)
			}
			if heatSec[d][b] > heatSec[peakD][peakB] {
				peakD, peakB = d, b
			}
		}
	}
	if maxHeat > 0 {
		names := []string{"Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"}
		sum.PeakText = names[peakD] + ", " + time.Date(2000, 1, 1, peakB*2, 0, 0, 0, time.UTC).Format("3pm") + " – " + time.Date(2000, 1, 1, (peakB*2+2)%24, 0, 0, 0, time.UTC).Format("3pm")
	}
	type kv struct {
		k string
		v float64
	}
	var ms []kv
	for k, v := range modelCost {
		ms = append(ms, kv{k, v})
	}
	sort.Slice(ms, func(i, j int) bool { return ms[i].v > ms[j].v })
	for _, m := range ms {
		share := 0.0
		if sum.Cost > 0 {
			share = math.Round(m.v / sum.Cost * 100)
		}
		sum.Models = append(sum.Models, map[string]any{"name": m.k, "tool": modelTool[m.k], "cost": round2(m.v), "share": share})
	}
	var ps []kv
	for k, v := range projH {
		ps = append(ps, kv{k, v})
	}
	sort.Slice(ps, func(i, j int) bool { return ps[i].v > ps[j].v })
	for i, p := range ps {
		if i >= 6 {
			break
		}
		sum.Projects = append(sum.Projects, map[string]any{"name": p.k, "hours": math.Round(p.v*10) / 10, "cost": round2(projC[p.k]), "pct": math.Round(p.v / ps[0].v * 100)})
	}
	for i, ss := range sessions {
		if sum.Priciest == nil || ss.Cost > sum.Priciest.Cost {
			cp := sessions[i]
			sum.Priciest = &cp
		}
	}
	if len(sessions) > 8 {
		sum.Recent = sessions[:8]
	} else {
		sum.Recent = sessions
	}
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, loc)
	var monthCost float64
	for _, e := range all {
		if !e.TS.Before(monthStart) {
			monthCost += float64(s.cost(e).Total) / 1e6
		}
	}
	elapsed := now.Sub(monthStart).Hours() / 24
	daysInMonth := monthStart.AddDate(0, 1, 0).Sub(monthStart).Hours() / 24
	if elapsed > 0.5 {
		sum.ProjectedMo = math.Round(monthCost / elapsed * daysInMonth)
	}
	return sum
}

// SessionList returns every session in the last `days` days, newest first.
func (s *Store) SessionList(days int, now time.Time) []Session {
	s.mu.Lock()
	all := append([]parse.Event(nil), s.events...)
	s.mu.Unlock()
	from := now.AddDate(0, 0, -days)
	var cur []parse.Event
	for _, e := range all {
		if e.TS.After(from) {
			cur = append(cur, e)
		}
	}
	return s.sessions(cur)
}

// EventsToday counts events per tool since local midnight (for the sources panel).
func (s *Store) EventsToday(tool string, now time.Time) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	mid := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	n := 0
	for _, e := range s.events {
		if e.Tool == tool && !e.TS.Before(mid) {
			n++
		}
	}
	return n
}
