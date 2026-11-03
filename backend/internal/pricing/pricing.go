// Package pricing turns recorded requests into API-equivalent cost at vendor list prices.
//
// The price list ships with the server (catalog.json) and is copied into the model_prices table on start.
// Rows with source 'custom' are never touched by that copy, so an operator can add or override prices in
// SQL and press Refresh data. See docs/DEPLOY.md, step 7.
package pricing

import (
	"database/sql"
	"sync"
)

type Table struct {
	mu  sync.RWMutex
	cat *Catalog
}

// Load copies the built-in catalog into model_prices (replacing earlier catalog rows) and loads all rows.
func Load(db *sql.DB) (*Table, error) {
	t := &Table{}
	if err := seed(db, DefaultCatalog()); err != nil {
		return nil, err
	}
	return t, t.Reload(db)
}

func seed(db *sql.DB, c *Catalog) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// Servers starting at the same time take turns (the lock is released when the transaction ends).
	if _, err := tx.Exec(`SELECT pg_advisory_xact_lock(73512027)`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM model_prices WHERE source = 'catalog'`); err != nil {
		return err
	}
	for _, p := range c.Models {
		var lo *Rates = p.Long
		if lo == nil {
			lo = &Rates{}
		}
		if _, err := tx.Exec(`INSERT INTO model_prices (provider, model, effective_from, source, input, cache_write_5m, cache_write_1h, cache_read, output,
			fast_input, fast_output, geo_us, web_search_per_1k, long_over, long_input, long_cache_write_5m, long_cache_write_1h, long_cache_read, long_output, catalog_version)
			VALUES ($1, $2, $3, 'catalog', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
			p.Provider, p.Model, p.From, p.Input, p.CacheWrite5m, p.CacheWrite1h, p.CacheRead, p.Output,
			p.FastInput, p.FastOutput, p.GeoUS, p.WebSearchPer1k, p.LongOver, lo.Input, lo.CacheWrite5m, lo.CacheWrite1h, lo.CacheRead, lo.Output, c.Version); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// Reload reads model_prices (catalog and custom rows).
func (t *Table) Reload(db *sql.DB) error {
	rows, err := db.Query(`SELECT provider, model, to_char(effective_from, 'YYYY-MM-DD'), source, input, cache_write_5m, cache_write_1h, cache_read, output,
		fast_input, fast_output, geo_us, web_search_per_1k, long_over, long_input, long_cache_write_5m, long_cache_write_1h, long_cache_read, long_output,
		coalesce(catalog_version, '') FROM model_prices`)
	if err != nil {
		return err
	}
	defer rows.Close()
	c := &Catalog{}
	for rows.Next() {
		var p Price
		var lo Rates
		var ver string
		if err := rows.Scan(&p.Provider, &p.Model, &p.From, &p.Source, &p.Input, &p.CacheWrite5m, &p.CacheWrite1h, &p.CacheRead, &p.Output,
			&p.FastInput, &p.FastOutput, &p.GeoUS, &p.WebSearchPer1k, &p.LongOver, &lo.Input, &lo.CacheWrite5m, &lo.CacheWrite1h, &lo.CacheRead, &lo.Output, &ver); err != nil {
			return err
		}
		p.Model = Normalize(p.Model)
		if p.LongOver > 0 {
			p.Long = &lo
		}
		if ver != "" {
			c.Version = ver
		}
		c.Models = append(c.Models, p)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	t.mu.Lock()
	t.cat = c
	t.mu.Unlock()
	return nil
}

func (t *Table) catalog() *Catalog {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return t.cat
}

// Price prices one request; Cost.Priced is false for a model with no price.
func (t *Table) Price(u Usage) Cost { return t.catalog().Price(u) }

// Catalog returns the loaded price list (for the admin console and the desktop agent).
func (t *Table) Catalog() Catalog {
	c := t.catalog()
	return Catalog{Version: c.Version, Models: append([]Price(nil), c.Models...)}
}
