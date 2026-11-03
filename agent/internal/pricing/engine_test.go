package pricing

import (
	"encoding/json"
	"os"
	"testing"
	"time"
)

// The desktop window must show the same cost as the server: run the server's golden cases on this copy.
func TestGoldenSameAsServer(t *testing.T) {
	b, err := os.ReadFile("../../../backend/internal/pricing/testdata/golden.json")
	if err != nil {
		t.Skip("server golden cases not found (agent built outside the repository)")
	}
	var cases []struct {
		Name  string
		Usage struct {
			Provider, Model, Speed, Geo                                     string
			Input, Output, CacheWrite, CacheWrite1h, CacheRead, WebSearches int64
		}
		Total    int64
		Unpriced bool
	}
	if err := json.Unmarshal(b, &cases); err != nil {
		t.Fatal(err)
	}
	cat := DefaultCatalog()
	for _, gc := range cases {
		u := gc.Usage
		c := cat.Price(Usage{Provider: u.Provider, Model: u.Model, Input: u.Input, Output: u.Output, CacheWrite: u.CacheWrite, CacheWrite1h: u.CacheWrite1h,
			CacheRead: u.CacheRead, WebSearches: u.WebSearches, Speed: u.Speed, Geo: u.Geo, At: time.Now()})
		if c.Priced == gc.Unpriced || (!gc.Unpriced && c.Total != gc.Total) {
			t.Errorf("%s: got priced=%v total=%d, want unpriced=%v total=%d", gc.Name, c.Priced, c.Total, gc.Unpriced, gc.Total)
		}
	}
}
