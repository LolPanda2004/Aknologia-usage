// Package mail sends transactional email over SMTP (works with Brevo, Resend, Postmark, Gmail SMTP)
// or, in dev mode without SMTP settings, prints the message to the server log.
package mail

import (
	"errors"
	"fmt"
	"html"
	"log"
	"net/smtp"
	"strings"
	"time"
)

type Sender struct {
	Host, User, Pass, From string
	Port                   int
	LogOnly                bool
}

type Message struct {
	To      []string
	Subject string
	HTML    string
	Text    string
}

// ErrNotConfigured: no SMTP server is set and the server is not in dev mode, so nothing can be sent.
var ErrNotConfigured = errors.New("email is not configured (set SMTP_HOST)")

func (s *Sender) Send(m Message) error {
	if !s.LogOnly && s.Host == "" { // never write codes or links to the log outside dev mode
		log.Printf("[mail] an email was not sent: SMTP_HOST is not set") // no subject or recipient: subjects can carry codes
		return ErrNotConfigured
	}
	if s.LogOnly {
		log.Printf("[mail] to=%s subject=%q\n%s\n", strings.Join(m.To, ","), m.Subject, m.Text)
		return nil
	}
	boundary := fmt.Sprintf("akn%d", time.Now().UnixNano())
	var b strings.Builder
	fmt.Fprintf(&b, "From: %s\r\nTo: %s\r\nSubject: %s\r\nMIME-Version: 1.0\r\n", s.From, strings.Join(m.To, ", "), m.Subject)
	fmt.Fprintf(&b, "Content-Type: multipart/alternative; boundary=%q\r\n\r\n", boundary)
	fmt.Fprintf(&b, "--%s\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n%s\r\n", boundary, m.Text)
	fmt.Fprintf(&b, "--%s\r\nContent-Type: text/html; charset=utf-8\r\n\r\n%s\r\n--%s--\r\n", boundary, m.HTML, boundary)
	from := s.From
	if i := strings.Index(from, "<"); i >= 0 {
		from = strings.Trim(from[i:], "<>")
	}
	var a smtp.Auth
	if s.User != "" {
		a = smtp.PlainAuth("", s.User, s.Pass, s.Host)
	}
	return smtp.SendMail(fmt.Sprintf("%s:%d", s.Host, s.Port), a, from, m.To, []byte(b.String()))
}

// ---- templates (royal emerald, matches the design) ----

func layout(kicker, title, intro, body, ctaLabel, ctaURL string) string {
	cta := ""
	if ctaLabel != "" {
		cta = fmt.Sprintf(`<a href="%s" style="display:inline-block;background:#0E6B4E;color:#FFFFFF;font-weight:700;padding:14px 22px;border-radius:12px;text-decoration:none">%s</a>`, html.EscapeString(ctaURL), html.EscapeString(ctaLabel))
	}
	return fmt.Sprintf(`<!doctype html><html><body style="margin:0;background:#E6EEEA;font-family:'IBM Plex Sans',Arial,sans-serif;color:#0F1F18">
<table role="presentation" width="100%%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FFFFFF;border:1px solid #DCE6E0;border-radius:18px;overflow:hidden">
<tr><td style="background:#0F1F18;color:#FFFFFF;padding:28px 32px">
<div style="font-weight:800;font-size:16px;margin-bottom:14px"><span style="display:inline-block;width:30px;height:30px;line-height:30px;text-align:center;border-radius:9px;background:#0E6B4E;margin-right:8px">a</span>aknologia</div>
<div style="font-size:12px;font-weight:800;letter-spacing:.1em;color:#BFD0C6">%s</div>
<h1 style="margin:8px 0 6px;font-size:28px;line-height:1.2">%s</h1><p style="margin:0;font-size:15px;line-height:1.6;color:#E6EEEA">%s</p></td></tr>
<tr><td style="padding:28px 32px;font-size:15px;line-height:1.6;color:#33473D">%s<div style="margin-top:22px">%s</div></td></tr>
<tr><td style="padding:18px 32px;border-top:1px solid #DCE6E0;font-size:12px;color:#526A5E">© %d Aknologia. All rights reserved.</td></tr>
</table></td></tr></table></body></html>`, html.EscapeString(kicker), html.EscapeString(title), html.EscapeString(intro), body, cta, time.Now().Year())
}

func p(s string) string { return `<p style="margin:0 0 12px">` + html.EscapeString(s) + `</p>` }

func codeBox(code string) string {
	return `<div style="font-family:'IBM Plex Mono',monospace;font-size:40px;letter-spacing:.3em;text-align:center;padding:20px;border-radius:14px;background:#F4F7F5;border:1px dashed #BFD0C6;margin:6px 0 14px">` + html.EscapeString(code[:3]+" "+code[3:]) + `</div>`
}

