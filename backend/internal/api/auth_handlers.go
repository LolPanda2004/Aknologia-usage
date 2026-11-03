package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/aknologia/usage/backend/internal/auth"
	"github.com/aknologia/usage/backend/internal/mail"
)

const otpTTL = 10 * time.Minute

func normEmail(e string) string { return strings.ToLower(strings.TrimSpace(e)) }

func mask(email string) string {
	at := strings.Index(email, "@")
	if at < 1 {
		return email
	}
	return email[:1] + strings.Repeat("•", 5) + email[at:]
}

// issueOTP stores a hashed 6-digit code and emails it. Earlier unused codes for the same purpose are invalidated.
func (s *Server) issueOTP(email string, userID *string, purpose string, payload map[string]any) error {
	code := auth.Code()
	pj, _ := json.Marshal(payload)
	if _, err := s.DB.Exec(`UPDATE otps SET used_at = now() WHERE lower(email) = lower($1) AND purpose = $2 AND used_at IS NULL`, email, purpose); err != nil {
		return err
	}
	if _, err := s.DB.Exec(`INSERT INTO otps (email, user_id, purpose, code_hash, payload, expires_at) VALUES ($1, $2, $3, $4, $5, $6)`,
		email, userID, purpose, auth.Hash(code), pj, time.Now().Add(otpTTL)); err != nil {
		return err
	}
	if s.Cfg.DevMode {
		logDev("one-time code for %s (%s): %s", email, purpose, code)
	}
	return s.Mail.Send(mail.Code(email, code, purpose))
}

type otpRow struct {
	ID      int64
	UserID  sql.NullString
	Email   string
	Payload map[string]any
}

var errCode = errors.New("That code is wrong or has expired. Request a new one.")

// checkOTP validates the latest code for (email or user, purpose). Five wrong attempts burn the code.
func (s *Server) checkOTP(by, value, purpose, code string) (*otpRow, error) {
	q := `SELECT id, user_id, email, code_hash, payload, attempts, expires_at FROM otps WHERE purpose = $2 AND used_at IS NULL AND `
	if by == "user" {
		q += `user_id = $1`
	} else {
		q += `lower(email) = lower($1)`
	}
	q += ` ORDER BY created_at DESC LIMIT 1`
	var o otpRow
	var hash string
	var pj []byte
	var attempts int
	var exp time.Time
	err := s.DB.QueryRow(q, value, purpose).Scan(&o.ID, &o.UserID, &o.Email, &hash, &pj, &attempts, &exp)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, errCode
	}
	if err != nil {
		return nil, err
	}
	if time.Now().After(exp) || attempts >= 5 {
		return nil, errCode
	}
	// Take one of the 5 attempts atomically before comparing, so parallel guesses can't exceed the limit.
	if err := s.DB.QueryRow(`UPDATE otps SET attempts = attempts + 1 WHERE id = $1 AND attempts < 5 AND used_at IS NULL RETURNING attempts`, o.ID).Scan(&attempts); err != nil {
		return nil, errCode
	}
	if auth.Hash(strings.TrimSpace(strings.ReplaceAll(code, " ", ""))) != hash {
		return nil, errCode
	}
	if res, err := s.DB.Exec(`UPDATE otps SET used_at = now() WHERE id = $1 AND used_at IS NULL`, o.ID); err != nil {
		return nil, err
	} else if n, _ := res.RowsAffected(); n != 1 { // another request used it first
		return nil, errCode
	}
	json.Unmarshal(pj, &o.Payload)
	return &o, nil
}

type clientInfo struct {
	Client     string `json:"client"` // desktop | web
	DeviceName string `json:"deviceName"`
	OS         string `json:"os"`
	AppVersion string `json:"appVersion"`
}

