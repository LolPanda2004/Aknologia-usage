## 2. Desktop agent and parsers

QA subagent 2, 2026-10-10, Windows 11 (machine time zone IST +05:30), Go 1.26.4. No product code was changed.
Private server on :8092 with its own Postgres on :55432 (removed at the end). The agent ran only against sandboxes under `tests/.sandbox/agent2/` on `127.0.0.1:47812`.

### Commands and results

| Step | Command | Result |
|---|---|---|
| Unit tests | `cd agent && go test ./...` | PASS. Only `internal/parse` has tests (2: TestClaude, TestCodex). The other 8 packages have no test files. |
| Vet | `cd agent && go vet ./...` | Clean (exit 0) |
| Build | `go build -o ../tests/bin/aknologia-agent.exe ./cmd/aknologia-agent`, plus the backend into `tests/agent/.bin/` | OK |
| Fixtures | `node tests/agent/genfixtures.mjs <home>` (copy saved in `tests/fixtures/parsers/home`, with `expected.json`) | 34 files. Covers normal turns, streamed duplicates, `<synthetic>`, missing usage, missing timestamp, broken JSON, a 5 MB line, a partial last line, unicode folder and cwd, 30 sessions over 10 days, Codex repeated token_count, `info:null`, the old no-`payload` format, and a file with no session_meta. Every prompt, reply and tool text holds SECRET_*_MARKER strings. |
| First scan | `aknologia-agent.exe -scan-once` | `files=34 new_events=156 unread_lines=5`, which matches expected exactly |
| Token numbers | events.jsonl summed against the generator | Claude (30 sessions): n=150, in=17175, out=30300, cw=3000, cr=154350, all exact. Codex: (in 1000, cr 4000, out 1200) and (in 500, cr 2000, out 300), and the old format gives (150/50/100). This matches the PARSERS.md mapping `input = input_tokens - cached`. |
| Incremental | append the rest of the partial line, then a new line, rescan | +1 then +1 new events, only the new ones. Rescanning an unchanged file gives 0. A new Codex line after a restart keeps its session, model and cwd (state comes from cursors.json). A repeated total in a later run is skipped. |
| Sync, first | accept invite through local API `POST /v1/auth/accept-invite` | Signed in and synced 159 events at once. DB totals match events.jsonl to the token (claude 155: 17207/30502/4036/160098; codex 4: 1950/1700/0/6150). |
| Project hash | DB `project_hash` compared with `HMAC-SHA256(salt,cwd)[:16]` (`tests/agent/hash.mjs`) | All 6 folders match. An empty cwd gives `''`. |
| Privacy | `grep -r SECRET_` over every agent data dir (main, rot, prebuilt, perf with 200k events) and over `pg_dump --data-only` of my DB | 0 hits. The DB also has 0 hits for raw paths (`proj0`, `ünï`, `Users\dev`, `perf`). |
| Offline | stop :8092, add 1200 events, `POST /v1/sync` | HTTP 502 `offline`, queued=1200, lastError "Can't reach…" |
| Back online | start :8092, `POST /v1/sync` | HTTP 200 in 2.8 s, 3 ingest batches (500/500/200), DB has all 1200, queued=0. Nothing lost. |
| NextSync | SYNC_MINUTE=17 on the server | jitter = fnv32a(deviceId)%120 = 103 s (computed independently). nextSync was 11:48:43 IST, which is 06:18:43 UTC = minute 17 + 103 s. Matches the code (`syncer.go:327-337`). |
| 401 | revoke the device session in the DB, then Force sync | HTTP 401 `signed_out`, `signedIn:false`, token removed from state.json, queued event kept. After a re-login through the local API, the queued event was synced. |
| Removed | admin `DELETE /admin/members/{id}`, then Force sync | HTTP 403 `removed`, `removed:true`, `signedIn:false`. Scanning stopped: new lines were not read, events.jsonl stayed at 1361 lines. |
| Local API auth | curl probes | no token / wrong token / token in query: 401. Origin `https://evil.com`: 403. Origin `null`: 403. Foreign preflight: 403. Allowed preflight without a token: 204. Host header is not checked (token still required). Prefix bug found, see AG-03. |
| Autostart | `PUT /v1/prefs` with startAtLogin false, then true | The value is removed, then re-added as `"<exe path>"`. Also see AG-04 and AG-05. |
| Notifications | `tests/agent/notifycheck` calls the real `notify.Show` | Normal: err=nil, but blocks for 5.2 s. With no PowerShell on PATH: returns `exec: "powershell": executable file not found`, no crash. Quotes are escaped correctly. |
| Data dir | read `paths.go`. Ran `-print-token` without AKN_DATA_DIR and with APPDATA pointed at the sandbox. | `%APPDATA%\Aknologia` (Roaming), created at `<sandbox>/AppData/Roaming/Aknologia`. The desktop `app.go:21` uses the same logic. |
| Token ACL | `icacls agent.token` | Inherited: SYSTEM, Administrators, and the user (F). The 0600 mode has no effect on Windows, so protection depends on the parent folder's ACL. |
| Prebuilt | `prebuilt/aknologia-agent-windows-amd64.exe -scan-once` on the same sandbox | Same result (159 events, 5 unread). events.jsonl is byte-identical after sorting. Version 1.0.0, built with go1.22.2 (the source build uses go1.26.4), console subsystem. It has the same origin-prefix bug. |