func Invite(to, orgName, inviter, code, setURL, downloadURL string, expires time.Time) Message {
	body := p(fmt.Sprintf("%s added you to %s. You’ll be able to see your own time and spend across Claude Code and Codex.", inviter, orgName)) +
		p("1. Install the desktop app.") + p("2. Choose “I have an invite”, then enter your email and this invite code:") + codeBoxInvite(code) +
		p("3. Set a password and keep coding. Your numbers appear within the hour.") +
		`<p style="margin:12px 0;padding:14px;border-radius:12px;background:#F4F7F5;font-size:13px">What’s shared: token counts, models, and timestamps. Prompts, code, and file names never leave your computer.</p>` +
		p("This invite expires on "+expires.Format("2 Jan 2006")+".")
	text := fmt.Sprintf("%s invited you to %s on Aknologia Usage.\nInstall the desktop app: %s\nInvite code: %s (expires %s)\nAdmins can also set a password here: %s\n", inviter, orgName, downloadURL, code, expires.Format("2 Jan 2006"), setURL)
	return Message{To: []string{to}, Subject: inviter + " invited you to " + orgName, HTML: layout("YOU’RE INVITED", "Welcome to "+orgName, "Set up takes about five minutes.", body, "Download the desktop app", downloadURL), Text: text}
}

func codeBoxInvite(code string) string {
	return `<div style="font-family:'IBM Plex Mono',monospace;font-size:30px;letter-spacing:.2em;text-align:center;padding:18px;border-radius:14px;background:#E3F1EA;color:#0A5139;margin:6px 0 14px">` + html.EscapeString(code) + `</div>`
}

func Code(to, code, purpose string) Message {
	what := map[string]string{
		"verify_signup":   "verify your email and finish creating your workspace",
		"reset":           "reset your password",
		"change_password": "confirm your password change",
		"verify_backup":   "verify this backup email",
		"delete_data":     "confirm deleting your organization’s usage data",
	}[purpose]
	body := codeBox(code) + p("The code expires in 10 minutes and can be used once. If you didn’t ask for it, you can ignore this email.")
	return Message{To: []string{to}, Subject: "Your Aknologia code: " + code, HTML: layout("VERIFICATION CODE", "Use this code to continue", "Enter it to "+what+".", body, "", ""),
		Text: fmt.Sprintf("Your Aknologia code is %s. Use it to %s. It expires in 10 minutes.", code, what)}
}

func PasswordChanged(to, where string) Message {
	body := p("We signed you out of your other devices. If this was you, there’s nothing else to do.") +
		`<p style="margin:12px 0;padding:14px;border-radius:12px;background:#FBEEF1;color:#8E2338">Wasn’t you? Reset your password now and tell your admin.</p>`
	return Message{To: []string{to}, Subject: "Your Aknologia password was changed", HTML: layout("SECURITY NOTICE", "Your password was changed", where, body, "", ""), Text: "Your Aknologia password was changed (" + where + "). If this wasn't you, reset it now."}
}

func Removed(to, name, orgName, by string) Message {
	body := p("Nothing more is collected: the desktop app stops tracking on all your devices at its next sync.") +
		p("Your password no longer works. You can sign in again only if you’re re-invited.") +
		p("You can uninstall the app. Your past usage stays with your team unless your admin deletes it.")
	return Message{To: []string{to}, Subject: "You’ve been removed from " + orgName, HTML: layout("ACCOUNT UPDATE", "Tracking has stopped, "+name, by+" removed you from "+orgName+".", body, "", ""), Text: by + " removed you from " + orgName + ". Tracking has stopped."}
}

func BudgetAlert(to []string, member string, threshold int, spent, budget, projected float64, consoleURL string) Message {
	title := fmt.Sprintf("%s reached %d%% of their budget", member, threshold)
	body := fmt.Sprintf(`<table width="100%%" style="margin-bottom:14px"><tr>
<td style="background:#F4F7F5;border-radius:12px;padding:12px"><div style="font-size:12px;color:#526A5E">Spent so far</div><div style="font-family:monospace;font-size:22px">$%.2f</div></td><td width="10"></td>
<td style="background:#F4F7F5;border-radius:12px;padding:12px"><div style="font-size:12px;color:#526A5E">Budget</div><div style="font-family:monospace;font-size:22px">$%.2f</div></td><td width="10"></td>
<td style="background:#F4F7F5;border-radius:12px;padding:12px"><div style="font-size:12px;color:#526A5E">Projected</div><div style="font-family:monospace;font-size:22px">$%.2f</div></td></tr></table>`, spent, budget, projected) +
		p("Their tools keep working. Budgets alert; they never block.")
	return Message{To: to, Subject: title, HTML: layout(fmt.Sprintf("BUDGET %d%%", threshold), title, "Monthly budget for "+time.Now().Format("January 2006")+".", body, "View usage", consoleURL),
		Text: fmt.Sprintf("%s: $%.2f of $%.2f (%d%%). Projected $%.2f. %s", title, spent, budget, threshold, projected, consoleURL)}
}
