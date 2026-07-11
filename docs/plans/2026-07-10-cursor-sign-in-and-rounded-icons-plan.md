# Cursor sign-in recovery and RoundedIcon consolidation

## Status

Draft for required document review. No implementation starts until review findings are resolved.

## Problem

Two related UI quality problems are visible in the agent panel:

1. A Cursor first send can stop at a neutral card that says “Sign in to continue” and “Sign in to Cursor Agent from its CLI, then retry the connection.” The card has no sign-in or retry action. The command is also missing because the desktop component compares the Rust display name `Cursor Agent` with the frontend-only string `cursor`.
2. Acepe still has generic product glyphs drawn directly with CSS or inline SVG. These bypass the shared `RoundedIcon` source, produce inconsistent geometry, and keep icon choice inside unrelated product components.

## Goals

1. Already-authenticated Cursor users connect without seeing a false sign-in card. A truly signed-out user can click **Sign in**, complete Cursor’s browser login, and have Acepe retry the correct pre-session or existing-session path.
2. Cursor executable resolution and login arguments remain owned by the Rust Cursor provider. TypeScript never compares provider display names or constructs provider CLI commands.
3. Generic product icons render through `RoundedIcon`. Missing icons are added to the same clean SVG source set and designed by Fable 5 to match its geometry, weight, fill, and view-box conventions.
4. Brand marks, file-type artwork, numbered todo markers, and animated loaders remain separate assets because they are not generic product icons.

## Non-goals

- Do not change Cursor’s credential storage or copy tokens into Acepe.
- Do not make the UI execute arbitrary command strings received from providers.
- Do not add a second session lifecycle/authentication authority in TypeScript.
- Do not replace provider logos, file icons, progress art, or loader animation frames.
- Do not keep the current CSS/SVG implementations as fallback paths after replacement.

## Current facts

- `CursorProvider::name()` returns `Cursor Agent`.
- `resolveSignInCommand()` in `agent-panel-pre-composer-stack.svelte` only matches `cursor`, so it returns `null` for the actual Rust display name.
- `AgentPanelSignInCard` renders an optional command as passive `<code>` and supports only `onDismiss`.
- The Acepe-managed Cursor binary currently returns success from `cursor-agent status`, yet `authenticate_if_required()` still calls ACP `authenticate` whenever Cursor advertises `cursor_login`. After ten seconds, Acepe converts that pending request into `AuthenticationRequired`. The code therefore treats “this login method is available” as “this user must log in.”
- The Cursor provider already resolves the Acepe-managed `cursor-agent` executable. Running that executable with `login` is the provider-supported browser authentication command.
- The same executable supports `status`; successful status is the provider-owned proof that stored Cursor credentials are ready for a new agent process.
- The failed first-send path restores the composer draft and attachments. Calling the existing composer `retrySend()` after successful authentication reuses the normal first-send path.

## Architecture decision

### Authority split

| Fact or action | Classification | Owner |
| --- | --- | --- |
| Cursor managed executable and `login` arguments | provider-owned | Rust `CursorProvider` |
| Cursor authentication status, login, and verification commands | provider-owned | Rust `CursorProvider` |
| Running/cancelling an agent authentication operation | provider boundary action | generic Rust/Tauri ACP command |
| Pre-session sign-in card visibility and busy/error feedback | truly local | desktop controller + presentational `@acepe/ui` props |
| Session lifecycle after retry | canonical-owned | Rust `SessionStateGraph` |
| Icon SVG geometry | design-system source | `packages/ui/src/components/icons/svg/` |
| Which icon represents a domain state | presentational mapping | `@acepe/ui` semantic wrapper or component |

The frontend sends only a canonical agent id to generic start/cancel authentication commands. It does not receive an executable path, arguments, environment, process output, or a provider-supplied shell string. The Rust provider returns structured status, login, and verification `SpawnConfig` values; the command starts them without a shell.

Cursor preflights `status` before the current ACP authentication call. A successful status skips ACP authentication because the advertised method is available but not required. A failed status produces the neutral authentication requirement immediately instead of waiting for an ACP authenticate timeout. Other providers keep their existing behavior unless they opt into the provider hook.

### Recovery flow

```text
Cursor first send
  -> Rust Cursor status preflight reports signed out
  -> Rust authentication requirement
  -> composer restores draft/attachments
  -> neutral sign-in card
  -> user clicks Sign in
  -> generic Tauri start-authentication command
  -> CursorProvider supplies managed binary + ["login"]
  -> Cursor opens browser and login completes
  -> CursorProvider ["status"] verification succeeds
  -> pre-session: clear local requirement and call retrySend()
  -> existing session: call canonical connectSession(sessionId)
  -> normal canonical session creation/reconnect and lifecycle envelopes
```

