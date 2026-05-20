---
date: 2026-05-20
topic: mid-session-worktree-runtime-rebind
supersedes: docs/plans/2026-05-19-mid-session-worktree-toggle-plan.md
---

# Mid-session worktree switch: runtime rebind fix

## Problem

PR #198 added the right product prompt for turning Worktree on during an existing session, but the Continue path is not architecturally complete.

Current behavior:

1. Frontend creates a prepared worktree with `git_prepare_worktree_session_launch`.
2. Frontend updates panel state and `session.worktreePath`.
3. Future sends still call `sendPrompt(sessionId, ...)` on the already-registered ACP client.

That means the UI and cold session metadata can say "this session is in the new worktree" while the live provider process may still be rooted in the original checkout. This violates the product promise even though it does not violate the GOD canonical lifecycle/capability rules.

## Goal

Make `Continue in new worktree` a backend-owned, atomic runtime operation:

- Create the new worktree.
- Rebind the active provider runtime so future prompts and tool calls execute from the worktree cwd.
- Persist `session.worktreePath` only after the runtime rebind succeeds.
- Leave existing dirty files in the original checkout untouched.
- Do not leak prepared-launch reservations.

## GOD architecture check

Touched fields:

| Field/state | Classification | Rule |
|-------------|----------------|------|
| `worktreeSwitchDialogOpen`, `worktreeSwitchBusy`, `worktreeSwitchError` | truly-local | UI-only dialog state may remain in `agent-panel.svelte`. |
| `panel.pendingWorktreeEnabled` | truly-local/transient | Pre-session toggle intent only. Must not mean "active live session runtime has moved". |
| `panel.preparedWorktreeLaunch` | truly-local/transient | Allowed for first-send launch only. Must not be reused as durable mid-session authority. |
| `session.worktreePath` | cold session metadata | Can be persisted after backend runtime rebind success. |
| lifecycle/activity/turn/capabilities | canonical-owned | Do not write hot state or synthesize canonical projections. Runtime readiness must come from Rust-emitted envelopes/events. |

No reader-level fallback is allowed. If the frontend needs to know whether a mid-session switch is in progress, model that as local dialog/action state or a backend command result, not as lifecycle hot state.

## Product behavior

The dialog remains:

- **Continue in new worktree**: safe default. Existing dirty/uncommitted files stay in the source checkout and are not visible to the agent in the new worktree unless already committed. Future agent turns run from the new worktree.
- **Move session changes**: still disabled/deferred until ownership proof and transfer safety are implemented. Disabled copy must explain that Acepe cannot move current changes until it can prove which files are session-owned and safe to transfer.
- **Cancel**: no state changes.

If runtime rebind fails, the dialog stays open and shows an actionable error. The session remains rooted in the original checkout and `session.worktreePath` is not updated.

## Architecture

### 1. Replace frontend-only continue service with a backend command

Add a Tauri command:

```rust
acp_switch_session_to_worktree(
    session_id: String,
    project_path: String,
    agent_id: Option<String>,
) -> CommandResult<SwitchSessionToWorktreeResponse>
```

Response:

```rust
struct SwitchSessionToWorktreeResponse {
    worktree: WorktreeInfo,
}
```

The command owns all irreversible steps. The frontend no longer calls `git_prepare_worktree_session_launch` for mid-session Continue.

### 2. Backend algorithm

1. Validate `project_path` is a git repo and allowed cwd.
2. Resolve the live session from `SessionRegistry`.
3. Acquire a backend-owned per-session switch gate.
   - The gate is checked by `acp_send_prompt`, model/mode/config/autonomous mutations, cancel/stop paths that would race with replacement, and this command itself.
   - If a gate already exists for the session, reject this switch.
4. Reject if the session is currently busy, awaiting interaction, or cannot safely be restarted/reconnected.
   - Use Rust lifecycle/supervisor state as authority.
   - Check lifecycle, turn state, activity, active operations, and pending interactions rather than lifecycle status alone.
   - Do not trust frontend `canSend`.
5. Create a new managed worktree without reserving a new-session launch token.
   - Reuse low-level helpers from `git/worktree.rs` for naming and creation.
   - Do not call `reserve_worktree_launch`.
6. Run existing worktree setup orchestration before provider rebind.
   - If setup fails, stop before client replacement and remove the worktree.
   - The frontend should surface setup failure as part of the switch error, not as a background warning.
7. Create and initialize a fresh provider client rooted at the new worktree cwd.
8. Reconnect or attach the existing provider session ID in the new client:
   - Extract a new helper from the existing resume flow that can reconnect a client created off-registry, without calling `SessionRegistry::store`.
   - Do not reuse `resume_or_create_session_client` directly because it currently chooses force-replacement through `launch_mode_id` and performs registry storage before the metadata-persistence step required here.
   - The existing transcript remains the same Acepe session.
   - If the selected provider cannot reopen/reattach the existing session in a different cwd, return a provider-specific unsupported-switch error and rollback. Do not claim the feature works for that provider.
