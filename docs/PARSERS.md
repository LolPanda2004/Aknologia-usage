# Session parsers

Both formats are undocumented by their vendors and can change between CLI versions. Lines the agent can't
understand are counted as **unread** (shown in Settings → Sync and sources, and in the admin Data health panel)
instead of being guessed. Parser versions (`claude-2`, `codex-1`) are stored on every event.

## Claude Code

Files: `~/.claude/projects/<folder>/<session>.jsonl` and `~/.config/claude/projects/…`, or
`$CLAUDE_CONFIG_DIR/projects`.

Used lines: `"type": "assistant"` with `message.usage`.

| Event field | Source |
|---|---|
| session | `sessionId` (falls back to the file name) |
| message / request | `message.id` / `requestId` |
| model | `message.model` (`<synthetic>` lines are skipped) |
| input / output | `usage.input_tokens` / `usage.output_tokens` |
| cache write / read | `usage.cache_creation_input_tokens` / `usage.cache_read_input_tokens` |
| 1-hour cache write | `usage.cache_creation.ephemeral_1h_input_tokens` (the rest is 5-minute) |
| fast mode / geo / web search | `usage.speed` / `usage.inference_geo` / `usage.server_tool_use.web_search_requests` |
| time / folder | `timestamp` / `cwd` |

Streaming can write the same message more than once with growing output; the dedup key (session + message +
request) keeps one event, and a later line with more output replaces it (and is sent again). Parser `claude-2` reads
the billing fields above; after an upgrade the agent re-reads Claude Code files once to fill them in for history.

## Codex

Files: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`, or `$CODEX_HOME/sessions`.

* `session_meta` gives the session ID and folder; `turn_context` gives the model.
* `event_msg` with `payload.type = token_count` and a non-null `info` gives usage from `info.last_token_usage`.
* A report whose `info.total_token_usage.total_tokens` equals the previous one is a repeat and is skipped.
* Message ID = `off:<byte offset of the line>`, stable across rescans.

**Token mapping (assumption, please verify on your files):** Codex's `input_tokens` includes cached tokens, so
`input = input_tokens − cached_input_tokens` and `cacheRead = cached_input_tokens`. `output = output_tokens`, which
is taken to already include reasoning tokens. If your files show otherwise, adjust `Codex()` in
`agent/internal/parse/parse.go` and bump `CodexVersion`.

## Testing a parser against real files

```bash
cd agent
AKN_DATA_DIR=/tmp/akn-test go run ./cmd/aknologia-agent -scan-once
# files=… new_events=… unread_lines=…   (unread should be 0)
```

Unit tests with fixtures: `go test ./internal/parse/`. Add a sanitized line from a new CLI version to
`internal/parse/testdata/` whenever a format changes.