### Performance (200,000 events: 160k Claude in 400 files, 40k Codex in 100 files, 30 days, 163 MB of session files)

| Measure | Result |
|---|---|
| First `-scan-once` | 23.0 s, peak working set 181 MB, events.jsonl 48.7 MB, cursors.json 142 KB |
| Re-scan, no changes | 2.4 s (mostly reloading events.jsonl), peak 158 MB |
| Running agent memory | working set 362 MB, peak 465 MB |
| `GET /v1/status` | 0.25-0.30 s (EventsToday walks every event) |
| `GET /v1/summary?days=7 / 30 / 400` | 0.8-1.3 s / 1.6-1.9 s / 1.7-2.1 s |
| `GET /v1/sessions?days=30 / 400` | 1.3-1.4 s / 1.0-1.2 s (339 KB response, every session) |

The window stays usable but feels slow at this size. Memory grows with the number of events, because every event is kept in RAM.

### Findings

| ID | Sev | Title | Repro | Expected | Actual | Suspected cause | Suggested fix |
|---|---|---|---|---|---|---|---|
| AG-01 | Major | A file replaced by a larger file loses events without any error | Claude file with 2 events, scan. Overwrite it with 3 different events (bigger file), scan. | 3 new events | 1 new event (`new_events=1`, `grep -c S2` = 1). 2 events lost, and unread=0 so nothing warns. | `scan/scan.go:56` only resets when `size < offset`. The stored `ModNS` and file identity are never checked. | Save the first ~256 bytes as a hash (or the file ID / creation time) in the Cursor. Restart from 0 when it changes. Dedup makes a re-read safe. |
| AG-02 | Minor | A rewritten Codex file drops new events (ID depends on byte offset) | Codex session cx-rw with 3 token_counts, scan. Rewrite it shorter with different numbers, scan. | 1 new event (77/70) | `new_events=0`. The new line has the same `off:99` key as an old one. | `parse.go:189` uses message ID = `off:<offset>`. The key is session+offset. | Add the line timestamp, or total_tokens, to the message ID (for example `off:<offset>:<total>`). Bump CodexVersion. |
| AG-03 | Minor (security hardening) | The Origin allow-list uses a prefix match | `curl -H "Origin: http://localhost.evil.com" -H "X-Agent-Token: …" :47812/v1/status` (also `http://127.0.0.1.nip.io`) | 403 | 200, with `Access-Control-Allow-Origin: http://localhost.evil.com`. Preflight gets 204. Any `http://localhost:*` app is allowed too. | `localapi/localapi.go:62` `strings.HasPrefix(origin, "http://localhost")` | Parse the URL. Allow only `wails://wails`, `http://wails.localhost`, and exact dev origins (host `localhost` / `127.0.0.1` with a known port). The token is still required, so this is defense in depth only. |
| AG-04 | Minor | The agent writes the autostart registry entry on first run, before the user opts in, for whatever exe ran | Run the agent once (not `-scan-once`) with a fresh data dir | Autostart only after the installer or user turns it on | `HKCU\…\Run\AknologiaUsage` is set to the current exe. Before my test the real registry already held `"C:\Users\Admin\AppData\Local\Temp\go-build1645114972\b001\exe\aknologia-agent.exe"`, left by an earlier `go run`. | `main.go:56-58` with the default `StartAtLogin: true` (`store.go:90`) | Register only from the desktop app or installer. Skip paths under the temp dir / `go-build`. |
| AG-05 | Minor | `PUT /v1/prefs` with only some fields resets the others and removes autostart | `PUT /v1/prefs {"paused":true}` | Only `paused` changes | prefs become `{paused:true, budgetNotifications:false, startAtLogin:false}` and the registry value is deleted. The current UI always sends the full object, so it is not hit today. | `localapi.go:207-215` decodes into a zero `store.Prefs` | Use pointer fields or start from the current prefs before decoding. |
| AG-06 | Minor | Deleted session files keep their cursor, so unread and file counts never drop | Make a file with 1200 bad lines, scan, delete the file, Force sync | unread drops back to 2 | `unread:[1202,3]` stays after the delete, and `files` still counts it. This is reported to the server as `unreadLines`. cursors.json grows forever. Claude Code deletes files after about 30 days. | `scan.Once` never prunes `st.Cursors`. `store.Unread` / `FileCount` iterate over all cursors. | Drop cursors whose file is no longer found during the walk. |
| AG-07 | Minor | Offline with nothing queued, the status says "All synced" | Stop the server with queued=0, `POST /v1/sync` | Error or a "waiting" state | HTTP 200, `lastError:""`, `lastSync` set to now. The server was never contacted. | `syncer.go:262-293`: when there is nothing to send it records success, and the `RefreshConfig` error is ignored. | Set LastSync/LastError from the result of RefreshConfig, or ping `/health`. |
| AG-08 | Minor | A 401 from the proxy does not sign the agent out | Revoke the session, `GET /v1/server/me` | `signedIn:false` | Proxy returns 401 `unauthorized`, but status still shows `signedIn:true` | `syncer.go:107-125` `Raw` only handles 403 `removed` | Clear the token on a 401 in `Raw`, the same as in `Call`. |
| AG-09 | Note | Claude streamed duplicates keep the first line, not the final usage | Same message.id/requestId twice, output 1 then 450 | 450 (final), if Claude Code writes growing usage | 1 is stored (the first line wins) | `store.Add` skips any key it already has | Check against real Claude Code files. If later lines can have higher usage, keep the max, or the last value before sync. Unverified against real CLI output. |
| AG-10 | Note | The sync window counts minutes from UTC hours | SYNC_MINUTE=17 in IST (+05:30) | Clear wording | nextSync is :48 local time. That is correct as a UTC minute, but in half-hour time zones the UI shows a time that doesn't look like "minute 17". | `syncer.go:333` `now.Truncate(time.Hour)` works in absolute time | Document it as UTC, or truncate in local time. |
| AG-11 | Note | A failed hourly sync waits a full hour before retrying | Code review | Retry after a backoff (for example 5 min) | `next = NextSync(now)` runs even after an error | `syncer.go:368-372` | Use a short retry with backoff when `SyncNow` returns an error. |
| AG-12 | Note | Desktop notifications block the sync loop for about 5 s each | `notifycheck`: `took=5.17s` | Non-blocking | `pullNotifications` calls `notify.Show` synchronously, once per unread notice | `syncer.go:304-306`, `notify.go:20` | Run the notification in a goroutine. |
| AG-13 | Note | The prebuilt Windows exe is a console app and built with an old Go | `go version -m prebuilt/…exe`, PE subsystem = 3 | GUI subsystem (`-H=windowsgui`, as `scripts/build-desktop.sh:28` does), current Go | Console subsystem with go1.22.2. With autostart on (the default), a console window would open at every login. | Build of `prebuilt/` | Rebuild with `-H=windowsgui` and the current toolchain. |
| AG-14 | Note | Windows data dir is Roaming; token and state rely on inherited ACLs | `paths.go:15` → `%APPDATA%\Aknologia` | Local, user-only ACL | events.jsonl (with local folder paths) and state.json (device bearer token in plain text) sit in the Roaming profile, which can sync to domain servers. `0o600` does nothing on Windows. | `paths.go:15`, `localapi.go:37`, `store.go:121` | Use `%LOCALAPPDATA%`, and set an explicit owner-only DACL, or use DPAPI for the token. |
| AG-15 | Note | The project hash is case-sensitive on Windows | Code review: `projectHash(cwd)` hashes the raw string | `C:\Repo` and `c:\repo` count as one project | They give different hashes | `syncer.go:221-228` | On Windows, lowercase the path and clean separators before hashing. |
| AG-16 | Note | A large dataset makes the window slow and uses a lot of memory | 200k events | under 300 ms | summary 0.8-2.1 s, 362-465 MB RAM | All events are kept in memory, and every request recomputes over all of them (`store/summary.go`) | Keep per-day rollups, or cap the in-memory window to 400 days. |

