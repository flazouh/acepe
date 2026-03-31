# External Integrations

## Agent Client Protocol (ACP)

### What it is
The core communication protocol between Acepe and AI coding agents. ACP is a JSON-RPC 2.0 protocol transported over subprocess stdio (or HTTP for OpenCode). Acepe acts as the ACP host; agent processes are spawned as subprocesses.

### Protocol details
- **Transport (default)**: JSON-RPC 2.0 over subprocess stdin/stdout
- **Transport (OpenCode)**: HTTP REST + Server-Sent Events (SSE)
- **SDK**: `@agentclientprotocol/sdk 0.15.0`
- **Registry CDN**: `https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json` — used by `packages/desktop/src-tauri/src/acp/agent_installer.rs` to fetch agent download metadata

### Supported agents (built-in)

| Agent | Provider file | Communication |
|---|---|---|
| Claude Code | `src-tauri/src/acp/providers/claude_code.rs` | Subprocess stdio (JSON-RPC) |
| Cursor Agent | `src-tauri/src/acp/providers/cursor.rs` | Subprocess stdio (JSON-RPC) |
| OpenCode | `src-tauri/src/acp/providers/opencode.rs` | HTTP REST + SSE |
| Codex Agent | `src-tauri/src/acp/providers/codex.rs` | Subprocess stdio (JSON-RPC) |
| Custom | `src-tauri/src/acp/providers/custom.rs` | Subprocess stdio (JSON-RPC) |

### ACP event bridge (internal)
An Axum HTTP server (`src-tauri/src/acp/event_bridge_server.rs`) is started on `127.0.0.1:<dynamic-port>` and exposes `GET /acp/events?token=<uuid>` as an SSE stream. This allows MCP clients and other local consumers to subscribe to ACP events.

### Agent installer
`src-tauri/src/acp/agent_installer.rs` — downloads agent binaries on demand:
- Fetches registry JSON from ACP CDN
- Allowed download URL prefixes: `https://cdn.agentclientprotocol.com/`, `https://github.com/`, `https://downloads.cursor.com/`, `https://release-assets.githubusercontent.com/`, `https://objects.githubusercontent.com/`
- Verifies SHA-256 checksums
- Max download size: 500 MB
- Extracts `.tar.gz`, `.zip` archives
- Emits `agent-install:progress` Tauri events to frontend during download

---

## Claude Code (Anthropic)

- **Integration type**: ACP subprocess + bundled adapter binary
- **Adapter package**: `packages/acps/claude` (`@acepe/claude-agent-acp`)
- **Upstream dependency**: `@zed-industries/claude-agent-acp 0.21.0` (patched)
- **Binary**: compiled Bun single-file executable placed in Tauri resources
- **Authentication**: handled by Claude Code CLI itself (not Acepe)

---

## OpenCode

- **Integration type**: HTTP REST API + SSE (subprocess managed by Acepe)
- **Manager**: `src-tauri/src/acp/opencode/manager.rs` — spawns `opencode serve`, detects port via stdout regex, polls ready endpoint
- **SSE client**: `src-tauri/src/acp/opencode/sse.rs`
- **HTTP client**: `src-tauri/src/acp/opencode/http_client/`
- **Frontend SDK**: `@opencode-ai/sdk ^1.1.13`
- **Ready timeout**: 15 seconds, polling every 200ms
- **Provider**: `src-tauri/src/acp/providers/opencode.rs`

---

## Cursor Agent

- **Integration type**: ACP subprocess
- **Provider**: `src-tauri/src/acp/providers/cursor.rs`
- **Authentication**: `CURSOR_API_KEY` or `CURSOR_AUTH_TOKEN` env vars, or `agent login`
- **Model discovery**: spawns binary with `--list-models --output-format json --print`
- **Custom protocol extensions**: `src-tauri/src/acp/cursor_extensions.rs` — adapts Cursor-specific response formats

---

## Codex Agent (OpenAI)

- **Integration type**: ACP subprocess
- **Provider**: `src-tauri/src/acp/providers/codex.rs`
- **Binary**: downloaded on demand from ACP registry CDN
- **Authentication**: handled by Codex binary itself

---

## GitHub

### Commit and PR diff viewer
- **File**: `src-tauri/src/acp/github_commands.rs`
- **Method**: shells out to `git` CLI for commit diffs; uses `gh` CLI for authenticated PR operations
- **Unauthenticated reads**: reqwest HTTP client with `user-agent: acepe-desktop`
- **Hardcoded repo context**: owner `flazouh`, repo `acepe` for issue operations

### GitHub Issues integration
- **File**: `src-tauri/src/acp/github_issues.rs`
- **Operations**: list, create, update, comment, react — CRUD via `gh` CLI
- **Unauthenticated reads**: GitHub REST API via reqwest
- **Authentication check**: `gh auth status`
- **Constraints**: title max 256 chars, body max 65536 chars

### Tauri auto-updater
- **Plugin**: `tauri-plugin-updater =2.5.1`
- **Update endpoint**: `https://github.com/flazouh/acepe/releases/latest/download/latest.json`
- **Signing**: minisign public key embedded in `tauri.conf.json`

---

## Sentry (Error Tracking)

### Desktop frontend
- **Package**: `@sentry/svelte ^10.42.0`
- **Config**: `packages/desktop/src/lib/analytics.ts`
- **Features**: `browserTracingIntegration`, `replayIntegration`
- **Sample rates**: traces 10%, session replays 10%, error replays 100%
- **DSN env var**: `VITE_SENTRY_DSN`
- **Opt-out**: `localStorage` key `preferences:analytics-opt-out`
- **Source maps**: uploaded via `@sentry/vite-plugin ^5.1.1` when `SENTRY_AUTH_TOKEN` is set

