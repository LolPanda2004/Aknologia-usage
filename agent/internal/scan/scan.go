// Package scan reads new lines from Claude Code and Codex session files.
// It polls file sizes (no OS-specific watcher needed), reads only appended bytes up to the last complete
// line, and starts over if a file shrinks (rotated or rewritten). Lines are never modified or deleted.
package scan

import (
	"bufio"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/aknologia/usage/agent/internal/parse"
	"github.com/aknologia/usage/agent/internal/paths"
	"github.com/aknologia/usage/agent/internal/store"
)

type Result struct {
	Files, NewEvents, Unread int
}

// Once scans every source folder and stores any new events.
func Once(st *store.Store, sources []paths.Source) (Result, error) {
	var res Result
	// A new Claude parser records details the old one skipped (e.g. 1-hour cache writes): read those files again
	// once. Existing events are only replaced by versions that supersede them, so nothing is counted twice.
	upgrade := st.Snapshot().ParserGen != parse.ClaudeVersion
	for _, src := range sources {
		if upgrade && src.Tool != "codex" {
			st.ResetCursors(src.Roots)
		}
		for _, root := range src.Roots {
			filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
				if err != nil || d.IsDir() || !strings.HasSuffix(p, ".jsonl") {
					return nil
				}
				res.Files++
				evs, unread, err := readFile(st, src.Tool, p)
				if err != nil {
					return nil
				}
				res.Unread += unread
				if len(evs) > 0 {
					n, _ := st.Add(evs)
					res.NewEvents += n
				}
				return nil
			})
		}
	}
	if upgrade {
		st.Update(func(s *store.State) { s.ParserGen = parse.ClaudeVersion })
	}
	return res, st.SaveCursors()
}

func readFile(st *store.Store, tool, p string) ([]parse.Event, int, error) {
	info, err := os.Stat(p)
	if err != nil {
		return nil, 0, err
	}
	c := st.Cursor(p)
	if info.Size() < c.Offset { // truncated or replaced: read again from the start (dedup makes this safe)
		*c = store.Cursor{}
	}
	if info.Size() == c.Offset {
		return nil, c.Unread, nil
	}
	f, err := os.Open(p)
	if err != nil {
		return nil, 0, err
	}
	defer f.Close()
	if _, err := f.Seek(c.Offset, io.SeekStart); err != nil {
		return nil, 0, err
	}
	r := bufio.NewReaderSize(f, 256*1024)
	session := strings.TrimSuffix(filepath.Base(p), ".jsonl")
	var out []parse.Event
	offset := c.Offset
	for {
		line, err := r.ReadBytes('\n')
		if err != nil { // partial last line: leave it for the next pass
			break
		}
		lineStart := offset
		offset += int64(len(line))
		line = line[:len(line)-1]
		if len(line) == 0 {
			continue
		}
		var res parse.Result
		if tool == "codex" {
			res = parse.Codex(line, lineStart, &c.Codex)
		} else {
			res = parse.Claude(line, session)
		}
		if res.Unread {
			c.Unread++
		}
		if res.Event != nil {
			out = append(out, *res.Event)
		}
	}
	c.Offset, c.Size, c.ModNS = offset, info.Size(), info.ModTime().UnixNano()
	return out, c.Unread, nil
}
