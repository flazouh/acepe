# Acepe — Architecture

## Pattern

Acepe is a **Tauri 2 desktop application** combining a **Rust backend** with a **SvelteKit 2 / Svelte 5** frontend. It acts as a multi-agent IDE hub: it speaks the **Agent Client Protocol (ACP)** to AI coding agents (Claude Code, Cursor, OpenCode, Codex) and renders their session history, streaming responses, tool calls, and diffs in a rich panel-based UI.

The architecture has three primary integration points:

1. **Tauri IPC** (`invoke`) — synchronous request/response calls from frontend to Rust backend via `#[tauri::command]` handlers.
2. **SSE Event Bridge** — a localhost Axum HTTP server (`/acp/events`) that streams `AcpEventEnvelope` objects to the frontend via `EventSource`. This bypasses Tauri's built-in event system for performance.
3. **ACP subprocess protocol** — the Rust backend spawns AI agent processes (e.g. `claude-agent-acp`) and communicates via JSON-RPC over stdio.

---

## Layers

### Frontend (`packages/desktop/src/`)

| Layer | Path | Responsibility |
|-------|------|----------------|
| Route shell | `src/routes/+layout.svelte`, `+page.svelte` | App bootstrap, locale init, analytics, highlight pre-warming. `+page.svelte` renders `MainAppView`. |
| Top-level view | `src/lib/components/main-app-view.svelte` | Creates all Svelte context stores, wires callbacks, renders panels, overlays, sidebar, tab bar. |
| Store layer | `src/lib/acp/store/` | All reactive Svelte 5 rune state (`$state`, `$derived`). Context-based: each store is `setContext`/`getContext`-accessed. |
| Logic layer | `src/lib/acp/logic/` | Pure TS classes (no Svelte runes). `AcpClient`, `EventSubscriber`, `SessionMachine` (XState), `ProjectManager`, `ConnectionManager`, `MessageProcessor`. |
| Tauri client | `src/lib/utils/tauri-client/` | Domain-namespaced thin wrappers over `invoke()` returning `ResultAsync`. Never call `invoke` directly outside this layer. |
| Components | `src/lib/acp/components/` | Svelte components organised by feature (agent-panel, messages, file-panel, git-panel, terminal, etc.). |
| Services | `src/lib/services/` | TS-only data types and conversion helpers (`claude-history-types.ts`, `converted-session-types.ts`, `claude-history.ts`). |
| Hooks | `src/lib/acp/hooks/` | Composable Svelte hooks (`use-acp-client`, `use-plan-inline`, `use-command-palette`, etc.). |
| Utils | `src/lib/acp/utils/` | Shared utilities: `invoke.ts` (base IPC wrapper), `markdown-renderer.ts`, `logger.ts`, `chunked-processor.ts`, etc. |

### Rust Backend (`packages/desktop/src-tauri/src/`)

| Module | Path | Responsibility |
|--------|------|----------------|
| Entry / setup | `lib.rs` | App startup, Tauri setup, command registration (`invoke_handler`), managed state initialization. |
| ACP core | `acp/` | Agent protocol, subprocess lifecycle, session registry, event dispatch. |
| Database | `db/` | SQLite via SeaORM, migration runner, repositories for projects/settings/session metadata. |
| Session history | `session_jsonl/`, `history/` | Reading/parsing `.jsonl` session files, indexing (actor pattern), caching. |
| Storage commands | `storage/commands/` | CRUD Tauri commands for projects, settings, API keys, review state. |
| File index | `file_index/` | Project file tree, git status, diff, read/write operations. |
| Git | `git/` | Worktree management, branch operations, PR integration, HEAD watcher. |
| Terminal | `terminal/`, `pty/` | PTY-based terminal management. |
| Checkpoints | `checkpoint/` | File snapshot/revert system. |
| Skills | `skills/` | Agent skill library management. |
| Voice | `voice/` | Local voice model (Whisper) management. |
| SQL Studio | `sql_studio/` | Database explorer commands. |
| Agent history adapters | `cursor_history/`, `codex_history/`, `opencode_history/` | Per-agent history format parsers. |

---

## Data Flow

### 1. Frontend to Backend (IPC invoke)

```
Component / Store
  -> tauriClient.{domain}.{method}()        (src/lib/utils/tauri-client/{domain}.ts)
  -> invokeAsync(cmd, args)                  (src/lib/utils/tauri-client/invoke.ts)
  -> @tauri-apps/api/core invoke()
  -> Rust #[tauri::command] fn               (src-tauri/src/{module}/commands/*.rs)
  -> ResultAsync<T, AppError>
```

All invocations are wrapped in `ResultAsync` (neverthrow). Errors surface as `AppError` subtypes; no `try/catch` in business logic.

### 2. Backend to Frontend (SSE Events)

