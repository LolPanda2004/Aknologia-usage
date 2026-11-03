// Package autostart registers the agent to start when the user logs in.
package autostart

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

const label = "com.aknologia.usage.agent"

func Set(enabled bool, exe string, args ...string) error {
	home, _ := os.UserHomeDir()
	switch runtime.GOOS {
	case "darwin":
		p := filepath.Join(home, "Library", "LaunchAgents", label+".plist")
		if !enabled {
			return removeIfExists(p)
		}
		argXML := "<string>" + exe + "</string>"
		for _, a := range args {
			argXML += "<string>" + a + "</string>"
		}
		os.MkdirAll(filepath.Dir(p), 0o755)
		return os.WriteFile(p, []byte(fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>Label</key><string>%s</string><key>ProgramArguments</key><array>%s</array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/></dict></plist>`, label, argXML)), 0o644)
	case "windows":
		if !enabled {
			return exec.Command("reg", "delete", `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, "/v", "AknologiaUsage", "/f").Run()
		}
		cmd := `"` + exe + `"`
		for _, a := range args {
			cmd += " " + a
		}
		return exec.Command("reg", "add", `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, "/v", "AknologiaUsage", "/t", "REG_SZ", "/d", cmd, "/f").Run()
	default:
		p := filepath.Join(home, ".config", "autostart", "aknologia-usage-agent.desktop")
		if !enabled {
			return removeIfExists(p)
		}
		os.MkdirAll(filepath.Dir(p), 0o755)
		line := exe
		for _, a := range args {
			line += " " + a
		}
		return os.WriteFile(p, []byte("[Desktop Entry]\nType=Application\nName=Aknologia Usage agent\nExec="+line+"\nX-GNOME-Autostart-enabled=true\nNoDisplay=true\n"), 0o644)
	}
}

func removeIfExists(p string) error {
	if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}
