# Acepe — Directory Structure

## Repository Root

```
/Users/example/Documents/acepe/
├── packages/
│   ├── acps/          # ACP agent binary packages
│   ├── analytics/     # Shared analytics package
│   ├── api/           # Shared API package
│   ├── changelog/     # Changelog tooling
│   ├── desktop/       # Main Tauri desktop application (primary package)
│   ├── ui/            # Shared Svelte UI component library (@acepe/ui)
│   └── website/       # Marketing website
├── docs/              # Project documentation and agent guides
├── infra/             # Infrastructure configuration
├── assets/            # Shared assets
├── todos/             # Project todos
├── .github/           # CI/CD workflows
├── .planning/         # Planning documents
├── .husky/            # Git hooks (pre-push: typecheck + tests)
├── AGENTS.md          # Agent coding instructions
├── CLAUDE.md          # Points to AGENTS.md
└── package.json       # Root workspace config (bun workspaces)
```

---

## Primary Package: `packages/desktop/`

### Frontend (`src/`)

```
src/
├── routes/
│   ├── +layout.svelte          # Root layout: locale, analytics, highlighter init
│   ├── +layout.ts
│   ├── +page.svelte            # Root page: renders <MainAppView />
│   ├── auth/
│   ├── sidebar-11/
│   ├── skills/
│   └── test-agent-panel/       # Dev test route
├── app.html                    # HTML shell
└── app.css                     # Global styles
```

```
src/lib/
├── acp/                        # Core ACP feature module (see below)
├── components/                 # Top-level app components
│   ├── main-app-view.svelte    # Root component: boots all stores, renders workspace
│   ├── error-boundary.svelte
│   ├── app-sidebar.svelte
│   ├── main-app-view/          # Sub-components of main view
│   │   ├── components/content/ # PanelsContainer, EmptyStates
│   │   ├── components/overlays/# AppOverlays
│   │   └── components/sidebar/ # AppSidebar
│   ├── settings/
│   ├── settings-page/
│   ├── sidebar/
│   ├── top-bar/
│   ├── changelog-modal/
│   ├── review-fullscreen/
│   ├── sql-studio/
│   ├── update-modal/
│   ├── user-reports/
│   ├── theme/                  # ThemeProvider
│   └── ui/                     # shadcn-svelte primitives
├── hooks/
│   └── is-mobile.svelte.ts
├── i18n/                       # Paraglide i18n store
├── keybindings/                # Keybinding constants and service
├── notifications/              # Notification service and components
├── opencode/                   # OpenCode-specific frontend logic
├── paraglide/                  # Generated i18n messages
├── services/                   # Pure TS data types and converters
│   ├── claude-history-types.ts
│   ├── claude-history.ts
│   ├── converted-session-types.ts
│   ├── command-names.ts
│   ├── settings.svelte.ts
│   ├── acp-types.ts
│   └── thread-list-settings.ts
├── skills/
├── sql-studio/
├── stores/                     # Global (non-context) stores
│   ├── notification-preferences-store.svelte.ts
│   ├── voice-settings-store.svelte.ts
│   └── window-focus-store.svelte.ts
├── types/
├── utils/
│   ├── tauri-client.ts         # Re-exports tauriClient
│   ├── tauri-client/           # Domain sub-clients
│   │   ├── index.ts            # Assembles tauriClient object
│   │   ├── invoke.ts           # invokeAsync() base wrapper
│   │   ├── acp.ts
│   │   ├── git.ts
│   │   ├── history.ts
│   │   ├── projects.ts
│   │   ├── settings.ts
│   │   ├── skills.ts
│   │   ├── terminal.ts
│   │   ├── voice.ts
│   │   └── ... (14 domain files total)
│   ├── tauri-commands.ts
│   └── window-activation.ts
├── analytics.ts
└── utils.ts                    # cn(), Svelte prop type helpers
```

### ACP Feature Module (`src/lib/acp/`)

