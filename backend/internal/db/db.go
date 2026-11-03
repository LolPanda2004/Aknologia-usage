// Package db opens the Postgres connection and applies embedded migrations.
package db

import (
	"context"
	"database/sql"
	"embed"
	"fmt"
	"sort"
	"strings"
	"time"

	_ "github.com/lib/pq"
)

//go:embed migrations/*.sql
var migrations embed.FS

// Open connects to Postgres (Neon or local) and verifies the connection.
func Open(url string) (*sql.DB, error) {
	d, err := sql.Open("postgres", url)
	if err != nil {
		return nil, err
	}
	d.SetMaxOpenConns(10)
	d.SetMaxIdleConns(5)
	d.SetConnMaxIdleTime(4 * time.Minute) // Neon suspends idle compute; keep idle conns short-lived
	var lastErr error
	for i := 0; i < 5; i++ { // Neon cold start can take a few seconds
		if lastErr = d.Ping(); lastErr == nil {
			return d, nil
		}
		time.Sleep(time.Duration(i+1) * time.Second)
	}
	return nil, fmt.Errorf("database unreachable: %w", lastErr)
}

// Migrate applies every migration file not yet recorded, in name order, each in its own transaction. A database
// lock makes several servers starting at once (e.g. two instances of one deploy) apply them one at a time.
func Migrate(d *sql.DB) error {
	ctx := context.Background()
	conn, err := d.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	if _, err := conn.ExecContext(ctx, `SELECT pg_advisory_lock(73512026)`); err != nil {
		return err
	}
	defer conn.ExecContext(ctx, `SELECT pg_advisory_unlock(73512026)`)
	if _, err := conn.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`); err != nil {
		return err
	}
	entries, err := migrations.ReadDir("migrations")
	if err != nil {
		return err
	}
	names := []string{}
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".sql") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	for _, n := range names {
		var exists bool
		if err := conn.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE name = $1)`, n).Scan(&exists); err != nil {
			return err
		}
		if exists {
			continue
		}
		body, err := migrations.ReadFile("migrations/" + n)
		if err != nil {
			return err
		}
		tx, err := conn.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(string(body)); err != nil {
			tx.Rollback()
			return fmt.Errorf("migration %s: %w", n, err)
		}
		if _, err := tx.Exec(`INSERT INTO schema_migrations (name) VALUES ($1)`, n); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}