```
Rust ACP client loop (acp/client_loop.rs)
  -> AcpUiEventDispatcher.dispatch(AcpUiEvent)
  -> AcpEventHubState.publish(envelope)      (broadcast channel, capacity 8192)
  -> Axum SSE handler /acp/events            (acp/event_bridge_server.rs)
  -> EventSource (acp/logic/acp-event-bridge.ts)
  -> EventSubscriber.subscribe() callback    (acp/logic/event-subscriber.ts)
  -> SessionEventService.handleUpdate()      (acp/store/session-event-service.svelte.ts)
  -> SessionStore / SessionEntryStore / PermissionStore / QuestionStore
  -> Svelte reactive state -> UI re-render
```

The SSE bridge uses a UUID token for auth and runs on a random localhost port. The frontend fetches the URL via `acp_get_event_bridge_info`.

### 3. Agent Subprocess Protocol

```
acp_new_session (Tauri command)
  -> create_and_initialize_client()          (acp/commands/session_commands.rs)
  -> AgentRegistry.get(agent_id)             (acp/registry.rs)
  -> AgentProvider.spawn_config()            (acp/providers/claude_code.rs etc.)
  -> tokio::process::Command spawn           (acp/client_session.rs)
  -> JSON-RPC over stdin/stdout              (acp/client_loop.rs)
  -> StreamingDeltaBatcher / TaskReconciler  (streaming pipeline)
  -> AcpUiEventDispatcher.dispatch()
  -> SSE bridge (see above)
```

Each session gets its own dedicated subprocess and `SessionRegistry` entry. Sessions are keyed by a string session ID. `SessionRegistry` is a `DashMap<String, SessionEntry>` for lock-free concurrent access.

---

## Key Abstractions

### Frontend

**`AcpClient`** (`src/lib/acp/logic/acp-client.ts`)
Thin typed wrapper around `tauriClient.acp.*` calls. Tracks initialization state. All methods return `ResultAsync<T, AcpError>`.

**`SessionStore`** (`src/lib/acp/store/session-store.svelte.ts`)
Single source of truth for all session state. Orchestrates sub-stores and services:
- `SessionEntryStore` — per-session message entries (cold content from disk)
- `SessionHotStateStore` — transient state (streaming status, mode, model)
- `SessionCapabilitiesStore` — agent feature flags
- `SessionConnectionService` — XState machine actors per session
- `SessionEventService` — SSE subscription and event routing
- `SessionRepository` — disk I/O (scan, load, CRUD via Tauri)
- `SessionMessagingService` — send prompt, cancel
- `SessionConnectionManager` — connect/disconnect lifecycle

**`SessionMachine`** (`src/lib/acp/logic/session-machine.ts`)
XState parallel state machine with two regions:
- `Content`: `unloaded -> loading -> loaded | error` (history loading from disk)
- `Connection`: `disconnected -> connecting -> warmingUp -> ready -> awaitingResponse -> streaming -> paused | error`

**`PanelStore`** (`src/lib/acp/store/panel-store.svelte.ts`)
Manages workspace layout: `workspacePanels[]`, `reviewPanels[]`, `gitPanels[]`, `focusedPanelId`, `viewMode` (single/project/multi). Panel types: agent, file, terminal, browser, git, review.

**`WorkspaceStore`** (`src/lib/acp/store/workspace-store.svelte.ts`)
Serialises/deserialises the full workspace layout to/from SQLite via `save_user_setting`.

**`EventSubscriber`** (`src/lib/acp/logic/event-subscriber.ts`)
Manages a single native `EventSource` with fan-out to multiple `Map`-tracked listeners. Cleans up the native listener when all subscribers unsubscribe.

**Store context pattern**
All major stores follow: `class FooStore { ... }`, exported `createFooStore()` factory, `getFooStore()` context accessor using Svelte's `setContext`/`getContext` with a `Symbol` key. Stores are instantiated once in `main-app-view.svelte` and accessed anywhere below via context.

**`tauriClient`** (`src/lib/utils/tauri-client/index.ts`)
Assembled from domain sub-clients: `acp`, `checkpoint`, `fileIndex`, `fs`, `git`, `history`, `projects`, `sessionReviewState`, `settings`, `shell`, `skills`, `sqlStudio`, `terminal`, `voice`, `workspace`. Each sub-client wraps `invokeAsync()`.

### Backend

**`AgentProvider` trait** (`src-tauri/src/acp/provider.rs`)
Interface for agent backends: `id()`, `name()`, `spawn_config()`, `is_available()`, `normalize_mode_id()`. Implementations: `ClaudeCodeProvider`, `CursorProvider`, `OpenCodeProvider`, `CodexProvider`, custom via `CustomAgentConfig`.

**`AgentClient` trait** (`src-tauri/src/acp/client_trait.rs`)
Async trait for protocol operations: `start`, `initialize`, `new_session`, `resume_session`, `send_prompt_fire_and_forget`, `cancel`, `respond`. Two communication modes: `Subprocess` (JSON-RPC over stdio) and `Http` (OpenCode REST + SSE).