// newSession creates a device row and a bearer token for it.
func (s *Server) newSession(userID string, c clientInfo) (map[string]any, error) {
	kind := "web"
	ttl := 14 * 24 * time.Hour
	if c.Client == "desktop" {
		kind, ttl = "desktop", 180*24*time.Hour
	}
	if c.DeviceName == "" {
		c.DeviceName = map[string]string{"web": "Web browser", "desktop": "Desktop"}[kind]
	}
	var deviceID string
	if err := s.DB.QueryRow(`INSERT INTO devices (user_id, kind, name, os, app_version) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
		userID, kind, c.DeviceName, c.OS, c.AppVersion).Scan(&deviceID); err != nil {
		return nil, err
	}
	plain, hash := auth.Token()
	if _, err := s.DB.Exec(`INSERT INTO sessions (token_hash, user_id, device_id, expires_at) VALUES ($1, $2, $3, $4)`,
		hash, userID, deviceID, time.Now().Add(ttl)); err != nil {
		return nil, err
	}
	return map[string]any{"token": plain, "deviceId": deviceID}, nil
}

func (s *Server) profile(userID string) (map[string]any, error) {
	var u struct {
		ID, Email, Name, Role, Status string
		Backup                        sql.NullString
		BackupOK, CodeNew             bool
		PwChanged                     sql.NullTime
		OrgID, OrgName, Plan          string
		Seats                         int
	}
	err := s.DB.QueryRow(`SELECT u.id, u.email, u.name, u.role, u.status, u.backup_email, u.backup_verified, u.code_on_new_device, u.password_changed_at,
		o.id, o.name, o.plan, o.seats FROM users u JOIN orgs o ON o.id = u.org_id WHERE u.id = $1`, userID).
		Scan(&u.ID, &u.Email, &u.Name, &u.Role, &u.Status, &u.Backup, &u.BackupOK, &u.CodeNew, &u.PwChanged, &u.OrgID, &u.OrgName, &u.Plan, &u.Seats)
	if err != nil {
		return nil, err
	}
	var pw any
	if u.PwChanged.Valid {
		pw = u.PwChanged.Time
	}
	return map[string]any{
		"user": map[string]any{"id": u.ID, "email": u.Email, "name": u.Name, "role": u.Role, "status": u.Status,
			"backupEmail": u.Backup.String, "backupVerified": u.BackupOK, "codeOnNewDevice": u.CodeNew, "passwordChangedAt": pw},
		"org": map[string]any{"id": u.OrgID, "name": u.OrgName, "plan": u.Plan, "seats": u.Seats},
	}, nil
}

func (s *Server) sessionResponse(w http.ResponseWriter, userID string, c clientInfo) {
	sess, err := s.newSession(userID, c)
	if err != nil {
		serverErr(w, err)
		return
	}
	prof, err := s.profile(userID)
	if err != nil {
		serverErr(w, err)
		return
	}
	for k, v := range prof {
		sess[k] = v
	}
	writeJSON(w, 200, sess)
}

// ---------- public ----------

func (s *Server) signup(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name, Email, Company, TeamSize, Password string
	}
	if readJSON(r, &in) != nil {
		bad(w, "Check the form and try again.")
		return
	}
	in.Email = normEmail(in.Email)
	if in.Name == "" || in.Company == "" || !strings.Contains(in.Email, "@") {
		bad(w, "Enter your name, work email, and company.")
		return
	}
	if err := auth.ValidatePassword(in.Password, in.Email, in.Name); err != nil {
		bad(w, err.Error())
		return
	}
	var exists bool
	s.DB.QueryRow(`SELECT EXISTS (SELECT 1 FROM users WHERE lower(email) = $1 AND status <> 'unverified')`, in.Email).Scan(&exists)
	if exists {
		writeErr(w, 409, "exists", "An account already uses this email. Sign in instead.")
		return
	}
	hash, err := auth.HashPassword(in.Password)
	if err != nil {
		serverErr(w, err)
		return
	}
	tx, err := s.DB.Begin()
	if err != nil {
		serverErr(w, err)
		return
	}
	defer tx.Rollback()
	tx.Exec(`DELETE FROM orgs WHERE id IN (SELECT org_id FROM users WHERE lower(email) = $1 AND status = 'unverified')`, in.Email)
	var orgID, userID string
	if err := tx.QueryRow(`INSERT INTO orgs (name, project_salt, alert_inboxes) VALUES ($1, $2, ARRAY[$3]) RETURNING id`, in.Company, auth.Salt(), in.Email).Scan(&orgID); err != nil {
		serverErr(w, err)
		return
	}
	if err := tx.QueryRow(`INSERT INTO users (org_id, email, name, role, status, password_hash, password_changed_at) VALUES ($1, $2, $3, 'admin', 'unverified', $4, now()) RETURNING id`,
		orgID, in.Email, in.Name, hash).Scan(&userID); err != nil {
		serverErr(w, err)
		return
	}
	if err := tx.Commit(); err != nil {
		serverErr(w, err)
		return
	}
	if err := s.issueOTP(in.Email, &userID, "verify_signup", nil); err != nil {
		serverErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"status": "verify", "sentTo": mask(in.Email)})
}

func (s *Server) verifyEmail(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email, Code string
		clientInfo
	}
	if readJSON(r, &in) != nil {
		bad(w, "Enter the 6-digit code.")
		return
	}
	o, err := s.checkOTP("email", normEmail(in.Email), "verify_signup", in.Code)
	if err != nil {
		bad(w, err.Error())
		return
	}
	s.DB.Exec(`UPDATE users SET status = 'active' WHERE id = $1`, o.UserID.String)
	s.sessionResponse(w, o.UserID.String, in.clientInfo)
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email, Password string
		clientInfo
	}
	if readJSON(r, &in) != nil {
		bad(w, "Enter your email and password.")
		return
	}
	var id, status, role string
	var hash sql.NullString
	err := s.DB.QueryRow(`SELECT id, status, role, password_hash FROM users WHERE lower(email) = $1`, normEmail(in.Email)).Scan(&id, &status, &role, &hash)
	// Account state (removed, invited) is only revealed after the password matches, so a guess can't tell which
	// emails exist. The one message also points invited people to the invite flow.
	if errors.Is(err, sql.ErrNoRows) || (err == nil && (!hash.Valid || !auth.CheckPassword(hash.String, in.Password))) {
		writeErr(w, 401, "bad_credentials", "That email and password don’t match. If you were invited and haven’t set a password yet, choose “I have an invite”.")
		return
	}
	if err != nil {
		serverErr(w, err)
		return
	}
	switch status {
	case "removed":
		writeErr(w, 403, "removed", "You were removed from this organization. Ask your admin to re-invite you.")
		return
	case "unverified":
		s.issueOTP(normEmail(in.Email), &id, "verify_signup", nil)
		writeErr(w, 403, "unverified", "Verify your email first. We just sent you a new code.")
		return
	}
	if in.Client != "desktop" && role != "admin" {
		writeErr(w, 403, "not_admin", "The admin console is for admins. Use the desktop app to see your own usage.")
		return
	}
	s.sessionResponse(w, id, in.clientInfo)
}

func (s *Server) acceptInvite(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email, Code, Password string
		clientInfo
	}
	if readJSON(r, &in) != nil {
		bad(w, "Enter your email, invite code, and a password.")
		return
	}
	var userID, name, email string
	var used sql.NullTime
	var exp time.Time
	err := s.DB.QueryRow(`SELECT u.id, u.name, u.email, i.used_at, i.expires_at FROM invites i JOIN users u ON u.id = i.user_id
		WHERE i.code_hash = $1 AND lower(u.email) = $2 AND u.status = 'invited'`, auth.Hash(auth.NormalizeInvite(in.Code)), normEmail(in.Email)).Scan(&userID, &name, &email, &used, &exp)
	if errors.Is(err, sql.ErrNoRows) || used.Valid || time.Now().After(exp) {
		bad(w, "That invite code doesn’t match this email, or it has expired. Ask your admin to resend it.")
		return
	}
	if err != nil {
		serverErr(w, err)
		return
	}
	if err := auth.ValidatePassword(in.Password, email, name); err != nil {
		bad(w, err.Error())
		return
	}
	hash, _ := auth.HashPassword(in.Password)
	s.DB.Exec(`UPDATE users SET password_hash = $1, password_changed_at = now(), status = 'active' WHERE id = $2`, hash, userID)
	s.DB.Exec(`UPDATE invites SET used_at = now() WHERE user_id = $1`, userID)
	s.sessionResponse(w, userID, in.clientInfo)
}

func (s *Server) forgotPassword(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email     string
		UseBackup bool `json:"useBackup"`
	}
	readJSON(r, &in)
	email := normEmail(in.Email)
	var id string
	var backup sql.NullString
	var backupOK bool
	err := s.DB.QueryRow(`SELECT id, backup_email, backup_verified FROM users WHERE lower(email) = $1 AND status = 'active'`, email).Scan(&id, &backup, &backupOK)
	dest := email
	if err == nil {
		if in.UseBackup && backup.Valid && backupOK {
			dest = backup.String
		}
		// The code is always tied to the account email so reset works whichever inbox received it.
		code := auth.Code()
		s.DB.Exec(`UPDATE otps SET used_at = now() WHERE lower(email) = $1 AND purpose = 'reset' AND used_at IS NULL`, email)
		s.DB.Exec(`INSERT INTO otps (email, user_id, purpose, code_hash, expires_at) VALUES ($1, $2, 'reset', $3, $4)`, email, id, auth.Hash(code), time.Now().Add(otpTTL))
		if s.Cfg.DevMode {
			logDev("reset code for %s: %s", email, code)
		}
		s.Mail.Send(mail.Code(dest, code, "reset"))
	}
	writeJSON(w, 200, map[string]any{"sentTo": mask(dest)}) // same answer whether or not the account exists
}

func (s *Server) resetPassword(w http.ResponseWriter, r *http.Request) {
	var in struct{ Email, Code, Password string }
	if readJSON(r, &in) != nil {
		bad(w, "Enter the code and a new password.")
		return
	}
	email := normEmail(in.Email)
	if in.Password == "" { // code-only check so the UI can move to the "new password" step
		var ok bool
		s.DB.QueryRow(`SELECT EXISTS (SELECT 1 FROM otps WHERE lower(email) = $1 AND purpose = 'reset' AND used_at IS NULL AND expires_at > now() AND attempts < 5 AND code_hash = $2)`,
			email, auth.Hash(strings.TrimSpace(in.Code))).Scan(&ok)
		if !ok {
			s.DB.Exec(`UPDATE otps SET attempts = attempts + 1 WHERE id = (SELECT id FROM otps WHERE lower(email) = $1 AND purpose = 'reset' AND used_at IS NULL ORDER BY created_at DESC LIMIT 1)`, email)
			bad(w, errCode.Error())
			return
		}
		writeJSON(w, 200, map[string]any{"valid": true})
		return
	}
	var name string
	s.DB.QueryRow(`SELECT name FROM users WHERE lower(email) = $1`, email).Scan(&name)
	if err := auth.ValidatePassword(in.Password, email, name); err != nil {
		bad(w, err.Error())
		return
	}
	o, err := s.checkOTP("email", email, "reset", in.Code)
	if err != nil {
		bad(w, err.Error())
		return
	}
	hash, _ := auth.HashPassword(in.Password)
	s.DB.Exec(`UPDATE users SET password_hash = $1, password_changed_at = now() WHERE id = $2`, hash, o.UserID.String)
	s.DB.Exec(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, o.UserID.String)
	s.DB.Exec(`UPDATE devices SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, o.UserID.String) // signed out everywhere
	s.Mail.Send(mail.PasswordChanged(email, "Changed with a reset code on "+time.Now().Format("2 Jan at 15:04 MST")))
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) demoRequest(w http.ResponseWriter, r *http.Request) {
	var in struct{ Name, Email, Company, TeamSize, Slot, Message string }
	if readJSON(r, &in) != nil || in.Name == "" || !strings.Contains(in.Email, "@") {
		bad(w, "Enter your name and work email.")
		return
	}
	if _, err := s.DB.Exec(`INSERT INTO demo_requests (name, email, company, team_size, slot, message) VALUES ($1, $2, $3, $4, $5, $6)`,
		in.Name, normEmail(in.Email), in.Company, in.TeamSize, in.Slot, in.Message); err != nil {
		serverErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

// ---------- signed in ----------

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	u := current(r)
	s.DB.Exec(`UPDATE sessions SET revoked_at = now() WHERE token_hash = $1`, u.TokenHash)
	if u.DeviceID.Valid {
		s.DB.Exec(`UPDATE devices SET revoked_at = now() WHERE id = $1`, u.DeviceID.String)
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	p, err := s.profile(current(r).ID)
	if err != nil {
		serverErr(w, err)
		return
	}
	writeJSON(w, 200, p)
}

func (s *Server) changePasswordStart(w http.ResponseWriter, r *http.Request) {
	u := current(r)
	var in struct{ Current, New string }
	if readJSON(r, &in) != nil {
		bad(w, "Enter your current and new password.")
		return
	}
	var hash string
	s.DB.QueryRow(`SELECT coalesce(password_hash, '') FROM users WHERE id = $1`, u.ID).Scan(&hash)
	if !auth.CheckPassword(hash, in.Current) {
		bad(w, "Your current password isn’t right.")
		return
	}
	if err := auth.ValidatePassword(in.New, u.Email, u.Name); err != nil {
		bad(w, err.Error())
		return
	}
	nh, _ := auth.HashPassword(in.New)
	if err := s.issueOTP(u.Email, &u.ID, "change_password", map[string]any{"hash": nh}); err != nil {
		serverErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"sentTo": mask(u.Email)})
}

func (s *Server) changePasswordConfirm(w http.ResponseWriter, r *http.Request) {
	u := current(r)
	var in struct{ Code string }
	readJSON(r, &in)
	o, err := s.checkOTP("user", u.ID, "change_password", in.Code)
	if err != nil {
		bad(w, err.Error())
		return
	}
	nh, _ := o.Payload["hash"].(string)
	s.DB.Exec(`UPDATE users SET password_hash = $1, password_changed_at = now() WHERE id = $2`, nh, u.ID)
	s.DB.Exec(`UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND token_hash <> $2 AND revoked_at IS NULL`, u.ID, u.TokenHash)
	// The other devices were just signed out, so they leave the Signed-in devices list too (this one stays).
	s.DB.Exec(`UPDATE devices SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL AND id IS DISTINCT FROM $2`, u.ID, u.DeviceID)
	s.Mail.Send(mail.PasswordChanged(u.Email, "Changed from your account settings on "+time.Now().Format("2 Jan at 15:04 MST")))
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) backupEmailStart(w http.ResponseWriter, r *http.Request) {
	u := current(r)
	var in struct{ Email string }
	readJSON(r, &in)
	e := normEmail(in.Email)
	if !strings.Contains(e, "@") || e == normEmail(u.Email) {
		bad(w, "Enter a different, personal email address.")
		return
	}
	if err := s.issueOTP(e, &u.ID, "verify_backup", map[string]any{"email": e}); err != nil {
		serverErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"sentTo": mask(e)})
}