```
acp/
├── actions/
├── application/
│   └── dto/                    # mode.ts, model.ts
├── components/                 # Feature UI components
│   ├── agent-panel/            # Main agent chat panel (logic/, components/, hooks/, state/)
│   ├── messages/               # Message rendering
│   │   ├── block-types/
│   │   └── acp-block-types/
│   ├── agent-input/            # Prompt input, attachments
│   ├── file-panel/
│   ├── git-panel/
│   ├── terminal-panel/
│   ├── browser-panel/
│   ├── review-panel/
│   ├── session-list/
│   ├── welcome-screen/
│   ├── tab-bar/
│   ├── tool-calls/
│   ├── checkpoint/
│   ├── diff-viewer/            # GitHub diff viewer modal
│   ├── plan-sidebar/
│   ├── model-selector.*        # Model picker components
│   ├── worktree-toggle/
│   └── ... (29 component dirs total)
├── constants/                  # Logger IDs, mode mappings
├── converters/                 # Data conversion (stored entry -> session entry)
├── domain/
├── errors/                     # AppError hierarchy, AcpError types
├── hooks/
│   ├── use-acp-client.svelte.ts
│   ├── use-advanced-command-palette.svelte.ts
│   ├── use-plan-inline.svelte.ts
│   ├── use-plan-skills.svelte.ts
│   ├── use-project-threads.svelte.ts
│   └── use-session-context.ts
├── infrastructure/
│   └── storage/
├── logic/                      # Pure TS business logic classes
│   ├── acp-client.ts           # ACP protocol client (wraps tauriClient.acp)
│   ├── acp-event-bridge.ts     # EventSource connection to SSE bridge
│   ├── event-subscriber.ts     # Fan-out SSE listener manager
│   ├── session-machine.ts      # XState parallel state machine
│   ├── session-ui-state.ts     # Derives UI state from machine snapshot
│   ├── connection-manager.ts
│   ├── project-manager.svelte.ts
│   ├── project-client.ts
│   ├── update-router.ts        # Routes session updates to handlers
│   ├── message-processor.ts
│   ├── inbound-request-handler.ts
│   ├── panel-connection-machine.ts
│   ├── selector-registry.svelte.ts
│   └── command-palette/
├── registry/
├── review/
├── schemas/
├── services/
│   └── highlighter-pool.svelte.ts
├── state/
├── store/                      # Svelte 5 reactive stores (context pattern)
│   ├── session-store.svelte.ts           # Master session store
│   ├── panel-store.svelte.ts             # Panel layout store
│   ├── workspace-store.svelte.ts         # Workspace persistence
│   ├── session-event-service.svelte.ts   # SSE event routing
│   ├── session-connection-service.svelte.ts  # XState actor management
│   ├── agent-store.svelte.ts
│   ├── agent-preferences-store.svelte.ts
│   ├── agent-model-preferences-store.svelte.ts
│   ├── connection-store.svelte.ts
│   ├── permission-store.svelte.ts
│   ├── question-store.svelte.ts
│   ├── plan-store.svelte.ts
│   ├── checkpoint-store.svelte.ts
│   ├── urgency-tabs-store.svelte.ts
│   ├── session-entry-store.svelte.ts
│   ├── session-hot-state-store.svelte.ts
│   ├── session-capabilities-store.svelte.ts
│   ├── tab-bar-store.svelte.ts
│   ├── unseen-store.svelte.ts
│   ├── session-state.ts                  # State model and factory functions
│   ├── types.ts                          # Panel/Session type definitions
│   ├── api.ts
│   ├── services/                         # Store service extractions
│   │   ├── session-repository.ts
│   │   ├── session-connection-manager.ts
│   │   ├── session-messaging-service.ts
│   │   ├── tool-call-manager.svelte.ts
│   │   ├── chunk-aggregator.ts
│   │   └── interfaces/
│   ├── message-queue/
│   └── queue/
├── types/                      # ACP protocol TypeScript types
└── utils/                      # ACP-specific utilities
    ├── logger.ts
    ├── markdown-renderer.ts
    ├── chunked-processor.ts
    ├── file-utils.ts
    ├── diff-patch-parser.ts
    ├── plan-parser.ts
    ├── tool-state-utils.ts
    └── ... (35 utility files total)
```