The Rust authentication operation is single-flight per canonical agent id. It has a five-minute timeout. A separate cancel command signals the operation; cancellation and timeout kill and reap the child before releasing the single-flight guard. While busy, the card replaces Dismiss with Cancel and the composer cannot send. If login fails or is cancelled, the card stays visible, displays a short recoverable error, and lets the user try again. No retry happens after a failed operation.

The controller captures the panel id, canonical agent id, session id, and a local attempt token at click time. A late completion retries only when the attempt is still current, the same agent/panel is active, and the sign-in requirement is still present. Otherwise it reports that sign-in completed and leaves sending/reconnect under the current UI state. Composer text and attachments may still be edited while login runs; disabling send prevents duplicate first sends.

## Test seams agreed for TDD

Tests exercise public behavior rather than source strings:

1. **Rust provider seam:** Cursor status success skips ACP authentication; status failure returns an authentication requirement. Cursor’s action supplies managed status/login/verification commands with filtered environment policy. A provider without this preflight/action keeps existing behavior.
2. **Generic authentication runner seam:** login succeeds only when both login and verification exit successfully; non-zero, timeout, cancellation, and duplicate-start paths return safe typed results. Tests use boundary test executables, not a shell command assembled from user input. Secret-like stdout/stderr never enters errors or logs.
3. **Shared card seam:** with `onSignIn`, the card renders a Sign in button; its busy and error props change visible/accessible behavior; clicking calls the supplied callback.
4. **Desktop recovery seam:** pre-session success clears the local requirement and calls the first-send retry callback exactly once; existing-session success calls canonical `connectSession(sessionId)` without creating a replacement session; stale completion and failure do not retry.
5. **Icon seam:** components render the expected `RoundedIcon` semantic name for each public state. Tests query rendered SVG/test ids and user-visible state; no test reads source files or asserts source text.

## Implementation units

### Unit 1 — Correct Cursor authentication detection and provider-owned action

Files:

- `packages/desktop/src-tauri/src/acp/provider.rs`
- `packages/desktop/src-tauri/src/acp/providers/cursor/provider.rs`
- `packages/desktop/src-tauri/src/acp/commands/` (focused authentication command module)
- `packages/desktop/src-tauri/src/acp/commands/mod.rs`
- `packages/desktop/src-tauri/src/commands/registry.rs`
- `packages/desktop/src-tauri/src/commands/names.rs`
- `packages/desktop/src-tauri/src/lib.rs`
- generated command/type clients under `packages/desktop/src/lib/services/`

Steps:

1. Add default provider hooks for no authentication preflight and no interactive action.
2. Cursor runs its managed `status` command: success skips proactive ACP authentication; failure returns `AuthenticationRequired` immediately. This corrects the availability-vs-requirement bug without a frontend repair.
3. Implement Cursor’s action using its managed launcher with `login`, followed by `status` verification, preserving its filtered environment strategy.
4. Add generic Tauri start/cancel commands accepting a canonical agent id. Resolve the provider and run its structured action without a shell.
5. Enforce one active operation per agent. Use a five-minute timeout; cancel/timeout kills and reaps the child. Discard stdout and stderr. Frontend errors and diagnostics must not contain process output, executable paths, arguments, or environment values.
6. Register commands and regenerate command names/types using the existing Specta export tests.
7. Do not change transcript or operation data. Existing-session recovery uses the current canonical session connection API rather than clearing lifecycle locally.

TDD:

- Red: an authenticated Cursor preflight must not call ACP authenticate or return `AuthenticationRequired`; a signed-out preflight must return the requirement without the ten-second timeout.
- Green: provider preflight implementation.
- Red: runner success, verification failure, non-zero, timeout, cancellation, duplicate-start, and output-redaction tests.
- Green: command runner implementation.

Verification:

- Focused Rust tests for provider and command module.
- `cargo clippy --no-default-features` from `packages/desktop/src-tauri`.

### Unit 2 — Presentational sign-in card actions

Files:

- `packages/ui/src/components/agent-panel/agent-sign-in-card.svelte`
- new or existing component test beside the card
- `packages/desktop/src/routes/test-command-chip/+page.svelte`

Props:

- `onSignIn?: () => void`
- `onCancelSignIn?: () => void`
- `signInLabel?: string` defaulting to `Sign in`
- `isSigningIn?: boolean`
- `signInError?: string | null`
- preserve `onDismiss`

Behavior:

