package api

import (
	"net/http"
	"testing"
)

// The auth rate limit must not be bypassable with a made-up X-Forwarded-For.
func TestClientIP(t *testing.T) {
	cases := []struct {
		remote, xff string
		hops        int
		want        string
	}{
		{"198.51.100.7:1234", "1.2.3.4", 0, "198.51.100.7"},         // no proxy: the header is ignored
		{"10.0.0.5:1234", "6.6.6.6", 0, "10.0.0.5"},                 // private network, still no proxy configured
		{"10.0.0.5:1234", "6.6.6.6, 203.0.113.9", 1, "203.0.113.9"}, // one proxy: the entry it appended
		{"10.0.0.5:1234", "6.6.6.6, 203.0.113.9, 10.1.1.1", 2, "203.0.113.9"},
		{"10.0.0.5:1234", "", 1, "10.0.0.5"},    // proxy configured but no header: socket address
		{"10.0.0.5:1234", " , ", 1, "10.0.0.5"}, // empty entry
		{"[2001:db8::1]:443", "", 0, "2001:db8::1"},
	}
	for _, c := range cases {
		r := &http.Request{RemoteAddr: c.remote, Header: http.Header{}}
		if c.xff != "" {
			r.Header.Set("X-Forwarded-For", c.xff)
		}
		if got := clientIP(r, c.hops); got != c.want {
			t.Errorf("remote %s xff %q hops %d: got %s, want %s", c.remote, c.xff, c.hops, got, c.want)
		}
	}
}
