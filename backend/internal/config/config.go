// Package config reads server settings from environment variables.
package config

import (
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Port        string
	DatabaseURL string
	AppSecret   string   // signs nothing secret-bearing; used to derive token pepper
	PublicURL   string   // e.g. https://usage.yourco.com — used in email links
	CORSOrigins []string // extra origins allowed to call the API (desktop UI talks to the agent, not here)
	SMTPHost    string
	SMTPPort    int
	SMTPUser    string
	SMTPPass    string
	MailFrom    string
	WebDir      string // built admin console (ui/dist/admin)
	LandingDir  string // static landing page
	DevMode     bool   // logs emails and OTP codes instead of requiring SMTP
	SyncMinute  int    // minute past the hour when desktop agents sync
	MinAgent    string // minimum supported agent version
	DownloadURL string // where members download the desktop app (linked from invite emails)
	ProxyHops   int    // reverse proxies in front of the server that append to X-Forwarded-For (0 = none)
}

func env(k, def string) string {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		return v
	}
	return def
}

func Load() Config {
	port, _ := strconv.Atoi(env("SMTP_PORT", "587"))
	minute, _ := strconv.Atoi(env("SYNC_MINUTE", "0"))
	hops, _ := strconv.Atoi(env("TRUSTED_PROXY_HOPS", "0"))
	origins := []string{}
	for _, o := range strings.Split(env("CORS_ORIGINS", ""), ",") {
		if o = strings.TrimSpace(o); o != "" {
			origins = append(origins, o)
		}
	}
	return Config{
		Port:        env("PORT", "8080"),
		DatabaseURL: env("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/aknologia?sslmode=disable"),
		AppSecret:   env("APP_SECRET", "dev-insecure-secret-change-me"),
		PublicURL:   strings.TrimRight(env("PUBLIC_URL", "http://localhost:8080"), "/"),
		CORSOrigins: origins,
		SMTPHost:    env("SMTP_HOST", ""),
		SMTPPort:    port,
		SMTPUser:    env("SMTP_USER", ""),
		SMTPPass:    env("SMTP_PASS", ""),
		MailFrom:    env("MAIL_FROM", "Aknologia <no-reply@aknologia.local>"),
		WebDir:      env("WEB_DIR", "../ui/dist/admin"),
		LandingDir:  env("LANDING_DIR", "../landing"),
		DevMode:     env("DEV_MODE", "false") == "true",
		SyncMinute:  minute,
		MinAgent:    env("MIN_AGENT_VERSION", "1.0.0"),
		ProxyHops:   hops,
		DownloadURL: env("DOWNLOAD_URL", strings.TrimRight(env("PUBLIC_URL", "http://localhost:8080"), "/")+"/download/"),
	}
}