- Primary Sign in button is visible when `onSignIn` exists.
- Busy state disables duplicate Sign in clicks, replaces Dismiss with Cancel, sets `aria-busy`, and shows the shared loading icon with “Signing in…” copy.
- Failure/cancellation text uses an `aria-live="polite"` region. Focus returns to Sign in after failure/cancellation. On success, focus follows the normal composer/session transition.
- Remove passive manual command rendering from this card. Provider CLI knowledge remains exclusively in Rust.
- Replace the CSS door/arrow glyph with `RoundedIcon`.

TDD:

- Red component tests for action, busy state, and error state.
- Green minimal presentational implementation.

### Unit 3 — Desktop Cursor recovery orchestration

Files:

- `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel.svelte`
- `packages/desktop/src/lib/acp/components/agent-panel/components/agent-panel-pre-composer-stack.svelte`
- focused recovery service and test under `packages/desktop/src/lib/acp/components/agent-panel/services/`
- `packages/desktop/src/lib/services/tauri-command-client.ts`

Steps:

1. Delete `resolveSignInCommand()` and all provider display-name matching from Svelte.
2. Add a focused recovery service that calls the generated start/cancel commands and returns `ResultAsync` outcomes.
3. The controller owns local `isSigningIn` and `signInError` state.
4. Disable composer send while authentication is active, while keeping draft editing available.
5. On pre-session success, clear the local sign-in requirement and call `agentInputRef.retrySend()` once.
6. On existing-session success, call `sessionStore.connection.connectSession(sessionId)` so canonical lifecycle clears through Rust envelopes. Never create a replacement session and never locally clear `Detached(AwaitingAuthentication)`.
7. Guard late completion with captured panel/agent/session identity plus an attempt token.
8. On failure/cancel, keep the card and composer intact and show the recoverable status. Dismiss is available only when no authentication operation is active.

TDD:

- Red service/controller-seam tests for success and failure.
- Green orchestration with no `try/catch`, no `any`, no `unknown`, and no provider branch in TypeScript.

### Unit 4 — RoundedIcon consolidation

Source and generator:

- `packages/ui/src/components/icons/svg/*.svg`
- `packages/ui/scripts/generate-rounded-icons.mjs`
- generated `packages/ui/src/components/icons/rounded-icon-data.generated.ts`
- `packages/ui/src/components/icons/__tests__/rounded-icon-data.test.ts`

Fable 5 design task:

1. Inspect the current SVG source set and design-system icon route.
2. Reuse an existing icon when semantics are clear.
3. For a missing semantic icon, add a clean SVG source matching the set’s view box, corner radius, stroke/fill weight, optical size, and `currentColor` behavior.
4. Implement the SVG files and report each mapping. Do not edit Rust, session logic, or tests outside icon/component rendering.

Product component cleanup includes:

- CSS/composite glyphs: sign-in, system theme, eye-off, attention pulse, structured/table view, neutral CI status, move, unlink, worktree checkbox, build, layout modes, and file-status overlays.
- Inline product SVGs: microphone, submit/stop, inline artefact badges, and default-agent heart.
- Standalone generic icon components: menu, save, database, storage, palette, robot, recycle, and wrench.

Path-level source inventory:

| Current source | Custom glyphs |
| --- | --- |
| `packages/ui/src/components/agent-panel/agent-sign-in-card.svelte` | sign-in CSS |
| `packages/desktop/src/lib/components/theme/brand-theme-toggle.svelte` | system-theme CSS |
| `packages/desktop/src/lib/components/settings-page/sections/agent-env-overrides-dialog.svelte` | eye-off composite |
| `packages/ui/src/components/attention-queue/feed-section-header.svelte` | attention pulse CSS |
| `packages/ui/src/components/file-panel/file-panel-header.svelte` | structured/table CSS |
| `packages/ui/src/components/pr-checks/pr-checks-list.svelte` and `packages/desktop/src/lib/acp/components/pr-status-card/ci-job-modal.svelte` | neutral CI status CSS |
| `packages/ui/src/components/agent-panel/permission-bar-icon.svelte` | move composite |
| `packages/ui/src/components/native-markdown/native-markdown-github-chip.svelte` | unlink composite |
| `packages/ui/src/components/agent-panel/agent-input-new-thread-options.svelte` | checkbox check CSS |
| `packages/ui/src/components/icons/build-icon.svelte` | build CSS |
| `packages/ui/src/components/icons/layout-mode-icon.svelte` | layout-mode CSS |
| `packages/ui/src/components/icons/file-status-icon.svelte` | file-status CSS overlays |
| `packages/ui/src/components/agent-panel/agent-input-mic-button.svelte` | microphone inline SVG |
| `packages/ui/src/components/agent-panel/agent-input-submit-button.svelte` | submit/stop inline SVG |
| `packages/ui/src/components/inline-artefact-badge/inline-artefact-badge.svelte` | package/clipboard inline SVG |
| `packages/ui/src/components/agent-panel/default-agent-heart-icon.svelte` | heart inline SVG |
| `packages/ui/src/components/icons/{menu,save,database,storage,palette,robot,recycle,wrench}-icon.svelte` | standalone generic SVGs |