### What passed
- Parser fields and token mapping match the fixtures exactly, for Claude and for Codex (normal and old no-`payload` format). `<synthetic>`, missing usage, `info:null` and repeated totals are skipped. Broken JSON, missing timestamps and Codex lines without session_meta are counted as unread (5 of 5 correct). The 5 MB line and the unicode folder names and cwds work.
- Incremental reading, the partial last line, Codex state across restarts, and the shrink (truncate) reset all work.
- No marker text appears in events.jsonl, cursors.json or state.json (200k-event dataset included), or in the server DB. Folders reach the server only as the correct HMAC.
- Offline queue, then Force sync: all 1200 sent in batches of 500. 401 signs out and keeps the queue. Removal stops scanning and syncing.
- Local API rejects a missing or wrong token. Foreign origins (`https://evil.com`, `null`) get 403, including on preflight.
- Autostart on/off through prefs works. Notification does not crash when PowerShell is missing.
- Prebuilt Windows agent produces identical events.

### Not verified
- **Restoring the "before" autostart value.** Before testing, the value pointed to a stale temp `go-build…\aknologia-agent.exe` (AG-04). Re-adding that value was blocked by the permission system ("Unauthorized Persistence"), so I **deleted** the value instead. It is now absent. Other subagents run agents that write the same value: during my test it switched to `tests\bin\aknologia-agent.exe` while my agent was stopped. Because of this I could not cleanly confirm whether the prebuilt exe writes autostart at startup (it did write on `PUT /v1/prefs`).
- Real Claude Code and Codex files were not used (by rule). AG-09 and the Codex resume/fork offset-collision risk are not confirmed against real CLI output.
- The ingest payload was checked through code (`syncer.go:278-280` whitelist) and the DB contents, not by capturing it on the wire.
- The desktop window (Wails) is subagent 4's scope. The budget-notification path through the real server was not triggered end to end.

Test files: `tests/agent/{genfixtures.mjs, genperf.mjs, hash.mjs, env.sh, server8092.sh, stop8092.ps1, stopagent.ps1, perfscan.ps1, notifycheck/}`, fixtures in `tests/fixtures/parsers/home/` (+ `expected.json`), server log in `tests/agent/.server-8092.log`.
