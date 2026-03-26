# Technology Stack

## Overview

Acepe is an agent-first IDE built as a macOS desktop application (Tauri 2) with a companion marketing/waitlist website. The monorepo uses Bun workspaces.

---

## Monorepo Structure

Root config: `/Users/alex/Documents/acepe/package.json`
Package manager: **Bun** (not npm/yarn). Node.js 20.x minimum declared.

| Package | Path | Role |
|---|---|---|
| `acepe-tauri` | `packages/desktop` | Main desktop app |
| `@acepe/claude-agent-acp` | `packages/acps/claude` | Claude Code ACP adapter binary |
| `@acepe/analytics` | `packages/analytics` | Shared analytics event enum |
| `@acepe/changelog` | `packages/changelog` | Changelog data |
| `@acepe/ui` | `packages/ui` | Shared Svelte component library |
| `website` | `packages/website` | Marketing/waitlist SvelteKit site |

---

## Desktop App (`packages/desktop`)

### Runtime & Build

- **Package manager**: Bun 1.x
- **Desktop framework**: Tauri 2 (`@tauri-apps/cli ^2`, Rust crate `tauri = "2"`)
- **Frontend build**: Vite 6 (`vite ^6.0.3`) with SvelteKit adapter-static (SPA mode, `fallback: "index.html"`)
- **Dev server port**: `http://localhost:1420`
- **Config files**: `packages/desktop/vite.config.js`, `packages/desktop/svelte.config.js`, `packages/desktop/src-tauri/tauri.conf.json`

### Frontend Languages & Frameworks

- **TypeScript** — compiler: `@typescript/native-preview` (tsgo), `typescript ~5.6.2`
- **Svelte 5** with runes API (`svelte ^5.0.0`)
- **SvelteKit 2** (`@sveltejs/kit ^2.9.0`)
- **TailwindCSS 4** (`tailwindcss ^4.1.18`, `@tailwindcss/vite`)
- **Shadcn-Svelte** (`shadcn-svelte ^1.1.0`) + **Bits UI** (`bits-ui ^2.14.4`) for headless UI primitives

### Key Frontend Libraries

| Category | Library | Version |
|---|---|---|
| State machines | XState | `^5.25.0` |
| Code editor | CodeMirror 6 | `^6.0.2` + `@codemirror/*` |
| Terminal emulator | xterm.js | `^5.3.0` + addons |
| Pseudo-terminal | tauri-pty | `^0.2.1` |
| Markdown | markdown-it | `^14.1.0` |
| Syntax highlighting | Shiki | `^3.20.0`, `@shikijs/markdown-it ^3.20.0` |
| Diagrams | Mermaid | `^11.12.2`, `beautiful-mermaid ^0.1.3` |
| Diff display | @pierre/diffs | `^1.0.4`, `diff ^8.0.3` |
| Virtualization | Virtua | `^0.48.5`, `@tanstack/svelte-virtual ^3.13.19` |
| Charts | Layerchart | `2.0.0-next.43` |
| Error handling | neverthrow | `^8.2.0` (no try/catch pattern) |
| Validation | Zod | `^4.2.1` |
| YAML parsing | yaml | `^2.8.2` |
| LRU cache | lru-cache | `^11.2.4` |
| Keybindings | tinykeys | `^3.0.0` |
| Icons | phosphor-svelte, @tabler/icons-svelte, @lucide/svelte | various |
| Shader backgrounds | @paper-design/shaders | `^0.0.68` |
| UI utilities | clsx, tailwind-merge, tailwind-variants, class-variance-authority, tw-animate-css | various |
| Notifications | svelte-sonner | `^1.0.7` |
| Theme | mode-watcher | `^1.1.0` |

### Internationalization

- **Paraglide JS** (`@inlang/paraglide-js ^2.6.0`) — typesafe i18n
- Inlang project config: `packages/desktop/project.inlang/`
- Message files: `packages/desktop/messages/`
- Vite plugin generates output to `packages/desktop/src/lib/paraglide/`

### Rust Backend (Tauri core process)

