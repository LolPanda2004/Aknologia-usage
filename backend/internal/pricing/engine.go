package pricing

// engine.go prices one request at list price, the way the vendor bills it. It has no dependencies so the
// agent can carry an identical copy (agent/internal/pricing/engine.go; a test checks the two match).

import (
	_ "embed"
	"encoding/json"
	"math"
	"regexp"
	"strings"
	"time"
)

//go:embed catalog.json
var catalogJSON []byte

// Rates are USD per million tokens (so tokens x rate = micro-dollars).
type Rates struct {
	Input        float64 `json:"input"`
	CacheWrite5m float64 `json:"cacheWrite5m,omitempty"`
	CacheWrite1h float64 `json:"cacheWrite1h,omitempty"`
	CacheRead    float64 `json:"cacheRead"`
	Output       float64 `json:"output"`
}

// Price is one catalog row: a model's list prices from a date on.
type Price struct {
	Provider string `json:"provider"`
	Model    string `json:"model"` // normalized model ID, matched exactly
	From     string `json:"from"`  // YYYY-MM-DD, first day these prices apply
	Source   string `json:"source,omitempty"`
	Rates
	FastInput      float64 `json:"fastInput,omitempty"`  // fast mode (speed "fast"); cache rates scale with it
	FastOutput     float64 `json:"fastOutput,omitempty"` //
	GeoUS          float64 `json:"geoUS,omitempty"`      // multiplier for inference_geo "us"
	WebSearchPer1k float64 `json:"webSearchPer1k,omitempty"`
	LongOver       int64   `json:"longOver,omitempty"` // prompts over this many tokens use Long
	Long           *Rates  `json:"long,omitempty"`
}

type Catalog struct {
	Version string  `json:"version"`
	Note    string  `json:"note,omitempty"`
	Models  []Price `json:"models"`
}

// Usage is one request as recorded by the CLI. CacheWrite is all cache-write tokens; CacheWrite1h is the
// part written to the 1-hour cache (the rest is 5-minute). For Codex, Input excludes cached tokens.
type Usage struct {
	Provider     string
	Model        string
	Input        int64
	Output       int64
	CacheWrite   int64
	CacheWrite1h int64
	CacheRead    int64
	WebSearches  int64
	Speed        string
	Geo          string
	At           time.Time
}

// Cost is in micro-dollars. Priced is false when the catalog has no price for the model.
type Cost struct {
	Priced                               bool
	Model                                string
	Input, Output, CacheWrite, CacheRead float64
	Other                                float64 // per-request fees, e.g. web search
	Total, Savings                       int64
}

func DefaultCatalog() *Catalog {
	c, err := ParseCatalog(catalogJSON)
	if err != nil {
		panic("pricing: embedded catalog.json: " + err.Error())
	}
	return c
}

func ParseCatalog(b []byte) (*Catalog, error) {
	var c Catalog
	if err := json.Unmarshal(b, &c); err != nil {
		return nil, err
	}
	for i := range c.Models {
		c.Models[i].Model = Normalize(c.Models[i].Model)
	}
	return &c, nil
}

var (
	reVendorPrefix = regexp.MustCompile(`^(?:[a-z]{2,6}\.)?anthropic\.|^openai/|^anthropic/`)
	reBedrockVer   = regexp.MustCompile(`-v\d+(?::\d+)?$`)
	reDateSuffix   = regexp.MustCompile(`(?:@|-)\d{8}$`)
)

// Normalize maps the model names CLIs and clouds log to catalog IDs: lowercase, no vendor/region prefix,
// no [1m] context marker, no Bedrock version or date suffix.
func Normalize(model string) string {
	m := strings.ToLower(strings.TrimSpace(model))
	m = strings.TrimSuffix(m, "[1m]")
	m = reVendorPrefix.ReplaceAllString(m, "")
	m = reBedrockVer.ReplaceAllString(m, "")
	m = reDateSuffix.ReplaceAllString(m, "")
	return m
}

// Find returns the price in effect for model on day `at`: the latest row whose From is on or before that
// day; a "custom" row beats the catalog row with the same From.
func (c *Catalog) Find(model string, at time.Time) (*Price, bool) {
	m := Normalize(model)
	day := at.UTC().Format("2006-01-02")
	var best *Price
	for i := range c.Models {
		p := &c.Models[i]
		if p.Model != m || p.From > day {
			continue
		}
		if best == nil || p.From > best.From || (p.From == best.From && p.Source == "custom" && best.Source != "custom") {
			best = p
		}
	}
	return best, best != nil
}

// Price prices one request.
func (c *Catalog) Price(u Usage) Cost {
	p, ok := c.Find(u.Model, u.At)
	if !ok {
		return Cost{Model: Normalize(u.Model)}
	}
	return Compute(p, u)
}

// Compute applies the vendor billing rules: long-context tier by prompt size, fast mode, 5-minute vs
// 1-hour cache writes, US-only inference multiplier, and per-search fees.
func Compute(p *Price, u Usage) Cost {
	r := p.Rates
	prompt := u.Input + u.CacheRead
	if p.Provider != "openai" {
		prompt += u.CacheWrite
	}
	if p.LongOver > 0 && p.Long != nil && prompt > p.LongOver {
		r = *p.Long
	}
	if u.Speed == "fast" && p.FastInput > 0 && r.Input > 0 {
		k := p.FastInput / r.Input
		r = Rates{Input: p.FastInput, CacheWrite5m: r.CacheWrite5m * k, CacheWrite1h: r.CacheWrite1h * k, CacheRead: r.CacheRead * k, Output: p.FastOutput}
	}
	mult := 1.0
	if u.Geo == "us" && p.GeoUS > 0 {
		mult = p.GeoUS
	}
	w1 := u.CacheWrite1h
	if w1 > u.CacheWrite {
		w1 = u.CacheWrite
	}
	w5 := u.CacheWrite - w1
	c := Cost{Priced: true, Model: p.Model}
	c.Input = float64(u.Input) * r.Input * mult
	c.Output = float64(u.Output) * r.Output * mult
	c.CacheWrite = (float64(w5)*r.CacheWrite5m + float64(w1)*r.CacheWrite1h) * mult
	c.CacheRead = float64(u.CacheRead) * r.CacheRead * mult
	c.Other = float64(u.WebSearches) * p.WebSearchPer1k * 1000
	c.Total = int64(math.Round(c.Input + c.Output + c.CacheWrite + c.CacheRead + c.Other))
	// Saved by caching: what cache reads would have cost as plain input, minus the extra paid to write the cache.
	saved := float64(u.CacheRead)*(r.Input-r.CacheRead) - float64(w5)*(r.CacheWrite5m-r.Input) - float64(w1)*(r.CacheWrite1h-r.Input)
	c.Savings = int64(math.Round(saved * mult))
	return c
}
