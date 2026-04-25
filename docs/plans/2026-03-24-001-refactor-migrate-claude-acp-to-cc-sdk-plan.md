---
title: Migrate Claude Code ACP Layer to cc-sdk
type: refactor
status: active
date: 2026-03-24
deepened: 2026-03-24
---

# Migrate Claude Code ACP Layer to cc-sdk

## Enhancement Summary

**Deepened on:** 2026-03-24
**Research agents used:** Architecture Strategist, Security Sentinel, Performance Oracle, Code Simplicity Reviewer, Pattern Recognition Specialist, Codebase Explorer (x2)

### Key Improvements
1. **Architecture correction**: Separated Provider (config) from Client (runtime) — plan now defines `CcSdkClaudeClient` implementing `AgentClient` with a `CommunicationMode::CcSdk` factory variant, matching existing codebase patterns
2. **Event pipeline preservation**: Streaming bridge now feeds through `AcpUiEventDispatcher` → `StreamingDeltaBatcher` → `TaskReconciler`, not directly to event hub — prevents breaking text coalescing and tool call graphs
3. **Simplified permission handler**: Replaced DashMap with `tokio::sync::Mutex<HashMap>` + oneshot (matches existing `pending_requests` pattern in `client_rpc.rs`)
4. **Phase consolidation**: Collapsed 6 phases into 3 (Implement behind flag → Validate → Remove old path)
5. **Security hardening**: Added timeout + nonce for permission oneshots, scoped file attachment reads, consolidated TCC blocking

### New Risks Discovered
- **CRITICAL**: `acp_write_text_file` lacks path canonicalization (path traversal risk, pre-existing)
- **HIGH**: Permission oneshot has no timeout — can block forever if frontend crashes
- **HIGH**: Streaming bridge must go through `AcpUiEventDispatcher`, not directly to event hub — otherwise breaks `StreamingDeltaBatcher` and `TaskReconciler`
- **HIGH**: Plan conflated Provider (config) and Client (runtime) roles — must define separate `CcSdkClaudeClient`
- **HIGH**: Plan missed `CommunicationMode` enum and `client_factory.rs` — the central dispatch point
- **MEDIUM**: Attachment token expansion should stay in frontend TypeScript, not move to Rust

---

## Overview

Replace the multi-layer ACP indirection for the Claude Code agent with the `cc-sdk` Rust crate, eliminating the Bun subprocess and Zed ACP adapter entirely. Other agents (Cursor, OpenCode, Codex) remain on ACP unchanged.

**Current:**
```
Tauri Rust (JSON-RPC) → Bun subprocess (Zed ACP + Acepe adapter) → @anthropic-ai/claude-agent-sdk → claude CLI
```

**After:**
```
Tauri Rust (cc-sdk ClaudeSDKClient) → claude CLI
```

## Problem Statement

The current Claude Code integration has 3 layers of translation:
1. ACP JSON-RPC protocol (Rust ↔ Bun)
2. Zed's ACP adapter (`@zed-industries/claude-agent-acp`)
3. JS Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)