### Rust Backend (`src-tauri/src/`)

```
src-tauri/src/
├── lib.rs                      # App entry: setup(), invoke_handler![], all managed state
├── main.rs                     # Binary entry: calls lib::run()
├── analytics.rs
├── browser_webview.rs          # Native child webview management
├── macos_fps.rs                # 120fps ProMotion WebView fix (macOS only)
├── macos_resource_limits.rs    # File descriptor limit raising (macOS only)
├── path_safety.rs              # Project path validation (blocks home/root)
├── project_access.rs           # macOS TCC permission pre-warming
├── shell_env.rs                # Login shell environment capture
│
├── acp/                        # Agent Client Protocol core
│   ├── provider.rs             # AgentProvider trait + SpawnConfig
│   ├── client_trait.rs         # AgentClient async trait
│   ├── client_loop.rs          # Subprocess JSON-RPC read/write loop
│   ├── client_session.rs       # Session lifecycle (spawn, init, send)
│   ├── client_rpc.rs
│   ├── client_transport.rs
│   ├── client_factory.rs       # Client construction by agent type
│   ├── registry.rs             # AgentRegistry (built-in + custom)
│   ├── session_registry.rs     # Per-session client DashMap
│   ├── active_agent.rs         # Active agent preference state
│   ├── event_hub.rs            # Broadcast channel for UI events
│   ├── event_bridge_server.rs  # Axum SSE server (/acp/events)
│   ├── ui_event_dispatcher.rs  # Converts SessionUpdates to AcpUiEvents
│   ├── streaming_delta_batcher.rs
│   ├── streaming_accumulator.rs
│   ├── streaming_log.rs
│   ├── task_reconciler.rs      # Parent/child tool call assembly
│   ├── non_streaming_batcher.rs
│   ├── permission_tracker.rs
│   ├── agent_installer.rs      # Binary download/cache management
│   ├── agent_context.rs
│   ├── session_update_parser.rs
│   ├── cursor_extensions.rs    # Cursor-specific protocol extensions
│   ├── partial_json.rs
│   ├── model_display.rs
│   ├── error.rs                # AcpError enum
│   ├── github_commands.rs      # GitHub API commands (diff, PR)
│   ├── github_issues.rs        # GitHub Issues API commands
│   ├── types.rs                # CanonicalAgentId, PromptRequest
│   ├── commands/               # Tauri command handlers
│   │   ├── session_commands.rs     # acp_new_session, acp_resume_session, etc.
│   │   ├── interaction_commands.rs # acp_send_prompt, acp_cancel, etc.
│   │   ├── inbound_commands.rs     # acp_reply_permission, acp_respond_inbound_request
│   │   ├── install_commands.rs
│   │   ├── registry_commands.rs
│   │   ├── client_ops.rs
│   │   ├── file_commands.rs
│   │   ├── path_validation.rs
│   │   └── tests.rs
│   ├── inbound_request_router/
│   ├── opencode/               # OpenCode HTTP client implementation
│   ├── parsers/
│   ├── providers/              # AgentProvider implementations
│   │   ├── claude_code.rs
│   │   ├── cursor.rs
│   │   ├── codex.rs
│   │   ├── opencode.rs
│   │   └── custom.rs
│   ├── client/
│   ├── client_updates/
│   └── session_update/
│
├── db/
│   ├── mod.rs                  # init_db(), get_db_path()
│   ├── repository.rs           # All SeaORM repositories (~55KB)
│   ├── repository_test.rs
│   ├── entities/               # SeaORM entity definitions
│   └── migrations/
│
├── history/                    # Session history indexing
│   ├── indexer.rs              # IndexerActor (full/incremental scan)
│   └── commands/               # scan_project_sessions, get_unified_session, etc.
│
├── session_jsonl/              # JSONL session file parsing
│   └── commands/
│
├── session_converter/
│
├── storage/
│   ├── mod.rs
│   ├── types.rs
│   └── commands/               # projects.rs, settings.rs, session_files.rs, etc.
│
├── file_index/                 # Project file tree and git status
│
├── git/
│   ├── commands.rs             # git_clone, git_collect_ship_context
│   ├── worktree.rs
│   ├── worktree_config.rs
│   ├── watcher.rs              # GitHeadWatcher
│   ├── gh_pr.rs
│   └── operations.rs           # git_stage, git_commit, git_push, etc.
│
├── checkpoint/
│   └── commands/
├── cursor_history/
├── codex_history/
├── opencode_history/
├── pty/
│   └── commands/
├── terminal/
│   └── commands/
├── skills/
│   └── commands/
├── sql_studio/
│   └── commands/
├── voice/
├── bin/
└── bindings/                   # TypeScript type bindings (specta)
```

