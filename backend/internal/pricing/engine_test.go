package pricing

import (
	"bytes"
	"encoding/json"
	"os"
	"testing"
	"time"
)

type goldenCase struct {
	Name  string `json:"name"`
	Usage struct {
		Provider     string `json:"provider"`
		Model        string `json:"model"`
		Input        int64  `json:"input"`
		Output       int64  `json:"output"`
		CacheWrite   int64  `json:"cacheWrite"`
		CacheWrite1h int64  `json:"cacheWrite1h"`
		CacheRead    int64  `json:"cacheRead"`
		WebSearches  int64  `json:"webSearches"`
		Speed        string `json:"speed"`
		Geo          string `json:"geo"`
	} `json:"usage"`
	Total    int64  `json:"total"`
	Savings  *int64 `json:"savings"`
	Unpriced bool   `json:"unpriced"`
}

// Golden cases are worked out by hand from the vendors' published price tables (see testdata/golden.json).
func TestGolden(t *testing.T) {
	b, err := os.ReadFile("testdata/golden.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []goldenCase
	if err := json.Unmarshal(b, &cases); err != nil {
		t.Fatal(err)
	}
	cat := DefaultCatalog()
	for _, gc := range cases {
		u := gc.Usage
		c := cat.Price(Usage{Provider: u.Provider, Model: u.Model, Input: u.Input, Output: u.Output, CacheWrite: u.CacheWrite, CacheWrite1h: u.CacheWrite1h,
			CacheRead: u.CacheRead, WebSearches: u.WebSearches, Speed: u.Speed, Geo: u.Geo, At: time.Now()})
		switch {
		case gc.Unpriced && c.Priced:
			t.Errorf("%s: expected unpriced, got %d", gc.Name, c.Total)
		case !gc.Unpriced && !c.Priced:
			t.Errorf("%s: model %q not found in catalog", gc.Name, u.Model)
		case !gc.Unpriced && c.Total != gc.Total:
			t.Errorf("%s: total %d micro-$, want %d", gc.Name, c.Total, gc.Total)
		case gc.Savings != nil && c.Savings != *gc.Savings:
			t.Errorf("%s: savings %d, want %d", gc.Name, c.Savings, *gc.Savings)
		}
	}
}

func TestCatalogRowsAreComplete(t *testing.T) {
	seen := map[string]bool{}
	for _, p := range DefaultCatalog().Models {
		key := p.Model + "|" + p.From
		if seen[key] {
			t.Errorf("duplicate catalog row %s", key)
		}
		seen[key] = true
		if p.Input <= 0 || p.Output <= 0 || p.CacheRead <= 0 {
			t.Errorf("%s: input, output and cache read prices are required", p.Model)
		}
		if p.Provider == "anthropic" && (p.CacheWrite5m <= 0 || p.CacheWrite1h <= 0) {
			t.Errorf("%s: Anthropic rows need 5m and 1h cache write prices", p.Model)
		}
		if _, err := time.Parse("2006-01-02", p.From); err != nil {
			t.Errorf("%s: bad from date %q", p.Model, p.From)
		}
	}
}

func TestEffectiveDates(t *testing.T) {
	c := &Catalog{Models: []Price{
		{Provider: "anthropic", Model: "m", From: "2026-01-01", Rates: Rates{Input: 1, Output: 1, CacheRead: 1}},
		{Provider: "anthropic", Model: "m", From: "2026-06-01", Rates: Rates{Input: 2, Output: 2, CacheRead: 2}},
		{Provider: "anthropic", Model: "m", From: "2026-06-01", Source: "custom", Rates: Rates{Input: 3, Output: 3, CacheRead: 3}},
	}}
	at := func(s string) time.Time { t, _ := time.Parse("2006-01-02", s); return t }
	if p, _ := c.Find("m", at("2026-03-01")); p.Input != 1 {
		t.Errorf("March should use the January price, got %v", p.Input)
	}
	if p, _ := c.Find("m", at("2026-07-01")); p.Input != 3 {
		t.Errorf("July should use the custom June price, got %v", p.Input)
	}
	if _, ok := c.Find("m", at("2025-12-31")); ok {
		t.Error("no price before the first row")
	}
}

// The agent prices requests for the desktop window with its own copy of this engine; they must not drift.
func TestAgentCopyMatches(t *testing.T) {
	for _, f := range []string{"engine.go", "catalog.json"} {
		a, err1 := os.ReadFile(f)
		b, err2 := os.ReadFile("../../../agent/internal/pricing/" + f)
		if err1 != nil || err2 != nil {
			t.Fatalf("read %s: %v %v", f, err1, err2)
		}
		if !bytes.Equal(bytes.ReplaceAll(a, []byte("\r\n"), []byte("\n")), bytes.ReplaceAll(b, []byte("\r\n"), []byte("\n"))) {
			t.Errorf("agent/internal/pricing/%s differs from backend/internal/pricing/%s", f, f)
		}
	}
}