- **Language**: Rust, edition 2021
- **Cargo manifest**: `packages/desktop/src-tauri/Cargo.toml`
- **Async runtime**: Tokio 1 (multi-threaded; features: `fs`, `io-util`, `rt-multi-thread`, `macros`, `sync`, `process`, `signal`, `time`)
- **Internal HTTP server**: Axum 0.7 — event bridge SSE endpoint, binds to `127.0.0.1:0` (dynamic port)
- **HTTP client**: reqwest 0.12 (rustls-tls, JSON, streaming, gzip)
- **Type bridge**: specta `=2.0.0-rc.22` + tauri-specta `=2.0.0-rc.21` — generates TypeScript bindings from Rust types at `packages/desktop/src-tauri/src/bindings/`
- **macOS-specific**: objc2 (Objective-C bridge), libc, `macos-private-api` Tauri feature

### Rust Source Module Map

All paths under `packages/desktop/src-tauri/src/`:

| Module | Path | Purpose |
|---|---|---|
| ACP engine | `acp/` | Agent Client Protocol: providers, client loop, streaming batcher, permissions, task reconciler, GitHub commands |
| Database | `db/` | SeaORM + migrations (SQLite) |
| Voice | `voice/` | Whisper.rs on-device transcription |
| SQL Studio | `sql_studio/` | Multi-DB connections + S3 browser |
| Storage commands | `storage/` | Project/session Tauri commands |
| Git | `git/` | Git status, diff, log |
| File index | `file_index/` | File picker indexer (@ mentions) |
| PTY | `pty/` | Pseudo-terminal |
| Terminal | `terminal/` | Terminal session management |
| History parsers | `history/`, `cursor_history/`, `opencode_history/`, `codex_history/` | Session JSONL import |
| Checkpoint | `checkpoint/` | Session checkpointing |
| Skills | `skills/` | Agent skill management |
| Bindings | `bindings/` | specta TypeScript exports |
| Analytics | `analytics.rs` | Sentry init and helpers |
| Shell env | `shell_env.rs` | PATH repair for macOS bundles |
| Path safety | `path_safety.rs` | Path validation |
| Project access | `project_access.rs` | Filesystem access guards |

### Local Database (Desktop)

- **Engine**: SQLite
- **ORM**: SeaORM 0.12 (`sea-orm`, `sea-orm-migration`) + sqlx 0.7
- **Direct queries**: rusqlite 0.29 (bundled feature)
- **Location**: `{data_local_dir}/Acepe/acepe.db` (prod), `acepe_dev.db` (debug), `acepe_staging.db` (staging)
- **Migrations**: 15 versioned files in `packages/desktop/src-tauri/src/db/migrations/`
- **Key tables**: projects, settings, app_settings, session_metadata, skills, worktrees, checkpoints, file_snapshots, sql_studio_connections, session_review_state

### Voice Dictation Stack

- `cpal 0.15` — cross-platform audio capture
- `ringbuf 0.4` — lock-free ring buffer for audio samples
- `whisper-rs =0.16.0` with `metal` feature — GPU-accelerated transcription on macOS, CPU fallback
- `zeroize 1` — secure memory clearing of audio buffers
- Models downloaded from HuggingFace CDN at runtime (up to 2 GB)

### Other Notable Rust Crates

- `git2 0.19` (vendored libgit2) — Git operations
- `ignore 0.4` — gitignore-aware file traversal
- `notify 6` + `notify-debouncer-mini 0.4` — filesystem watching
- `rayon 1.10` — parallel file scanning
- `dashmap 6` — concurrent hashmap (scan cache)
- `partial-json-fixer 0.5` — streaming tool input parsing recovery
- `tar 0.4`, `flate2 1.0`, `zip 2` — agent binary archive extraction
- `sentry 0.38` (with tracing feature) — error reporting
- `tracing 0.1` + `tracing-subscriber 0.3` — structured logging
- `uuid 1` (v4, v5) — session/request IDs
- `chrono 0.4` — timestamps
- `sha2 0.10`, `hex 0.4`, `md5 0.7`, `base64 0.22` — hashing and encoding
- `fix-path-env` (git dep, tauri-apps/fix-path-env-rs) — PATH fix for macOS app bundles
- `tauri-plugin-mcp-bridge 0.9` — MCP bridge plugin
- `nix 0.28` (Unix only) — signal and process handling

### macOS Entitlements

Config: `packages/desktop/src-tauri/Entitlements.plist`

- App sandbox: **disabled**
- Network client + server: enabled
- Full filesystem read/write: enabled
- Unsigned executable memory: enabled (required for Whisper Metal)
- Library validation: disabled

### Linting & Formatting

- **Biome 2** (`@biomejs/biome ^2.4.7`) — replaces ESLint + Prettier entirely
- Config: `packages/desktop/biome.json`
- Pre-push hook: `.husky/pre-push` — runs typecheck + Bun tests (no lint step)

