// Command server runs the Aknologia Usage API, the admin console, and the landing page.
package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
	_ "time/tzdata" // embeds time zones so report time zones work in minimal containers

	"github.com/aknologia/usage/backend/internal/api"
	"github.com/aknologia/usage/backend/internal/config"
	"github.com/aknologia/usage/backend/internal/db"
	"github.com/aknologia/usage/backend/internal/mail"
	"github.com/aknologia/usage/backend/internal/pricing"
)

func main() {
	migrateOnly := flag.Bool("migrate", false, "apply database migrations and exit")
	flag.Parse()
	cfg := config.Load()
	if cfg.AppSecret == "dev-insecure-secret-change-me" && !cfg.DevMode {
		log.Println("warning: APP_SECRET is not set")
	}
	if cfg.SMTPHost == "" && !cfg.DevMode {
		log.Println("WARNING: SMTP_HOST is not set: sign-up and sign-in codes, invites and budget alerts can't be emailed until it is (docs/DEPLOY.md, step 2)")
	}
	d, err := db.Open(cfg.DatabaseURL)
	if err != nil {
		log.Fatal(err)
	}
	if err := db.Migrate(d); err != nil {
		log.Fatal(err)
	}
	if *migrateOnly {
		log.Println("migrations applied")
		return
	}
	prices, err := pricing.Load(d)
	if err != nil {
		log.Fatal(err)
	}
	m := &mail.Sender{Host: cfg.SMTPHost, Port: cfg.SMTPPort, User: cfg.SMTPUser, Pass: cfg.SMTPPass, From: cfg.MailFrom, LogOnly: cfg.DevMode && cfg.SMTPHost == ""}
	app := api.New(d, cfg, m, prices)
	go app.PriceUnpriced() // requests stored before per-request pricing, or whose model has gained a price
	srv := &http.Server{Addr: ":" + cfg.Port, Handler: app.Routes(), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		log.Printf("Aknologia Usage listening on :%s (dev=%v)", cfg.Port, cfg.DevMode)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	srv.Shutdown(ctx)
}
