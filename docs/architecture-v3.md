# Hindsight-pi v3 Architecture

## Defaults

- Recall is fresh per turn and derived from the current user intent.
- Auto-recall is ephemeral by default: it is injected for the provider request but not persisted to normal chat history.
- The canonical recall custom message type is `hindsight-recall`.
- Old `hindsight-recall` messages are filtered from provider context, including disabled mode.
- Retention queues structured JSON records at `message_end`.
- Queued records are flushed per `writeFrequency`, without blocking the turn: `turn` (default) flushes after every agent turn, `async` after every message, `session` only at a session boundary, and a numeric value N flushes every N turns. See `docs/architecture-v3.md#flush-policy`.
- Retention writes use `retainBatch`, including single-item writes, because observation scopes are supported there.
- Recommended memory model is one bank plus tags/observation scopes. Multiple banks are reserved for hard boundaries.

## Recall query construction

Raw user input wins over expanded prompt text. This prevents skill/slash-command expansions from becoming oversized or noisy recall queries.

Slash command behavior:

- Command-only turns such as `/hindsight:status` skip recall.
- Slash commands with user intent use trailing args, e.g. `/skill:create-agents-md create AGENTS.md` recalls with `create AGENTS.md`.
- Long queries default to warning + skip via `recallLongQueryBehavior=skip`.

## Provider context safety

The context hook removes existing `hindsight-recall` messages before injecting the current turn's recall. This prevents stale persisted recall from being sent back to the model.

If persisted recall is enabled for debugging, uninstalling the extension can expose old recall messages to Pi provider serialization. Either keep the extension installed with memory disabled so filtering remains active, or run `/hindsight:prune-recall-messages confirm` before uninstalling.

## Retention

Messages are prepared declaratively using:

- `retainContent`
- `strip`
- `toolFilter`

Hindsight tools and `hindsight-recall` messages are excluded by default to avoid feedback loops.

Queued records include:

- stable `document_id`
- `update_mode: append`
- session context
- session start timestamp
- automatic tags
- expanded observation scopes

### Flush policy

The queue is durable on disk (`~/.hindsight/pi-queues/<session>.auto.jsonl`), so a killed process never loses records. Draining it is driven by `writeFrequency`:

| `writeFrequency` | Flush trigger | Requests per session |
|---|---|---|
| `turn` (default) | end of every agent turn | one per turn |
| `async` | end of every queued message | one per message |
| `session` | session boundary only | one per session |
| `N` (integer) | every N turns | one per N turns |

Session boundaries (`session_before_switch`, `session_before_fork`, `session_before_compact`, `session_shutdown`) and `/hindsight:flush` always flush, regardless of `writeFrequency`; that is the durability floor.

Mid-session flushes are fire-and-forget and coalesce: `retainBatch({ async: false })` waits for server-side extraction, so awaiting it at the end of a turn would stall the UI. While a flush is in flight, further triggers collapse into a single trailing run (`extensions/flush-runner.ts`). Boundary flushes do wait, so the queue reaches the server before the process exits.

The queue file is deleted only after a successful upload, so a failed flush is retried by the next trigger.

## Tags and scopes

Automatic tags include:

- `harness:pi`
- `session:<id>`
- `parent:<id>`
- `cwd:<path>`
- `basedir:<name>`
- `project:<name>`
- `store_method:auto|tool`

Supported placeholders:

- `{session}`
- `{parent}`
- `{cwd}`
- `{basedir}`
- `{project}`

Use `autoRecallTags` with `autoRecallTagsMatch` for project-specific recall without requiring separate project banks.

## Privacy tradeoffs

Use tags/scopes for relevance boundaries, not hard security boundaries. If work and personal memories must never mix, use separate banks and possibly separate Hindsight servers/API keys.

Broad recall can surface useful cross-project preferences and practices, but it can also recall irrelevant project facts. Project-scoped recall via `autoRecallTags: ["{project}"]` is better when a repo has little useful overlap with other repos.

Persisted recall is for debugging. It creates session-file artifacts that require this extension's filter to stay safe. Before uninstalling, run `/hindsight:prune-recall-messages confirm` in sessions where persisted recall was used.
