// Package paths resolves where the agent keeps its data and where Claude Code and Codex write sessions.
package paths

import (
	"os"
	"path/filepath"
)

// DataDir is the agent's private folder (state, local events, token).
func DataDir() string {
	if d := os.Getenv("AKN_DATA_DIR"); d != "" {
		return d
	}
	base, err := os.UserConfigDir()
	if err != nil {
		base, _ = os.UserHomeDir()
	}
	return filepath.Join(base, "Aknologia")
}

type Source struct {
	Tool  string   `json:"tool"`  // claude_code | codex
	Roots []string `json:"roots"` // folders scanned recursively for *.jsonl
}

// Sources lists every folder Claude Code and Codex may write to, honoring their override variables.
func Sources() []Source {
	home, _ := os.UserHomeDir()
	claude := []string{}
	if v := os.Getenv("CLAUDE_CONFIG_DIR"); v != "" {
		for _, p := range filepath.SplitList(v) {
			claude = append(claude, filepath.Join(p, "projects"))
		}
	} else {
		claude = append(claude, filepath.Join(home, ".claude", "projects"), filepath.Join(home, ".config", "claude", "projects"))
	}
	codexHome := os.Getenv("CODEX_HOME")
	if codexHome == "" {
		codexHome = filepath.Join(home, ".codex")
	}
	return []Source{
		{Tool: "claude_code", Roots: claude},
		{Tool: "codex", Roots: []string{filepath.Join(codexHome, "sessions")}},
	}
}