**`SessionRegistry`** (`src-tauri/src/acp/session_registry.rs`)
`DashMap<String, SessionEntry>` holding per-session `Arc<TokioMutex<Box<dyn AgentClient>>>`. Concurrent read, exclusive write per session.

**`AcpEventHubState`** (`src-tauri/src/acp/event_hub.rs`)
Tokio broadcast channel (capacity 8192) for `AcpEventEnvelope`. The Axum SSE handler subscribes to this channel and streams envelopes to the frontend.

**`StreamingDeltaBatcher`** (`src-tauri/src/acp/streaming_delta_batcher.rs`)
Coalesces high-frequency streaming deltas before dispatch to the UI event bus.

**`StreamingAccumulator`** (`src-tauri/src/acp/streaming_accumulator.rs`)
Accumulates `streaming_input_delta` chunks per tool call, parses partial JSON, provides normalised data (todos, questions) for progressive UI display. Throttle: 150ms. Max per tool call: 1MB.

**`TaskReconciler`** (`src-tauri/src/acp/task_reconciler.rs`)
Normalises Claude Code's separate parent/child tool-call events into pre-assembled `ToolCallData` with `task_children` populated. Buffers orphaned children waiting for parent arrival.

**`IndexerActor`** (`src-tauri/src/history/indexer.rs`)
Actor-pattern background process for session metadata indexing. Full scan on first run; incremental on subsequent runs. Persists to `session_metadata` SQLite table.

**`ProjectRepository` / `AppSettingsRepository` / `SessionMetadataRepository`** (`src-tauri/src/db/repository.rs`)
SeaORM-based repositories over a single SQLite database at `~/.local/share/Acepe/acepe.db` (prod) or `acepe_dev.db` (debug), selected by `ACEPE_ENV` env var or build mode.

---

## Entry Points

| Entry | Location |
|-------|----------|
| Rust main | `packages/desktop/src-tauri/src/main.rs` — calls `lib::run()` |
| Rust app setup | `packages/desktop/src-tauri/src/lib.rs` — `run()` function |
| SvelteKit root layout | `packages/desktop/src/routes/+layout.svelte` |
| SvelteKit root page | `packages/desktop/src/routes/+page.svelte` — renders `<MainAppView />` |
| Store boot | `packages/desktop/src/lib/components/main-app-view.svelte` |
| Tauri command registry | `packages/desktop/src-tauri/src/lib.rs` `invoke_handler![]` macro (~line 760) |

---

## Startup Sequence (Rust `run()`)

1. Parse CLI flags (`--audit-session` for headless timing audit).
2. Init Sentry, init logging (tracing-subscriber: file layer + optional console layer + Sentry layer).
3. Create Tokio runtime, register with Tauri async runtime.
4. `.setup()` callback:
   - Raise macOS file descriptor limits.
   - Pre-warm shell environment cache (async, 5s timeout).
   - Load/create analytics distinct ID from app data dir.
   - Init agent installer cache dir, clean stale temps, kill orphaned ACP processes (SIGTERM then SIGKILL after 500ms).
   - Pre-warm command availability cache.
   - Init SQLite database, run SeaORM migrations.
   - Remove legacy unsafe project roots (home/root dirs).
   - Spawn `IndexerActor`, start background incremental/full scan.
   - Init `AgentRegistry` (built-in + restored custom agents from DB).
   - Start Axum SSE event bridge server (random localhost port, UUID token).
   - Manage: `ActiveAgent`, `OpenCodeManagerRegistry`, `SessionRegistry`, `TerminalManager`, `VoiceState`, `FileIndexService`, `SkillsService`, `BrowserWebviewState`, `GitHeadWatcher`.
   - Enable macOS 120fps WebView fix for ProMotion displays.
5. Register all `#[tauri::command]` handlers (~120 commands).

---

## Error Handling

**Frontend**: Exclusively `neverthrow` `Result`/`ResultAsync`. No `try/catch` in business logic. `Result.fromThrowable` wraps synchronous throwers; `ResultAsync.fromPromise` wraps async. Error hierarchy: `AppError` -> `AgentError`, `ConnectionError`, `ProtocolError`, `SessionNotFoundError`, etc.

**Backend**: `anyhow::Result` for infrastructure; `AcpError` enum for protocol errors; `SerializableAcpError` for Tauri command return boundaries (JSON-serialisable tagged union).

---

## i18n

Paraglide JS (`src/lib/paraglide/`). Language strings accessed via `$lib/paraglide/messages.js`. Locale stored in SQLite and loaded at startup in `+layout.svelte`.

---

## Analytics / Observability

Sentry (via `sentry` crate + `sentry::integrations::tracing`). Errors become Sentry events; warn/info/debug become breadcrumbs only. Analytics distinct ID stored per-install in app data dir. Frontend analytics via PostHog (`src/lib/analytics.ts`).
