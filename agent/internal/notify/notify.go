// Package notify shows a native desktop notification using each OS's built-in tool (no dependencies).
package notify

import (
	"os/exec"
	"runtime"
	"strings"
)

func esc(s string) string { return strings.ReplaceAll(strings.ReplaceAll(s, `\`, `\\`), `"`, `\"`) }

func Show(title, body string) error {
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("osascript", "-e", `display notification "`+esc(body)+`" with title "Aknologia Usage" subtitle "`+esc(title)+`"`).Run()
	case "windows":
		ps := `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null;` +
			`$t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02);` +
			`$x = $t.GetElementsByTagName('text'); $x.Item(0).AppendChild($t.CreateTextNode('` + strings.ReplaceAll(title, "'", "''") + `')) | Out-Null;` +
			`$x.Item(1).AppendChild($t.CreateTextNode('` + strings.ReplaceAll(body, "'", "''") + `')) | Out-Null;` +
			`[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Aknologia Usage').Show([Windows.UI.Notifications.ToastNotification]::new($t))`
		return exec.Command("powershell", "-NoProfile", "-Command", ps).Run()
	default:
		return exec.Command("notify-send", "-a", "Aknologia Usage", title, body).Run()
	}
}