9. Reconcile runtime settings on the replacement client (see "Runtime state reconciliation").
10. Persist the existing session metadata with the new `worktree_path`.
   - This needs a backend repository method that updates every durable worktree-path location for the session in one DB transaction.
   - The transaction must cover `session_metadata.worktree_path` and `acepe_session_state.worktree_path` (or the current canonical persisted equivalents).
   - Persistence happens while the old client is still registered and usable.
11. Store the replacement client in `SessionRegistry` under the same `session_id`.
   - Treat registry swap as the final in-memory step after all fallible work succeeds.
   - The current `SessionRegistry::store` returns the old client and is not fallible; if implementation discovers a fallible swap path, add rollback/restore support before proceeding.
   - Stop the old client only after the replacement client is registered.
12. Emit/route the normal readiness/capability/session-open events from Rust.
   - No frontend canonical synthesis.
13. Release the switch gate and return the new worktree info.

### 2.1 Backend switch gate

The command must install a backend-owned per-session switch gate before creating the worktree. Existing mutation command paths must consult this gate before looking up and dispatching to the session client.

The gate blocks or rejects, for the target session:

- `acp_send_prompt`
- model changes
- mode changes
- config option changes
- autonomous toggles
- cancel/stop commands when they would race with client replacement
- a second concurrent worktree switch

The gate is held until either:

- the new client is registered and metadata is persisted, or
- rollback completes and the original runtime remains active.

At gate acquisition, Rust should emit canonical lifecycle/activity state that makes the session temporarily non-sendable. This keeps UI send state canonical-owned and avoids frontend hot-state patches.

Required race tests:

- `send_prompt` during switch is rejected before transport dispatch.
- double switch for the same session is rejected.
- mode/model/config/autonomous mutation during switch is rejected before transport dispatch.
- mutations that acquired the client lock before switch gate acquisition must finish before the switch snapshots runtime settings.

### 2.2 Runtime state reconciliation

Replacing a provider client under the same Acepe session must preserve runtime settings.

Before reconnecting/replacing:

1. Acquire the switch gate, then wait for or reject any already-started mutation commands according to the shared gate policy.
2. Read current canonical capabilities/runtime settings for the session:
   - current model
   - current mode
   - config options
   - autonomous policy
3. Reconnect/attach the replacement client from the new worktree cwd.
4. Re-apply or verify those settings on the replacement runtime before releasing the switch gate.
5. Emit the resulting capability envelope from Rust.

If a setting cannot be re-applied or the provider reports incompatible capabilities, fail the switch and rollback instead of silently changing behavior.

### 3. Failure and rollback

| Failure point | Required behavior |
|---------------|-------------------|
| Worktree create fails | Return error. No session metadata changes. |
| Worktree setup fails | Remove worktree. Old client remains active. |
| New client initialize fails | Remove worktree. Old client remains active. |
| Reconnect/attach fails | Stop new client, remove worktree if safe, old client remains active. |
| Provider attach mutates external session state before failing | Stop new client, leave old client active, do not remove files created by provider attach unless Acepe can prove they are setup-generated and safe to delete. Return recovery guidance. |
| Metadata persistence fails | Stop new client, remove worktree, old client remains active because registry has not been swapped yet. |
| Registry swap fails | This should not be a fallible operation with current `SessionRegistry::store`; if implementation exposes a fallible swap, add rollback/restore support before proceeding. |
| Crash after worktree creation | A startup cleanup/reconciliation path should detect unmanaged/orphaned switch worktrees and leave them for explicit user cleanup rather than deleting potentially touched files silently. |

No partial success response. The command either returns success with a usable runtime in the worktree or returns an error without updating durable `session.worktreePath`. Because filesystem/provider side effects cannot be part of a single DB transaction, "atomic" here means no success-shaped partial session switch, not that every temporary file can always be undone.

### 4. Frontend service shape

Replace `prepareMidSessionWorktreeSwitch` with:

```ts
switchActiveSessionToWorktree({
  sessionId,
  projectPath,
  agentId,
}): ResultAsync<SwitchSessionToWorktreeResult, AppError>
```

This service only calls the new Tauri command and maps the response. It does not:

- Call `prepareWorktreeSessionLaunch`.
- Store `PreparedWorktreeLaunch`.
- Set `pendingWorktreeEnabled`.
- Persist `session.worktreePath` before backend success.

### 5. Agent panel wiring

Update `handleWorktreeSwitchContinue`:

1. Validate `sessionId`, `projectPath`, `agentId`.
2. Set dialog busy with progress copy such as `Creating worktree...`, `Running setup...`, and `Reconnecting agent...` when the backend exposes phases.
3. Call `switchActiveSessionToWorktree`.
4. On success:
   - Close dialog.
   - Prefer backend-emitted session hydration for `worktreePath`. If no hydration path exists yet, update `sessionStore.updateSession(sessionId, { worktreeDeleted: false, worktreePath })` only after backend command returns success.
   - Set `activeWorktreePath` / `activeWorktreeOwnerProjectPath` only as a temporary display bridge until store hydration converges.
   - Show a success toast or footer status confirming future turns now use the new worktree.
   - Do **not** call `handlePreparedWorktreeLaunch`.
   - Do **not** set `panel.pendingWorktreeEnabled`.
5. On error:
   - Keep dialog open.
   - Show an actionable error:
     - unsupported provider/session: explain that this agent cannot move an existing session to a new worktree yet.
     - busy session/interactions: ask the user to wait for the current turn or resolve the prompt.
     - setup/reconnect failure: say the original session is unchanged.
   - Leave session/worktree UI unchanged.
6. Accessibility:
   - Busy and error copy must be announced with a live region.
   - Buttons disabled by the switch must expose disabled reasons where practical.

### 6. First-send path remains separate

Do not rewrite the first-send worktree flow in this fix.

Allowed first-send path:

- `pendingWorktreeEnabled`
- `prepareWorktreePathForPendingSend`
- `PreparedWorktreeLaunch`
- `launchToken`
- `acp_new_session(cwd, launchToken)`

Allowed mid-session path:

- `acp_switch_session_to_worktree(sessionId, projectPath, agentId)`
- no `PreparedWorktreeLaunch`
- no `launchToken`
- no pending first-send state

This separation prevents launch-token leaks and keeps each flow honest.

## Tests

### Rust tests

Add tests around the new command:

1. Creates a managed worktree and replaces the active session client with one rooted in the worktree cwd.
2. Future `acp_send_prompt` uses the replacement client, not the old client.
3. Does not create or leave a reserved worktree launch row.
4. Worktree creation failure leaves old client and metadata unchanged.
5. New client initialize/reconnect failure removes the worktree and leaves old client active.
6. Metadata persistence failure does not return success.
7. Rejects switch while lifecycle is busy / active turn / pending interaction.
8. Rejects `acp_send_prompt` during an in-progress switch before transport dispatch.
9. Rejects or blocks model/mode/config/autonomous mutation during switch according to the backend policy.
10. Preserves current model/mode/config/autonomous settings after switching.
11. Prevents concurrent double-switch for the same session.

### TypeScript tests

1. `mid-session-worktree-switch-service.test.ts`
   - Calls the new Tauri command.
   - Does not call `prepareWorktreeSessionLaunch`.
   - Maps errors.

2. Agent panel flow test
   - Mid-session Worktree click opens dialog.
   - Continue calls the new service with `sessionId`.
   - Success updates UI only after service success.
   - Error leaves dialog open and does not set pending/prepared launch.

### Manual verification

1. Start a root-checkout session.
2. Ask the agent to run `pwd` or create a file.
3. Toggle Worktree on and choose Continue.
4. Ask the same session to run `pwd` or create another file.
5. Verify the second action occurs in the new worktree path.
6. Verify original dirty files remain in the source checkout.
7. Verify no stale prepared launch rows/records remain.

## Implementation order

1. Add failing Rust tests for the backend command, gate, rollback, no launch-token reservation, and future-send cwd behavior.
2. Add failing TypeScript tests for service/panel behavior: no prepared launch, no pending worktree flag, error leaves dialog open.
3. Add Rust backend command, switch gate, repository helper, and provider rebind helper.
4. Replace desktop service with `switchActiveSessionToWorktree`.
5. Update `agent-panel.svelte` wiring to remove prepared-launch/pending-worktree use from mid-session Continue.
6. Run:
   - `cd packages/desktop && bun run check`
   - targeted TS/Vitest tests
   - relevant Rust tests
   - `cd packages/desktop/src-tauri && cargo clippy`

## PR #198 cleanup before merge

Before updating the PR:

- Remove or replace the current frontend-only `prepareMidSessionWorktreeSwitch` implementation.
- Ensure no mid-session Continue code calls `handlePreparedWorktreeLaunch`.
- Ensure no mid-session Continue code sets `pendingWorktreeEnabled`.
- Ensure no mid-session Continue path can persist `session.worktreePath` unless the backend command succeeded.
- Keep the dialog; it is the right product surface.

## Deferred

`Move session changes` remains out of scope. It should build on the same backend command after adding ownership-proof and transfer preflight, not on the current frontend prepared-launch path.
