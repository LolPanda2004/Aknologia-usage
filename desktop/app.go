package main

import (
	"context"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const agentURL = "http://127.0.0.1:47811"

type App struct{ ctx context.Context }

func NewApp() *App { return &App{} }

// dataDir must match the agent's paths.DataDir.
func dataDir() string {
	if d := os.Getenv("AKN_DATA_DIR"); d != "" {
		return d
	}
	base, err := os.UserConfigDir()
	if err != nil {
		base, _ = os.UserHomeDir()
	}
	return filepath.Join(base, "Aknologia")
}

func agentRunning() bool {
	c := http.Client{Timeout: 800 * time.Millisecond}
	resp, err := c.Get(agentURL + "/v1/status")
	if err != nil {
		return false
	}
	resp.Body.Close()
	return true // 401 without a token still means the agent is up
}

// startup launches the bundled agent when it isn't running yet (first launch after install).
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	if agentRunning() {
		return
	}
	exe, _ := os.Executable()
	name := "aknologia-agent"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	candidates := []string{filepath.Join(filepath.Dir(exe), name)}
	if runtime.GOOS == "darwin" { // inside Aknologia Usage.app/Contents/MacOS
		candidates = append(candidates, filepath.Join(filepath.Dir(exe), "..", "Resources", name))
	}
	for _, p := range candidates {
		if _, err := os.Stat(p); err == nil {
			cmd := exec.Command(p)
			detach(cmd)
			if cmd.Start() == nil {
				for i := 0; i < 20 && !agentRunning(); i++ {
					time.Sleep(250 * time.Millisecond)
				}
			}
			return
		}
	}
}

type AgentInfo struct {
	URL   string `json:"url"`
	Token string `json:"token"`
}

// AgentInfo gives the window the local API address and pairing token (readable only by this OS user).
func (a *App) AgentInfo() AgentInfo {
	for i := 0; i < 20; i++ {
		if b, err := os.ReadFile(filepath.Join(dataDir(), "agent.token")); err == nil {
			return AgentInfo{URL: agentURL, Token: strings.TrimSpace(string(b))}
		}
		time.Sleep(250 * time.Millisecond)
	}
	return AgentInfo{URL: agentURL}
}