Each layer adds latency, maintenance surface, and failure modes. The Bun subprocess has historically caused silent hangs on macOS (bugs #15893, #18239). The Zed dependency is a third-party wrapper with no guarantee of compatibility as Claude CLI evolves.

## Proposed Solution

Use `cc-sdk = "0.7.0"` (MIT licensed, actively maintained, Python SDK v0.1.33 parity) as a direct Rust client for the Claude CLI. Implement a `CcSdkClaudeClient` that wraps `ClaudeSDKClient` and implements the existing `AgentClient` trait, so the session registry, event hub, and Tauri commands remain unchanged. A thin `CcSdkClaudeProvider` implements `AgentProvider` for configuration metadata only.

### Research Insights

**cc-sdk API surface (v0.7.0):**
- `ClaudeSDKClient` — interactive bidirectional client with `connect()`, `send_message()`, `interrupt()`, `set_model()`, `set_permission_mode()`, `disconnect()`
- `ClaudeCodeOptions` — builder pattern with `model`, `cwd`, `permission_mode`, `allowed_tools`, `disallowed_tools`, `resume`, `fork_session`, `mcp_servers`, `system_prompt_v2`, `max_turns`, `env`, `max_budget_usd`
- `CanUseTool` trait — async callback returning `PermissionResult { allow, input?, reason? }`
- `Message` enum — `Result`, `System` (tool_use, tool_result, notifications), `Assistant` (text, thinking)
- `SdkError` — transport failures, serialization, tool execution, permission denial, timeout, control protocol
- `PermissionMode` — `Allow`, `Ask`, `Deny`
- Auto CLI download via `cli_download` module (should be disabled in favor of Acepe's installer)

**Single-maintainer risk mitigation:** The cc-sdk wraps a simple NDJSON-over-stdio protocol. If abandoned, the transport layer is ~500 lines of Rust — trivially forkable or reimplementable.

**References:**
- [cc-sdk docs.rs](https://docs.rs/cc-sdk/latest/cc_sdk/)
- [cc-sdk GitHub](https://github.com/ZhangHanDong/claude-code-api-rs)
- [cc-sdk crates.io](https://crates.io/crates/cc-sdk)

## Technical Approach

### Architecture After Migration

```
packages/desktop/src-tauri/src/acp/
  providers/
    claude_code.rs        ← CcSdkClaudeProvider (AgentProvider: config/metadata only)
  client/
    cc_sdk_client.rs      ← NEW: CcSdkClaudeClient (AgentClient: runtime)
    mod.rs                ← adds CcSdk variant
    client_rpc.rs         ← kept for non-Claude agents (ACP JSON-RPC)
    client_transport.rs   ← kept for non-Claude agents
  parsers/
    cc_sdk_bridge.rs      ← NEW: cc-sdk Message → SessionUpdate translation
  client_factory.rs       ← adds CommunicationMode::CcSdk arm
```

`packages/acps/claude/` — **deleted entirely** once migration is validated.

### Research Insights: Architecture

**Provider vs Client separation (Pattern Recognition):**
The existing codebase strictly separates:
- **Provider** (stateless config, `AgentProvider` trait): "What command do I run? What icon? What modes?" — unit struct, no runtime state
- **Client** (stateful runtime, `AgentClient` trait): "Start subprocess, send RPC, track permissions" — created by `client_factory.rs`

The original plan conflated these roles by putting runtime concerns (CanUseTool, ClaudeCodeOptions construction) in the provider. The corrected architecture:

1. `CcSdkClaudeProvider` — implements `AgentProvider` for metadata (id, name, icon, mode mappings, `uses_task_reconciler() -> true`). Returns `CommunicationMode::CcSdk` from `communication_mode()`. Subprocess-specific methods (`spawn_config()`, `spawn_configs()`) return no-ops since they won't be called.

2. `CcSdkClaudeClient` — implements `AgentClient` for runtime (connect, send, receive, permissions). Created by `client_factory.rs` when it sees `CommunicationMode::CcSdk`.

**Key file: `client_factory.rs`** — This is the central dispatch point. Currently has two arms (`Subprocess` → `AcpClient`, `Http` → `OpenCodeHttpClient`). Adding a third arm (`CcSdk` → `CcSdkClaudeClient`) slots cleanly into the existing pattern.

**Event pipeline (Architecture Review):**
The current 600+ line `client_loop.rs` contains critical middleware that processes raw subprocess output before it reaches the frontend:
- `StreamingDeltaBatcher` — coalesces rapid text deltas into 16ms batches
- `NonStreamingEventBatcher` — batches non-streaming events with 8ms timer
- `TaskReconciler` — assembles tool call graphs (`uses_task_reconciler() -> true` for Claude Code)
- `PermissionTracker` — tracks permission request/response lifecycle
- `message_id_tracker` / `assistant_text_tracker` — session-level state

**Critical finding:** The streaming bridge MUST feed through `AcpUiEventDispatcher`, not directly to `AcpEventHubState`. Direct publishing would break text coalescing, tool call graph assembly, priority classification, and the token-bucket rate limiter (300 events/sec, burst 30).

**Recommended preparatory refactor:** Extract the middleware pipeline from `client_loop.rs` into a standalone `SessionUpdatePipeline` struct that both the ACP stdout reader and the cc-sdk stream bridge can share. This prevents behavioral divergence.

**Content block placement:** Following codebase convention, the cc-sdk → SessionUpdate translation belongs in `parsers/cc_sdk_bridge.rs` (analogous to `parsers/claude_code_parser.rs`), not in `providers/`.

---

### Phase 1: Implement (behind feature flag)

Add `cc-sdk` dependency, implement `CcSdkClaudeClient` + `CcSdkClaudeProvider`, and wire everything up behind an env var toggle (`ACEPE_USE_CC_SDK=1`).

#### 1a. Add cc-sdk Dependency

Add to `packages/desktop/src-tauri/Cargo.toml`:
```toml
cc-sdk = { version = "0.7.0", features = ["default"] }
```

Audit `ClaudeCodeOptions` fields needed for Acepe's use cases:
- `cwd`, `model`, `permission_mode`, `allowed_tools`, `disallowed_tools`
- `continue_conversation`, `resume`, `fork_session`
- `mcp_servers`, `system_prompt_v2`, `max_turns`
- `env` (for per-agent env overrides)
- `auto_download_cli: false` (use Acepe's installer, not cc-sdk's)

#### Research Insights: Dependency

**Compatibility:** The existing Cargo.toml already uses tokio v1, serde v1, futures v0.3, tokio-util v0.7 — all compatible with cc-sdk's requirements. No version conflicts expected.

**`auto_download_cli` must be disabled:** cc-sdk has built-in Claude CLI auto-download. This conflicts with Acepe's own `agent_installer` module. Disable via `ClaudeCodeOptions::builder().auto_download_cli(false)`.

#### 1b. Add CommunicationMode::CcSdk

In `provider.rs`:
```rust
pub enum CommunicationMode {
    Subprocess,
    Http,
    CcSdk,  // NEW
}
```

In `client_factory.rs`, add the third dispatch arm:
```rust
match provider.communication_mode() {
    CommunicationMode::Subprocess => Box::new(AcpClient::new_with_provider(...)),
    CommunicationMode::Http => Box::new(OpenCodeHttpClient::new(...)),
    CommunicationMode::CcSdk => Box::new(CcSdkClaudeClient::new(...)),
}
```

#### 1c. Implement CcSdkClaudeProvider

Thin provider struct implementing `AgentProvider` for metadata only:
```rust
pub struct CcSdkClaudeProvider;

impl AgentProvider for CcSdkClaudeProvider {
    fn id(&self) -> &str { "claude-code" }
    fn name(&self) -> &str { "Claude Code" }
    fn icon(&self) -> &str { "claude" }
    fn communication_mode(&self) -> CommunicationMode { CommunicationMode::CcSdk }
    fn parser_agent_type(&self) -> AgentType { AgentType::ClaudeCode }
    fn uses_task_reconciler(&self) -> bool { true }
    // spawn_config/spawn_configs: return empty/no-op (not used for CcSdk mode)
    // ...other metadata methods unchanged from current ClaudeCodeProvider
}
```

#### 1d. Implement CcSdkClaudeClient

New file: `client/cc_sdk_client.rs`

Implements `AgentClient` trait wrapping `ClaudeSDKClient`:

```rust
pub struct CcSdkClaudeClient {
    sdk_client: Option<ClaudeSDKClient>,
    options_template: ClaudeCodeOptions,
    permission_bridge: Arc<PermissionBridge>,
    cancellation_token: CancellationToken,
    dispatcher: AcpUiEventDispatcher,
    session_id: Option<String>,
}
```

**AgentClient trait method mapping:**

| AgentClient method | CcSdkClaudeClient implementation |
|---|---|
| `start()` | Validate CLI exists (check PATH), no-op otherwise. cc-sdk handles process spawn in `connect()` |
| `initialize()` | No-op — cc-sdk handles initialization in `connect()` |
| `new_session(cwd)` | Build `ClaudeCodeOptions` with cwd, call `ClaudeSDKClient::connect(None)`, spawn streaming bridge task |
| `resume_session(id, cwd)` | Build options with `resume: Some(id)`, call `connect()` |
| `fork_session(id, cwd)` | Build options with `resume: Some(id)` + `fork_session: true` |
| `send_prompt_fire_and_forget(req)` | Call `sdk_client.send_message(prompt)` in spawned task |
| `cancel(session_id)` | Call `sdk_client.interrupt()` |
| `stop()` | Cancel `cancellation_token`, drop `sdk_client`. Must be sync — trigger cancellation, let async tasks clean up on their own |
| `respond(request_id, result)` | Route to `permission_bridge.resolve()` (resolves oneshot) |
| `set_session_model(id, model)` | Call `sdk_client.set_model(Some(model))` |
| `set_session_mode(id, mode)` | Call `sdk_client.set_permission_mode(mode)` |

#### Research Insights: Session Lifecycle

**Lifecycle mismatch (Architecture Review):** cc-sdk's `connect()` conflates `start()` + `initialize()` + `new_session()` into one call. The correct approach:
- `start()` — validate CLI binary exists, no-op otherwise
- `initialize()` — no-op (cc-sdk handles protocol handshake internally)
- `new_session(cwd)` — this is where `connect()` actually runs
- `stop()` — must be sync for Drop compatibility. Store a `CancellationToken`, trigger it in `stop()`. The async streaming bridge task watches the token and cleans up.

**`stop()` sync requirement (Pattern Recognition):** The `SessionRegistry::remove()` calls `client.stop()` from a sync context (and `stop_all()` is called from Drop). With cc-sdk, `CancellationToken::cancel()` is sync — it signals the async bridge task to exit, which then drops the `ClaudeSDKClient` (killing the subprocess).

#### 1e. Implement Permission Bridge

```rust
struct PermissionBridge {
    pending: tokio::sync::Mutex<HashMap<String, oneshot::Sender<PermissionResponse>>>,
}

impl PermissionBridge {
    async fn request(&self, id: String) -> oneshot::Receiver<PermissionResponse> {
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id, tx);
        rx  // caller awaits WITHOUT holding lock
    }

    async fn resolve(&self, id: &str, response: PermissionResponse) {
        if let Some(tx) = self.pending.lock().await.remove(id) {
            let _ = tx.send(response);
        }
    }

    async fn drain_all_as_denied(&self) {
        let mut pending = self.pending.lock().await;
        for (_, tx) in pending.drain() {
            let _ = tx.send(PermissionResponse::Deny);
        }
    }
}
```

### Research Insights: Permission Handler

**Simplicity (Code Simplicity Review):** DashMap is unnecessary — permission requests are sequential within a session (1-3 concurrent at most). `tokio::sync::Mutex<HashMap>` matches the existing `pending_requests` pattern in `client_rpc.rs:194` and avoids a new dependency.

**Timeout requirement (Security Review, CRITICAL-2):** The oneshot receiver MUST have a timeout. If the frontend never responds (crash, navigation, tab close), the handler blocks forever:
```rust
match tokio::time::timeout(Duration::from_secs(60), rx).await {
    Ok(Ok(response)) => response,
    _ => PermissionResponse::Deny,  // timeout or channel closed = deny
}
```

**Nonce for stale request protection (Security Review):** Include a monotonic nonce in the permission request that the frontend must echo back, preventing stale approvals after reconnection.

**Permission response routing (Architecture Review):** The `acp_respond_inbound_request` Tauri command currently writes JSON-RPC to subprocess stdin. For cc-sdk sessions, it must resolve the oneshot instead. Clean approach: make this routing part of `AgentClient::respond()` — the AcpClient implementation writes to stdin, the CcSdkClaudeClient implementation resolves the oneshot. The Tauri command layer stays unchanged.

**`CanUseTool` implementation:**
```rust
struct AcepePermissionHandler {
    session_id: String,
    bridge: Arc<PermissionBridge>,
    dispatcher: AcpUiEventDispatcher,
}

#[async_trait]
impl CanUseTool for AcepePermissionHandler {
    async fn can_use_tool(&self, tool_name: &str, input: &Value, ctx: &ToolPermissionContext) -> PermissionResult {
        // 1. Check TCC blocking first (consolidated, see security section)
        if is_tcc_sensitive(tool_name) && !tcc_allowed() {
            return PermissionResult::deny("TCC automation tools blocked");
        }

        // 2. Generate request ID with monotonic nonce
        let request_id = generate_request_id();

        // 3. Emit synthetic ToolCall event via dispatcher
        self.dispatcher.enqueue(AcpUiEvent::session_update(
            SessionUpdate::ToolCall { tool_call, session_id: Some(self.session_id.clone()) }
        ));

        // 4. Emit permission request event to frontend
        self.dispatcher.enqueue(AcpUiEvent::inbound_request(permission_request_json));

        // 5. Wait on oneshot with timeout
        let rx = self.bridge.request(request_id).await;
        match tokio::time::timeout(Duration::from_secs(60), rx).await {
            Ok(Ok(response)) => response.into(),
            _ => {
                // Emit synthetic ToolCallUpdate(failed) on timeout
                PermissionResult::deny("Permission request timed out")
            }
        }
    }
}
```

#### 1f. Implement Streaming Bridge

```rust
// Spawned per-session in new_session()
tokio::spawn(async move {
    let token = cancellation_token.clone();
    let mut stream = sdk_client.receive_messages_stream();

    loop {
        tokio::select! {
            biased;
            _ = token.cancelled() => break,
            event = stream.next() => {
                match event {
                    Some(Ok(msg)) => {
                        let updates = translate_cc_sdk_message(msg);  // parsers/cc_sdk_bridge.rs
                        for update in updates {
                            dispatcher.enqueue(AcpUiEvent::session_update(update));
                        }
                    }
                    Some(Err(e)) => {
                        dispatcher.enqueue(AcpUiEvent::session_update(
                            SessionUpdate::TurnError { error: e.to_string(), session_id: Some(sid.clone()) }
                        ));
                        break;
                    }
                    None => {
                        // Stream ended = session complete
                        dispatcher.enqueue(AcpUiEvent::session_update(
                            SessionUpdate::TurnComplete { session_id: Some(sid.clone()) }
                        ));
                        break;
                    }
                }
            }
        }
    }
    // Cleanup: drain pending permissions as denied
    permission_bridge.drain_all_as_denied().await;
});
```

### Research Insights: Streaming Bridge

**Use `biased` in select! (Performance Review):** The `biased;` directive ensures stream events are prioritized over cancellation checks, which is correct for throughput. Only check cancellation when the stream would otherwise block.

**Feed through `AcpUiEventDispatcher`, not event hub (Pattern Recognition, CRITICAL):** Direct `event_hub.publish()` bypasses:
- `StreamingDeltaBatcher` (16ms text delta coalescing)
- `NonStreamingEventBatcher` (8ms event coalescing)
- `TaskReconciler` (tool call graph assembly — Claude Code returns `uses_task_reconciler() -> true`)
- Priority classification and droppability tagging
- Token-bucket rate limiting (300 events/sec, burst 30, per-session backlog 500)
- `log_emitted_event` telemetry

Using `dispatcher.enqueue(AcpUiEvent::session_update(...))` preserves all of this automatically.

**Eliminate death monitor (Performance Review):** The current architecture has a separate `spawn_death_monitor` task polling subprocess exit every 200ms. With cc-sdk, the Stream's `None` (end-of-stream) IS the death signal. The death monitor is unnecessary and creates a race condition where cleanup can execute twice. Remove it entirely for the cc-sdk path.

**No additional buffering (Performance Review):** The existing two-tier batching (`StreamingDeltaBatcher` + `AcpUiEventDispatcher`) handles backpressure. Adding a third buffer increases latency without benefit, especially for High-priority events (permissions, questions).

**Use `tauri::async_runtime::spawn()` instead of `tokio::spawn()` (Tauri best practice):** In Tauri v2, `tokio::spawn` within window listeners can cause panics. Use `tauri::async_runtime::spawn()` which correctly schedules on Tauri's tokio runtime.

#### 1g. Content Block Translation

New file: `parsers/cc_sdk_bridge.rs`

```rust
/// Translates cc-sdk Message variants → SessionUpdate variants.
/// Placed in parsers/ following codebase convention (analogous to claude_code_parser.rs).
pub fn translate_cc_sdk_message(msg: Message) -> Vec<SessionUpdate> {
    match msg {
        Message::Assistant { message } => {
            // message.content contains Vec<ContentBlock>
            message.content.into_iter().map(|block| match block {
                ContentBlock::Text(t) => SessionUpdate::AgentMessageChunk {
                    chunk: ContentChunk::text(t.text),  // move, not clone
                    part_id: None,
                    message_id: None,
                    session_id: None,
                },
                ContentBlock::Thinking(t) => SessionUpdate::AgentThoughtChunk {
                    chunk: ContentChunk::text(t.thinking),  // move, not clone
                    part_id: None,
                    message_id: None,
                    session_id: None,
                },
                ContentBlock::ToolUse(tu) => SessionUpdate::ToolCall {
                    tool_call: ToolCall {
                        id: tu.id,
                        name: tu.name,
                        arguments: tu.input,
                    },
                    session_id: None,
                },
                ContentBlock::ToolResult(tr) => SessionUpdate::ToolCallUpdate {
                    update: ToolCallUpdate {
                        tool_call_id: tr.tool_use_id,
                        status: if tr.is_error.unwrap_or(false) {
                            Some(ToolCallStatus::Failed)
                        } else {
                            Some(ToolCallStatus::Succeeded)
                        },
                        output: tr.content.map(|c| c.to_string()),
                        ..Default::default()
                    },
                    session_id: None,
                },
            }).collect()
        }
        Message::System { subtype, data } => {
            // Map system subtypes to SessionUpdate variants
            // tool_use → ToolCall, tool_result → ToolCallUpdate, etc.
            translate_system_message(subtype, data)
        }
        Message::Result { result, .. } => {
            vec![SessionUpdate::TurnComplete { session_id: None }]
        }
        // RateLimit, Error, etc.
        _ => vec![],
    }
}
```

### Research Insights: Content Translation

**Zero-copy opportunities (Performance Review):** When cc-sdk emits `TextDelta { text: String }`, move the String directly into `ContentChunk::text(text)` rather than cloning. Audit every `.clone()` and `.to_string()` in the translation layer. For a single session producing 100 text deltas, this eliminates ~100 unnecessary allocations.

**Pre-serialize event payloads (Performance Review, medium priority):** Currently, `to_json_payload()` in `ui_event_dispatcher.rs` calls `serde_json::to_value(update)` which allocates a full JSON DOM, then the SSE bridge re-serializes it to a string. Consider changing `AcpEventEnvelope` to carry pre-serialized `Arc<str>` instead of `Value`. This eliminates double-serialization and makes broadcast clone O(1).

**Type mapping completeness:** cc-sdk uses Claude-native content blocks (`Text`, `Thinking`, `ToolUse`, `ToolResult`). Acepe's frontend expects ACP-spec blocks. The translation must cover edge cases:
- Tool results with images (base64 encoded in ToolResultContent)
- Multi-turn edits (sequential ToolUse → ToolResult pairs)
- Streaming text deltas (may arrive as partial Text blocks)

#### 1h. Migrate JS-Layer Features

| JS feature | Migration approach |
|---|---|
| **Attachment token expansion** (`@[text:BASE64]`, `@[file:path]`) | Keep in frontend TypeScript (see research insight below) |
| **TCC automation tool blocking** (`ACEPE_ALLOW_TCC_AUTOMATION_TOOLS`) | Implement in `AcepePermissionHandler::can_use_tool()` — consolidated single function |
| **acceptEdits auto-approval** for Edit/Write/MultiEdit | Pass `PermissionMode::AcceptEdits` via cc-sdk options directly |
| **AskUserQuestion handling** | Implement as `CanUseTool` interception — when tool is `AskUserQuestion`, emit question event, await response |
| **Permission result finalization** | Handle in `AcepePermissionHandler` |
| **Startup diagnostics** | Implement in `CcSdkClaudeClient::start()` using `SdkError::CliNotFound` |

### Research Insights: Attachment Token Expansion

**Keep in frontend TypeScript (Code Simplicity Review):** The attachment token system (`@[text:BASE64]`, `@[file:path]`) is a UI concern:
1. The frontend creates these tokens (it base64-encodes pasted content)
2. The frontend can expand them before sending the Tauri command
3. This keeps the encode/decode cycle in one language (TypeScript)
4. It avoids adding base64 decode + regex parsing to Rust for a purely UI concern

If the expansion MUST happen in Rust (e.g., for `@[file:path]` reads), scope file reads to the session's project directory and validate canonical paths (see Security section).

### Research Insights: TCC Blocking Consolidation

**Three separate implementations exist (Security Review, HIGH-2):**
1. Rust `helpers.rs` — matches bare tool names (`take_screenshot`, etc.)
2. JS `index.ts` — matches MCP-qualified names (`mcp__acepe-mcp__take_screenshot`)
3. MCP plugin `tools/mod.rs` — matches command constants

**Risk:** If cc-sdk presents tool names in a different format, one blocking layer misses it.

**Fix:** Consolidate into a single `is_tcc_sensitive(tool_name: &str) -> bool` function that strips all possible prefixes (using the existing `normalize_tool_name()` approach: `rsplit("__").next()`) and matches on the base name. Cache the `ACEPE_ALLOW_TCC_AUTOMATION_TOOLS` env var at startup, not per-request.

#### 1i. Feature Flag

Gate the cc-sdk path behind `ACEPE_USE_CC_SDK=1`:
```rust
// In agent registry or provider selection
fn get_claude_code_provider() -> Box<dyn AgentProvider> {
    if std::env::var("ACEPE_USE_CC_SDK").unwrap_or_default() == "1" {
        Box::new(CcSdkClaudeProvider)
    } else {
        Box::new(ClaudeCodeProvider)  // existing ACP path
    }
}
```

This enables A/B comparison, rollback, and gradual rollout.

---

### Phase 2: Validate

Both paths coexist. Test cc-sdk path for parity:

1. **Event sequence comparison:** Run identical prompts through both paths, capture `SessionUpdate` event sequences, diff them. Key areas: text streaming order, tool call graph structure, permission request format.
2. **Permission flow end-to-end:** Real tool calls (file edit, bash) → permission card appears → approve/deny → tool executes/fails
3. **Model/mode switching mid-session:** `acp_set_model` and `acp_set_mode` via cc-sdk control protocol
4. **Session resume/fork:** Verify conversation continuity
5. **Error scenarios:** CLI not found, subprocess crash, auth failure, rate limit
6. **TCC blocking:** Verify all tool name formats are blocked on macOS
7. **AskUserQuestion:** Verify question dialog surfaces correctly

---

### Phase 3: Remove Old Path

Once cc-sdk is validated:
1. Delete `packages/acps/claude/`
2. Remove `cli.js` from Tauri bundled resources (already done per memory, re-verify)
3. Remove `CLAUDE_CODE_ACP_PATH` env var handling (replaced by cc-sdk's path resolution)
4. Update CI/CD to remove Bun binary build step
5. Update `tauri.conf.json` resources list
6. Remove `ACEPE_USE_CC_SDK` feature flag — make cc-sdk the only path
7. Remove the old `ClaudeCodeProvider` (subprocess-based)

---

## System-Wide Impact

### Interaction Graph
- `acp_send_prompt` → `CcSdkClaudeClient::send_prompt_fire_and_forget` → `sdk_client.send_message()` → streaming bridge task → `AcpUiEventDispatcher` → `AcpEventHubState` → SSE bridge → frontend
- `acp_respond_inbound_request` → `CcSdkClaudeClient::respond()` → `permission_bridge.resolve()` → resolves oneshot → `CanUseTool` returns → cc-sdk continues
- `acp_set_model` → `CcSdkClaudeClient::set_session_model()` → `sdk_client.set_model()` (control protocol message to Claude CLI)

### Error Propagation
- cc-sdk's `SdkError` must map to Acepe's `AcpError`. Key cases:
  - `SdkError::CliNotFound` → `AcpError::SubprocessSpawnFailed` + user-facing install prompt
  - `SdkError::ProcessExited` → session cleanup + frontend notification
  - `SdkError::Timeout` → `AcpError::Timeout` (surface as cancellable operation timeout)
  - `SdkError::AuthenticationFailed` → `AcpError::ProtocolError` (consistent with Cursor's auth error pattern)
  - `SdkError::PermissionDenied` → handled internally by CanUseTool, not surfaced as AcpError

### Research Insights: Error Mapping

**Pattern consistency (Pattern Recognition):** The existing codebase uses `AcpError::ProtocolError` for auth failures (Cursor provider, line 131 of `cursor.rs`). No need for a new auth-specific variant — use `ProtocolError` for consistency.

**Error message sanitization (Security Review, MEDIUM-3):** Error messages currently include full filesystem paths and subprocess commands. For the user-facing `SerializableAcpError`, use generic messages. Log detailed errors server-side only.

### State Lifecycle Risks
- **Session cleanup**: When `CcSdkClaudeClient` is stopped or `ClaudeSDKClient` drops, the streaming tokio task must terminate cleanly. `CancellationToken` signals task shutdown on `acp_close_session`. The stream task owns cleanup (drain permissions, flush batchers). No separate death monitor.
- **Permission handler leak**: `PermissionBridge` holds pending oneshots. If session closes mid-permission, `drain_all_as_denied()` is called from the stream task's cleanup path. Additionally, each `can_use_tool` call has a 60-second timeout.
- **Dual registration**: During Phase 2, both the old ACP path and cc-sdk path coexist but are mutually exclusive per-session. The feature flag selects the provider at registration time — a session uses one path or the other, never both.

### Research Insights: CancellationToken Hierarchy

**Structured cleanup (Performance Review):**
```
session_token (parent, stored in CcSdkClaudeClient)
  |-- stream_reader_token (child, held by streaming bridge task)
  |-- permission_bridge_token (child, for permission timeout cancellation)
```

Cancelling `session_token` propagates to all children. The stream consumer task exits its `select!` loop, flushes batchers synchronously, drains permissions as denied, then drops. No death monitor needed — the Stream's `None` IS the death signal.

**`stop()` sync safety:** `CancellationToken::cancel()` is sync. It signals the async bridge task to exit. The task drops `ClaudeSDKClient`, which kills the Claude CLI subprocess. This is safe from `SessionRegistry::stop_all()` and Drop contexts.

### API Surface Parity
- Non-Claude agents (Cursor, OpenCode, Codex, Custom) continue using the existing `AgentClient` ACP trait unchanged.
- The `AgentProvider` trait interface is preserved — only the Claude Code implementation changes.
- All 20+ Tauri commands in `commands/` are unchanged.
- `client_factory.rs` gains a third arm for `CommunicationMode::CcSdk`.

### Content Block Type Mismatch
cc-sdk uses Claude-native content blocks (`Text`, `Thinking`, `ToolUse`, `ToolResult`). Acepe's frontend currently expects ACP-spec blocks (`Text`, `Image`, `Audio`, `Resource`, `ResourceLink`). The `parsers/cc_sdk_bridge.rs` translation layer handles this mapping before events enter the dispatcher pipeline.

### Research Insights: Content Block Edge Cases

**Tool results with images:** cc-sdk's `ToolResultContent` may contain base64-encoded images. These must map to `ContentBlock::Image { data, mimeType }` in the ACP-style representation.

**Streaming text deltas:** cc-sdk may emit partial text as individual `Message::Assistant` events. The `StreamingDeltaBatcher` already handles coalescing these into 16ms batches — no special handling needed if the bridge emits `AgentMessageChunk` for each partial.

**Multi-turn tool sequences:** ToolUse → ToolResult pairs must maintain their `tool_use_id` linkage through the translation. The `TaskReconciler` handles tool call graph assembly downstream.

## Acceptance Criteria

- [ ] `acp_new_session` with `ClaudeCode` agent spawns a `ClaudeSDKClient` session (no Bun subprocess)
- [ ] `acp_send_prompt` delivers messages and streams responses to frontend via Tauri events
- [ ] Tool permission requests surface in Acepe's UI (same UX as before)
- [ ] Permission requests timeout after 60 seconds with auto-deny
- [ ] `acp_set_model` and `acp_set_mode` work mid-session via cc-sdk control protocol
- [ ] `acp_cancel` correctly interrupts in-progress operations
- [ ] Session resume (`acp_resume_session`) correctly continues previous conversation
- [ ] Session fork (`acp_fork_session`) correctly branches conversation
- [ ] Attachment tokens (`@[text:BASE64]`, `@[file:path]`) are expanded correctly (in frontend TypeScript)
- [ ] TCC-sensitive tools are blocked on macOS via consolidated `is_tcc_sensitive()` function
- [ ] AskUserQuestion tool surfaces a question dialog in the Acepe UI
- [ ] All existing Tauri commands pass their existing test suites
- [ ] No Bun subprocess is spawned when using Claude Code agent
- [ ] `packages/acps/claude/` can be deleted without breaking any other agent
- [ ] Event sequence parity: cc-sdk path produces equivalent `SessionUpdate` events to ACP path for identical prompts
- [ ] `CommunicationMode::CcSdk` correctly dispatched in `client_factory.rs`
- [ ] Streaming bridge feeds through `AcpUiEventDispatcher` (not direct to event hub)

## Dependencies & Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| cc-sdk NDJSON protocol drifts from official SDK | Medium | Pin cc-sdk version, monitor upstream for protocol changes |
| `CanUseTool` callback timing differs from ACP `client/requestPermission` | Medium | Add 60-second timeout on permission oneshots; integration test with real tool calls |
| cc-sdk single maintainer abandons project | Low | Protocol is simple NDJSON — we can fork or reimplement the ~500-line transport |
| Content block type mismatch breaks tool call rendering | High | Map cc-sdk blocks to ACP-style blocks in `parsers/cc_sdk_bridge.rs` before emitting events |
| `ClaudeSDKClient::set_model` not available on `InteractiveClient` | Known | Already accounted for — use `ClaudeSDKClient` not `InteractiveClient` |
| cc-sdk auto-download conflicts with Acepe's own agent installer | Medium | Set `auto_download_cli: false` in options, use Acepe's installer path |
| **NEW**: Streaming bridge bypasses event pipeline middleware | High | Feed through `AcpUiEventDispatcher`, not directly to `AcpEventHubState` |
| **NEW**: Permission oneshot blocks forever on frontend crash | High | 60-second timeout + monotonic nonce for stale request protection |
| **NEW**: `stop()` must be sync for Drop compatibility | Medium | Use `CancellationToken::cancel()` (sync) — async cleanup happens in bridge task |
| **NEW**: TCC tool name format mismatch with cc-sdk | Medium | Consolidated `is_tcc_sensitive()` using `normalize_tool_name()` suffix matching |
| **NEW**: Session ID format mismatch (cc-sdk vs Acepe UUID) | Low | If cc-sdk uses its own ID scheme, maintain bidirectional mapping in `CcSdkClaudeClient` |

## Security Considerations

### Pre-existing Issues to Fix During Migration

1. **CRITICAL: `acp_write_text_file` path traversal** (`file_commands.rs:93-132`) — No canonicalization before write. Add `tokio::fs::canonicalize()` and scope writes to session working directory.

2. **HIGH: Unvalidated `@[file:path]` reads** — If attachment expansion moves to Rust, scope file reads to session's project directory. Block dotfiles (`.ssh`, `.gnupg`, `.env`) unless explicitly allowed. Apply `validate_project_directory_brokered` checks.

3. **HIGH: Env var injection via agent overrides** — The `is_protected_agent_env_override_key` denylist should also block: `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY`, `SSL_CERT_FILE`, `SSL_CERT_DIR`, `CURL_CA_BUNDLE`, `HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`.

### Migration-Specific Security

4. **Permission timeout + nonce** — 60-second timeout on permission oneshots. Include monotonic nonce echoed by frontend to prevent stale approvals.

5. **TCC blocking consolidation** — Single canonical `is_tcc_sensitive()` function matching on base tool name after prefix stripping. Cache env var at startup.

6. **Base64 attachment size limit** — Add 1MB decoded size limit before base64 decoding to prevent memory exhaustion.

7. **Session ID validation** — Bind expected session ID to the cc-sdk transport. Validate in inbound router that the connection only references its own session.

## Performance Improvements

### Expected Gains

| Metric | Current | After cc-sdk | Improvement |
|---|---|---|---|
| Session cold start | 500-1500ms | 300-700ms | 200-800ms faster |
| Memory per session | 35-60 MB (Bun + CLI) | 5-10 MB (CLI only) | ~30-50 MB saved |
| 3 concurrent sessions | 105-180 MB | 15-30 MB | ~90-150 MB saved |
| Intermediate JSON allocations | 2x (Value DOM + re-serialize) | 1x (direct typed deserialize) | 50% fewer allocs on hot path |
| Background tasks per session | 3 (stdout, stderr, death monitor) | 1 (stream bridge) | 2 fewer tasks |

### Optimization Opportunities

1. **Pre-serialize event payloads:** Change `AcpEventEnvelope.payload` from `Value` to `Arc<str>`. Serialize once at enqueue time, broadcast as zero-copy Arc clone. Eliminates `to_value()` + `Value::clone()` on every event.

2. **High-priority counter:** Add `high_priority_count: usize` to `DispatcherState` to avoid O(n*m) scanning in `any_session_has_high()` on every dequeue.

3. **String ownership transfer:** Audit translation layer for `.clone()` and `.to_string()` — use `Into<String>` moves from cc-sdk types.

## Alternative Approaches Considered

1. **Keep ACP, replace Bun with a Rust ACP server** — Eliminates Bun but requires implementing the ACP server-side protocol in Rust. More work than cc-sdk adoption with no clear benefit.

2. **Call Anthropic HTTP API directly from Rust** — Eliminates all subprocesses but requires reimplementing Claude Code's entire tool runtime (file editing, bash, search, etc.) in Rust. Months of work.

3. **cc-sdk only for new sessions, keep ACP for existing** — Too complex to maintain two paths. Clean cutover is simpler.

4. **Update frontend to handle cc-sdk types directly** — Would break the `SessionUpdate` contract that Cursor, OpenCode, Codex, and custom agents also produce. Would couple frontend to a specific SDK's type system.

## Implementation Order

1. Add `cc-sdk` to Cargo.toml, add `CommunicationMode::CcSdk` variant
2. Implement `CcSdkClaudeProvider` (thin metadata provider)
3. Implement `CcSdkClaudeClient` with `AgentClient` trait (connect/disconnect)
4. Implement `PermissionBridge` with timeout + nonce
5. Implement streaming bridge feeding through `AcpUiEventDispatcher`
6. Implement content block translation in `parsers/cc_sdk_bridge.rs`
7. Wire up `client_factory.rs` dispatch arm
8. Add feature flag (`ACEPE_USE_CC_SDK=1`)
9. Consolidate TCC blocking into single function
10. Port AskUserQuestion handling
11. Integration test: event sequence parity, permission flow, session lifecycle
12. Validate with real usage (Phase 2)
13. Remove old path, delete `packages/acps/claude/`, update CI (Phase 3)

## Sources & References

- [cc-sdk crate](https://crates.io/crates/cc-sdk)
- [cc-sdk source](https://github.com/ZhangHanDong/claude-code-api-rs)
- [cc-sdk docs.rs](https://docs.rs/cc-sdk/latest/cc_sdk/)
- [Tokio CancellationToken docs](https://docs.rs/tokio-util/latest/tokio_util/sync/struct.CancellationToken.html)
- [Tokio graceful shutdown guide](https://tokio.rs/tokio/topics/shutdown)
- [Tauri async runtime](https://docs.rs/tauri/latest/tauri/async_runtime/index.html)
- [Rust tokio task cancellation patterns](https://cybernetist.com/2024/04/19/rust-tokio-task-cancellation-patterns/)
- Current Claude Code provider: `packages/desktop/src-tauri/src/acp/providers/claude_code.rs`
- Current client factory: `packages/desktop/src-tauri/src/acp/client_factory.rs`
- Current client trait: `packages/desktop/src-tauri/src/acp/client_trait.rs`
- Current Acepe ACP adapter: `packages/acps/claude/src/index.ts`
- Current client transport: `packages/desktop/src-tauri/src/acp/client/client_transport.rs`
- Current permission flow: `packages/desktop/src-tauri/src/acp/client/client_rpc.rs`
- Current event pipeline: `packages/desktop/src-tauri/src/acp/client_loop.rs`
- Current event dispatcher: `packages/desktop/src-tauri/src/acp/ui_event_dispatcher.rs`
- Current streaming batcher: `packages/desktop/src-tauri/src/acp/streaming_delta_batcher.rs`
- Memory: Bun silent hang fix (`packages/acps/claude/src/static-entry.ts`)
