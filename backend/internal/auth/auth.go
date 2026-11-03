// Package auth holds password hashing, random tokens, and one-time codes. Standard library only.
package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"strconv"
	"strings"
	"unicode"
)

const pbkdf2Iterations = 600000 // OWASP 2023 guidance for PBKDF2-HMAC-SHA256

func pbkdf2(password, salt []byte, iter, keyLen int) []byte {
	prf := hmac.New(sha256.New, password)
	hLen := prf.Size()
	blocks := (keyLen + hLen - 1) / hLen
	out := make([]byte, 0, blocks*hLen)
	buf := make([]byte, 4)
	for b := 1; b <= blocks; b++ {
		prf.Reset()
		prf.Write(salt)
		binary.BigEndian.PutUint32(buf, uint32(b))
		prf.Write(buf)
		u := prf.Sum(nil)
		t := append([]byte(nil), u...)
		for i := 1; i < iter; i++ {
			prf.Reset()
			prf.Write(u)
			u = prf.Sum(u[:0])
			for x := range t {
				t[x] ^= u[x]
			}
		}
		out = append(out, t...)
	}
	return out[:keyLen]
}

// HashPassword returns "pbkdf2_sha256$iter$salt$hash".
func HashPassword(pw string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	h := pbkdf2([]byte(pw), salt, pbkdf2Iterations, 32)
	return fmt.Sprintf("pbkdf2_sha256$%d$%s$%s", pbkdf2Iterations,
		base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(h)), nil
}

func CheckPassword(stored, pw string) bool {
	parts := strings.Split(stored, "$")
	if len(parts) != 4 || parts[0] != "pbkdf2_sha256" {
		return false
	}
	iter, err := strconv.Atoi(parts[1])
	if err != nil {
		return false
	}
	salt, err1 := base64.RawStdEncoding.DecodeString(parts[2])
	want, err2 := base64.RawStdEncoding.DecodeString(parts[3])
	if err1 != nil || err2 != nil {
		return false
	}
	got := pbkdf2([]byte(pw), salt, iter, len(want))
	return subtle.ConstantTimeCompare(got, want) == 1
}

// ValidatePassword enforces the rules shown in the UI checklist.
func ValidatePassword(pw, email, name string) error {
	if len([]rune(pw)) < 12 {
		return errors.New("Use at least 12 characters.")
	}
	var digit, symbol bool
	for _, r := range pw {
		if unicode.IsDigit(r) {
			digit = true
		} else if !unicode.IsLetter(r) && !unicode.IsSpace(r) {
			symbol = true
		}
	}
	if !digit {
		return errors.New("Add at least one number.")
	}
	if !symbol {
		return errors.New("Add at least one symbol.")
	}
	low := strings.ToLower(pw)
	local := strings.ToLower(strings.SplitN(email, "@", 2)[0])
	if (len(local) >= 4 && strings.Contains(low, local)) || (len(name) >= 4 && strings.Contains(low, strings.ToLower(name))) {
		return errors.New("Don’t include your email or name.")
	}
	return nil
}

// Token returns a random URL-safe token (for sessions) and its storage hash.
func Token() (plain, hash string) {
	b := make([]byte, 32)
	rand.Read(b)
	plain = base64.RawURLEncoding.EncodeToString(b)
	return plain, Hash(plain)
}

// Hash is a SHA-256 hex digest used to store tokens and codes; plain values are never stored.
func Hash(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

// Code returns a 6-digit one-time code.
func Code() string {
	n, _ := rand.Int(rand.Reader, big.NewInt(1000000))
	return fmt.Sprintf("%06d", n.Int64())
}

// InviteCode returns a human-typeable invite code like K7Q2-M9XD (no ambiguous characters).
func InviteCode() string {
	const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
	b := make([]byte, 8)
	for i := range b {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		b[i] = alphabet[n.Int64()]
	}
	return string(b[:4]) + "-" + string(b[4:])
}

// NormalizeInvite uppercases and strips spaces so users can type codes loosely.
func NormalizeInvite(c string) string {
	c = strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(c), " ", ""))
	if len(c) == 8 {
		c = c[:4] + "-" + c[4:]
	}
	return c
}

// Salt returns a random hex string for per-org project hashing.
func Salt() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}