Rules:

- Simple call sites use `RoundedIcon` directly.
- A semantic wrapper remains only when it maps a domain union to icon names, sizing, and color. It must not contain SVG paths or CSS geometry.
- Remove obsolete wrappers, exports, CSS, and fixture names after all call sites move.
- Preserve brand logos, file-type image lookup, todo numbering, and animated loaders.

TDD proceeds in vertical slices: one component/state test, one replacement, then the next component. Run `bun run check` after each TypeScript/Svelte slice.

### Unit 5 — Cleanup, review, and documentation

1. Search for remaining generic inline `<svg>` and CSS/composite icon geometry outside allowed logo/loader/file-art paths.
2. Remove obsolete exports and update the icon README with the “generic product icons use RoundedIcon” rule.
3. Record a short solution note for the Cursor auth recovery cause and provider-boundary fix.
4. Run the required non-trivial code review against the pre-change working-tree baseline, resolving all valid findings.
5. Re-run the GOD architecture check. Required attestation: provider login facts are Rust-owned; pre-session busy/error state is local; canonical lifecycle remains Rust-owned; no frontend provider branching exists.

## Verification matrix

| Area | Command/evidence |
| --- | --- |
| UI focused tests | `bun test <changed .svelte.vitest.ts files>` from `packages/desktop` or package-local equivalent |
| Desktop TypeScript/Svelte | `bun run check` from `packages/desktop` after every TS/Svelte change |
| UI package | package tests and typecheck used by the workspace |
| Rust focused tests | focused `cargo test`/`cargo nextest` filters for authentication and Cursor provider |
| Rust lint | `cargo clippy --no-default-features` from `packages/desktop/src-tauri` |
| Full desktop tests | `bun test` from `packages/desktop` |
| Build | `bun run build` from `packages/desktop` |
| Icon generation | generator plus `rounded-icon-data.test.ts` |
| GOD clearance | repeat `god-architecture-check` against final diff |

## Required desktop QA

Use the real dev Tauri app through the repository wrapper after all code changes:

1. `bun run qa doctor`
2. Open the sign-in-card fixture or reproduce an unauthenticated Cursor first send.
3. `bun run qa inspect --selector='[data-testid="agent-sign-in-card"]'` to prove title, Sign in button, and Dismiss button.
4. Click Sign in through the wrapper. For a real unauthenticated account, observe the busy state, complete browser auth, and verify the restored first message retries. If the account is already authenticated, use the deterministic fixture/probe for the UI transition and separately verify the Rust command result.
5. Inspect affected icon fixtures through the design-system/test route.
6. `bun run qa screenshot` for the sign-in card and icon grid.

If the wrapper cannot navigate to the fixture or trigger the sign-in state smoothly, add a small supported QA command before continuing rather than using repeated raw MCP calls.

## Risks and mitigations

- **Login process hangs:** five-minute backend timeout plus explicit Cancel; both kill and reap the child before releasing the single-flight guard.
- **First message sends twice:** disable composer send and duplicate clicks while signing in; use a current attempt/identity guard before the one allowed retry.
- **Credential exposure:** discard stdout and stderr. Do not expose or log process output, executable paths, arguments, or environment values; return only a small safe error enum/message.
- **Provider coupling leaks into UI:** clearance search for `Cursor Agent`, `cursor_login`, and `agent login` under Svelte/TypeScript product code.
- **False auth requirement:** provider-owned `status` must prove whether Cursor is authenticated before the current ACP authentication call. Tests pin both status outcomes.
- **Login exit precedes credential readiness:** require a successful provider-owned `status` verification after `login` before reporting success or retrying.
- **Existing-session card persists:** reconnect through `connectSession(sessionId)` and canonical Rust envelopes; never clear canonical detached state in the UI.
- **Icon semantics regress:** Fable 5 owns missing SVG design; stateful component tests and real-app screenshots verify the final mapping.
- **Unrelated dirty files:** preserve the existing sidebar/updater changes and stage/commit only files created or changed for this task if a commit is requested.

## Rollback

Before commit, revert only task-owned files with an inverse patch. Do not use `git stash`, `git reset --hard`, or checkout commands that could overwrite the user’s existing sidebar/updater work. The Rust command, UI action, and icon slices are independent enough to diagnose separately, but the final delivered state must not keep parallel old/new icon or provider-command paths.
