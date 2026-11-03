// Command aknologia-agent runs in the background: it reads Claude Code and Codex usage on this device,
// keeps it locally, syncs it to your Aknologia server every hour, and serves the desktop window on 127.0.0.1.
package main

import (
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/aknologia/usage/agent/internal/autostart"
	"github.com/aknologia/usage/agent/internal/localapi"
	"github.com/aknologia/usage/agent/internal/paths"
	"github.com/aknologia/usage/agent/internal/scan"
	"github.com/aknologia/usage/agent/internal/store"
	"github.com/aknologia/usage/agent/internal/syncer"
)

var (
	version       = "1.0.0"
	defaultServer = "http://localhost:8080" // set at build time: -ldflags "-X main.defaultServer=https://usage.yourco.com"
)

func main() {
	server := flag.String("server", envOr("AKN_SERVER", defaultServer), "Aknologia server URL (first run only; change later in Settings)")
	addr := flag.String("listen", envOr("AKN_LISTEN", "127.0.0.1:47811"), "local address for the desktop window")
	once := flag.Bool("scan-once", false, "scan sources once, print what was found, and exit")
	printToken := flag.Bool("print-token", false, "print the local API token and exit (for development)")
	flag.Parse()

	dir := paths.DataDir()
	st, err := store.Open(dir, *server)
	if err != nil {
		log.Fatal(err)
	}
	tok, err := localapi.EnsureToken(dir)
	if err != nil {
		log.Fatal(err)
	}
	if *printToken {
		fmt.Println(tok)
		return
	}
	if *once {
		res, err := scan.Once(st, paths.Sources())
		fmt.Printf("files=%d new_events=%d unread_lines=%d total_events=%d err=%v\n", res.Files, res.NewEvents, res.Unread, len(st.Events()), err)
		return
	}
	logf, _ := os.OpenFile(filepath.Join(dir, "agent.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if logf != nil {
		log.SetOutput(logf)
	}
	a := syncer.New(st, version)
	exe, _ := os.Executable()
	if st.Snapshot().Prefs.StartAtLogin && exe != "" {
		autostart.Set(true, exe)
	}
	ln, err := net.Listen("tcp", *addr)
	if err != nil {
		log.Fatalf("listen %s: %v (is another agent already running?)", *addr, err)
	}
	srv := &http.Server{Handler: (&localapi.API{A: a, Token: tok, Exe: exe}).Handler(), ReadHeaderTimeout: 10 * time.Second}
	go srv.Serve(ln)
	stop := make(chan struct{})
	go a.Run(stop)
	log.Printf("agent %s running; data in %s; window API on %s", version, dir, *addr)
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
	close(stop)
	srv.Close()
}

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