---

## Supporting Packages

### `packages/acps/claude/`
Claude ACP agent binary package. Contains the compiled `claude-agent-acp` binary, build scripts (`build.mjs`), patches for `@zed-industries/claude-agent-acp`, and a `static-entry.ts` that routes `--cli` vs ACP agent modes. Built with `bun --compile`.

### `packages/ui/`
Shared Svelte component library (`@acepe/ui`). Reusable UI primitives used across the desktop app. Uses shadcn-svelte conventions. Entry: `src/index.ts`.

### `packages/analytics/`
Shared analytics helpers (`src/index.ts`).

### `packages/api/`
Shared API types/helpers.

---

## Key Configuration Files

| File | Purpose |
|------|---------|
| `packages/desktop/src-tauri/tauri.conf.json` | Tauri app config (bundle ID, window, resources) |
| `packages/desktop/src-tauri/Cargo.toml` | Rust dependencies |
| `packages/desktop/package.json` | Frontend dependencies, build scripts |
| `packages/desktop/biome.json` | Linter/formatter config (Biome, replaces ESLint + Prettier) |
| `packages/desktop/vite.config.ts` | Vite + SvelteKit config |
| `packages/desktop/svelte.config.js` | SvelteKit adapter config |
| `.husky/pre-push` | Pre-push hook: typecheck + tests (no lint step) |
| `.github/workflows/` | CI: release pipeline, PR checks |

---

## Naming Conventions

| Convention | Example |
|-----------|---------|
| Svelte stores with runes | `foo-store.svelte.ts` |
| Svelte hooks | `use-foo.svelte.ts` |
| Svelte components | `kebab-case.svelte` |
| Rust Tauri commands | `snake_case` matching TS `camelCase` domain method names |
| Store context symbol | `const FOO_STORE_KEY = Symbol("foo-store")` |
| Store factory / accessor | `createFooStore()` / `getFooStore()` |
| TS unit tests | `*.test.ts` (bun test) or `*.vitest.ts` (Vitest) |
| Rust unit tests | `mod repository_test` in same crate, or inline `#[cfg(test)]` |

---

## Test Locations

| Scope | Location |
|-------|----------|
| Frontend unit tests | `src/lib/acp/**/__tests__/`, `*.test.ts` and `*.vitest.ts` files co-located with source |
| Rust unit tests | `src-tauri/src/acp/commands/tests.rs`, inline `#[cfg(test)]` modules |
| Rust integration tests | `src-tauri/src/db/repository_test.rs` |
| E2E (Playwright) | `.playwright-mcp/` |

Test runner: `bun test` for TypeScript (~1482 tests across 113 files, ~7.5s). `cargo test` for Rust. Pre-push hook runs `bun run check` (TypeScript typecheck) + `bun test`.