### Testing

- **Bun test** — primary runner for desktop unit/integration tests (1482+ tests across 113 files, ~7.5s)
- **Vitest 4** (`vitest ^4.0.16`) — Svelte 5 runes component tests (`.vitest.ts` extension)
- **Playwright** (`playwright ^1.57.0`) — E2E / browser tests
- **Happy DOM** (`@happy-dom/global-registrator ^20.1.0`) — DOM environment for Bun
- **Testing Library Svelte** (`@testing-library/svelte ^5.3.1`)
- **Insta** (Rust `insta 1`) — snapshot testing with JSON support
- **tokio-test 0.4** (Rust) — async test utilities
- **hound 3** (Rust dev) — WAV audio file I/O for voice tests

### CI / Release

- Workflow: `.github/workflows/release.yml`
- Trigger: push to `v*` tags
- Runner: `macos-latest`, target `aarch64-apple-darwin`
- Uses `tauri-apps/tauri-action@v0`
- Version set from git tag into `tauri.conf.json` at build time
- Rust cache: `Swatinem/rust-cache@v2`
- Required secrets: `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`, `SENTRY_DSN`, `VITE_SENTRY_DSN`
- Updater JSON published at: `https://github.com/flazouh/acepe/releases/latest/download/latest.json`

---

## ACP Adapter Binary (`packages/acps/claude`)

- **Language**: TypeScript compiled to a Bun single-file binary
- **Entry point**: `packages/acps/claude/src/static-entry.ts`
- **Build command**: `bun build src/static-entry.ts --compile --define 'process.env.CLAUDE_AGENT_ACP_IS_SINGLE_FILE_BUN="true"' --outfile dist/claude-agent-acp`
- **Key deps**: `@agentclientprotocol/sdk 0.15.0`, `@zed-industries/claude-agent-acp 0.21.0` (patched via `patches/`)
- **Behavior**: Routes `--cli` flag to the upstream Claude CLI; otherwise starts as an ACP agent server

---

## Website (`packages/website`)

### Runtime & Deployment

- **Deployment**: Railway — config at `/Users/alex/Documents/acepe/railway.json`, Nixpacks builder
- **Start command**: `cd packages/website && node build`
- **Adapter**: `@sveltejs/adapter-node ^5.4.0`
- **Health check path**: `/health`

### Frontend Stack

- **SvelteKit 2** (`@sveltejs/kit ^2.49.1`) + **Svelte 5** (`svelte ^5.45.6`)
- **TypeScript** 5.9.3
- **TailwindCSS 4** (`tailwindcss ^4.1.17`, `@tailwindcss/vite`)
- **Vite 7** (`vite ^7.2.6`)
- **Biome 2** for lint/format
- Shares `@acepe/ui` component library

### Backend / Database

- **ORM**: Drizzle ORM (`drizzle-orm ^0.36.0`) + Drizzle Kit 0.28
- **Database**: PostgreSQL 16 (`postgres ^3.4.5`); locally via Docker Compose (`postgres:16-alpine`, port 5432)
- **Schema**: `packages/website/src/lib/server/db/schema.ts`
- **Drizzle config**: `packages/website/drizzle.config.ts`
- **Password hashing**: bcrypt (`bcrypt ^5.1.1`)
- **Logging**: pino (`pino ^10.1.0`)
- **ID generation**: nanoid (`nanoid ^5.0.0`)
- **Error handling**: neverthrow (`neverthrow ^8.2.0`)

---

## Shared Packages

### `@acepe/ui` (`packages/ui`)

Svelte 5 component library. Key exported surfaces: Button, Input, Dialog, Drawer, NavigationMenu, GitViewer, GitPanel, SqlStudio, AgentPanel, TerminalPanel, FilePanel, PlanSidebar, PlanCard, ProjectCard, Markdown, DiffPill, Checkpoint, InlineArtefact, RichTokenText, UserReports, Selector, DropdownMenu, FileIcon, FilePathBadge.

### `@acepe/analytics` (`packages/analytics/src/index.ts`)

Shared `AnalyticsEvent` enum: `AgentChanged`, `AppError`, `ChangelogViewed`, `Downloaded`, `PlanViewed`, `UpdateAvailable`, `AcpError`.

### `@acepe/changelog` (`packages/changelog`)

Static changelog data (`changelog-data.ts`) consumed by desktop and website.