### Desktop backend (Rust)
- **Crate**: `sentry 0.38` with `tracing` feature
- **Config**: `packages/desktop/src-tauri/src/analytics.rs`
- **Features**: release name, environment tag, stack traces, path sanitization (strips usernames from paths), PII disabled
- **Trace sample rate**: 10%
- **DSN env var**: `SENTRY_DSN`
- **Distinct ID**: anonymous UUID stored in app data dir, used as Sentry user ID

### Website
- **Package**: `@sentry/sveltekit ^10.42.0`
- **DSN env var**: `PUBLIC_SENTRY_DSN`

---

## AWS S3 (Desktop SQL Studio)

- **Rust crates**: `aws-sdk-s3 1`, `aws-config 1`, `aws-credential-types 1`
- **Commands file**: `src-tauri/src/acp/sql_studio/commands/s3.rs`
- **Features**: list buckets, list objects, download/preview objects (1 MB preview limit), presigned URLs
- **Connection config**: per-connection `s3_region`, `s3_endpoint_url`, `s3_access_key_id`, `s3_secret_access_key`, `s3_session_token`, `s3_force_path_style` — stored in SQLite `sql_studio_connections` table
- **Compatible with**: AWS S3 and S3-compatible endpoints (Railway Buckets, MinIO, etc.)

## AWS S3 (Website)

- **Packages**: `@aws-sdk/client-s3 ^3.700.0`, `@aws-sdk/s3-request-presigner ^3.700.0`
- **Usage**: file upload/download for website assets
- **Credentials**: `RAILWAY_BUCKET_ACCESS_KEY`, `RAILWAY_BUCKET_SECRET_KEY` (Railway S3-compatible bucket)

---

## SQL Studio (Multi-Database)

The desktop SQL Studio feature connects to external databases. Supported engines (defined in `src-tauri/src/sql_studio/types.rs`):

| Engine | Type |
|---|---|
| PostgreSQL | SQL |
| MySQL | SQL |
| SQLite | SQL (local file) |
| S3 | Object storage browser |

Connection configs stored in local SQLite DB. sqlx 0.7 handles live query execution with features for `sqlite`, `postgres`, `mysql`, `json`, `chrono`.

---

## Voice Dictation — HuggingFace Model Downloads

- **Source**: `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/`
- **Models**: `ggml-tiny.en.bin`, `ggml-base.en.bin`, `ggml-small.en.bin`, `ggml-medium.en.bin`, `ggml-large-v3-turbo.bin` (and multilingual variants)
- **Verification**: SHA-256 checksum per model
- **Max download size**: 2 GB
- **Timeout**: 600 seconds
- **Storage**: `{app_data_dir}/voice-models/`
- **Runtime**: whisper-rs with Metal GPU acceleration on macOS

---

## Resend (Email — Website)

- **Package**: `resend ^4.0.0`
- **Usage**: sends confirmation emails for waitlist sign-up
- **Triggered by**: `WaitlistApplicationService` in `packages/website/src/lib/server/application/WaitlistApplicationService.ts`
- **Config**: `RESEND_API_KEY` env var

---

## Google OAuth (Website)

- **Flow**: standard OAuth 2.0 authorization code flow
- **Routes**: `packages/website/src/routes/auth/google/+server.ts` (redirect), `packages/website/src/routes/auth/callback/+server.ts` (callback)
- **Scopes**: `openid email profile`
- **Config**: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` env vars
- **CSRF protection**: `oauth_state` cookie (10-minute TTL, httpOnly)

---

## MCP (Model Context Protocol)

- **Plugin**: `tauri-plugin-mcp-bridge 0.9` (Rust)
- **Internal bridge**: Axum SSE server (`src-tauri/src/acp/event_bridge_server.rs`) exposes `GET /acp/events` for MCP clients to consume ACP events
- **Frontend `.mcp.json`**: `packages/desktop/.mcp.json` — MCP server config for development tooling

---

## Railway (Website Hosting)

- **Config**: `/Users/example/Documents/acepe/railway.json`
- **Builder**: Nixpacks
- **Build**: `bun install --frozen-lockfile && NODE_OPTIONS=--max-old-space-size=6144 bun run --cwd packages/website build`
- **Start**: `cd packages/website && node build`
- **Health check**: `GET /health`, timeout 100s
- **Storage**: Railway S3-compatible bucket (credentials via `RAILWAY_BUCKET_ACCESS_KEY`, `RAILWAY_BUCKET_SECRET_KEY`)

---

## Apple Platform Services (macOS)

- **Code signing**: Apple Developer ID Application (`APPLE_SIGNING_IDENTITY`, `APPLE_CERTIFICATE`)
- **Notarization**: Apple Notary Service (`APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`)
- **Hardened Runtime**: enabled in bundle config
- **Minimum macOS version**: 10.15 (Catalina)
- **Private API**: `macOSPrivateApi: true` in `tauri.conf.json` (enables vibrancy/blur effects)
- **Traffic light position**: custom (`x: 16, y: 24`)

---

## Tauri Plugins Summary

| Plugin | Version | Purpose |
|---|---|---|
| `tauri-plugin-opener` | `2` | Open URLs/files in system apps |
| `tauri-plugin-locale` | `2` | System locale detection |
| `tauri-plugin-pty` | `0.2` | Pseudo-terminal support |
| `tauri-plugin-updater` | `=2.5.1` | Auto-update from GitHub Releases |
| `tauri-plugin-process` | `2` | App restart/exit control |
| `tauri-plugin-mcp-bridge` | `0.9` | MCP bridge for AI tool integrations |