func (s *Server) backupEmailVerify(w http.ResponseWriter, r *http.Request) {
	u := current(r)
	var in struct{ Code string }
	readJSON(r, &in)
	o, err := s.checkOTP("user", u.ID, "verify_backup", in.Code)
	if err != nil {
		bad(w, err.Error())
		return
	}
	s.DB.Exec(`UPDATE users SET backup_email = $1, backup_verified = true WHERE id = $2`, o.Payload["email"], u.ID)
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) backupEmailRemove(w http.ResponseWriter, r *http.Request) {
	s.DB.Exec(`UPDATE users SET backup_email = NULL, backup_verified = false WHERE id = $1`, current(r).ID)
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) updateMySettings(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name            *string `json:"name"`
		CodeOnNewDevice *bool   `json:"codeOnNewDevice"`
	}
	readJSON(r, &in)
	u := current(r)
	if in.Name != nil {
		s.DB.Exec(`UPDATE users SET name = $1 WHERE id = $2`, strings.TrimSpace(*in.Name), u.ID)
	}
	if in.CodeOnNewDevice != nil {
		s.DB.Exec(`UPDATE users SET code_on_new_device = $1 WHERE id = $2`, *in.CodeOnNewDevice, u.ID)
	}
	s.me(w, r)
}

func (s *Server) myDevices(w http.ResponseWriter, r *http.Request) {
	u := current(r)
	rows, err := s.DB.Query(`SELECT id, kind, name, os, app_version, last_seen, last_sync FROM devices WHERE user_id = $1 AND revoked_at IS NULL ORDER BY last_seen DESC`, u.ID)
	if err != nil {
		serverErr(w, err)
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, kind, name, os, ver string
		var seen time.Time
		var sync sql.NullTime
		rows.Scan(&id, &kind, &name, &os, &ver, &seen, &sync)
		d := map[string]any{"id": id, "kind": kind, "name": name, "os": os, "appVersion": ver, "lastSeen": seen, "current": u.DeviceID.String == id}
		if sync.Valid {
			d["lastSync"] = sync.Time
		}
		out = append(out, d)
	}
	writeJSON(w, 200, out)
}

func (s *Server) revokeMyDevice(w http.ResponseWriter, r *http.Request) {
	u := current(r)
	id := r.PathValue("id")
	s.DB.Exec(`UPDATE devices SET revoked_at = now() WHERE id = $1 AND user_id = $2`, id, u.ID)
	s.DB.Exec(`UPDATE sessions SET revoked_at = now() WHERE device_id = $1 AND user_id = $2`, id, u.ID)
	writeJSON(w, 200, map[string]any{"ok": true})
}
