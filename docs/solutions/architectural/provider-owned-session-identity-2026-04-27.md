---
module: acp-session-identity
last_updated: 2026-04-28
tags:
  - provider-owned-identity
  - creation-attempts
  - session-metadata
  - final-god
problem_type: architecture
---

# Provider-owned session identity

## Problem

Acepe previously allowed completed sessions to carry two identities: a local Acepe id and an optional provider id. That made creation and restore race-prone. A panel could briefly exist under a local id, disappear, then reappear under the provider id once the runtime connected. The same split also made tool-call and planning-state restore brittle because provider history lives in provider id space while Acepe UI state was sometimes keyed by local ids.

## Final invariant

Completed `session_metadata.id` is the provider-owned canonical session id. There is no steady-state `provider_session_id` alias column and no `provider_identity_kind` bridge column in `session_metadata`.

Pre-provider work lives in `creation_attempts` until the provider identity is proven. A creation attempt may reserve worktree/sequence/user intent and may record the requested provider id, but it is not a product session, not a panel id, and not a restore id.

## Creation lifecycle

1. The backend creates a `creation_attempts` row before provider work is observable.
2. Providers that can synchronously return a canonical id promote the attempt immediately.
3. Providers that need first-stream identity evidence stay pending until the adapter proves the provider id.
4. Promotion inserts `session_metadata` under the provider id and consumes the attempt in one transaction.
5. The frontend may show a pending creation surface, but it must not add a completed session panel until promotion materializes the canonical graph snapshot.

## Concrete implementation points

The final invariant is enforced at three layers:

1. **Database and migrations.** `creation_attempts` owns pre-provider rows, `idx_creation_attempts_launch_token` is the named worktree launch-token constraint, and `idx_creation_attempts_project_sequence` protects reserved sequence ids before promotion. `reserve_worktree_launch` allocates `sequence_id` and inserts the creation attempt in the same transaction, retrying on sequence constraint conflicts. Migration `m20260426_000001_add_provider_identity_kind` guards `provider_session_id` references so it can run after bridge columns are gone, and its down path restores `provider_session_id = id` for canonical rows before dropping `provider_identity_kind`.
2. **Provider promotion.** Deferred Claude cc-sdk creation promotes only after the stream proves the provider id equals the requested canonical id. If the database is unavailable or `promote_creation_attempt` fails, the pending attempt is marked failed so quota is not leaked.
3. **Frontend materialization.** `pendingCreationSessions` is not a real session list. `ensureSessionFromStateGraph` materializes the session only from the canonical graph snapshot, looking up by `requestedSessionId` when `graph.isAlias` is true and inserting under `canonicalSessionId`.

## Failure lifecycle

Creation and restore failures are typed. Provider failure before identity, invalid provider ids, metadata commit failures, launch-token failures, missing provider history, unavailable provider history, unparseable history, validation failures, and stale lineage recovery are all explicit states. They must not be rendered as empty connected sessions.

Deferred creation failures must also clean up frontend pending state. A failed first send or terminal provider error before canonical graph materialization removes the pending creation entry, marks the hot state as error, and prevents future sends from routing into a dead attempt id.

Frontend error deserialization must preserve structured ACP failures. `creation_failed` should surface as a typed creation failure with `kind`, `sessionId`, `creationAttemptId`, and `retryable`; `provider_history_failed` should preserve `kind`, `sessionId`, and `retryable`. Collapsing these to generic connection errors breaks retry decisions and makes async creation failures opaque.

## Legacy handling

Legacy rows with local ids plus provider aliases are handled by migration before the bridge columns are dropped. Rows that can be proven safe are re-keyed to the provider id with child references repointed. Rows that cannot be proven safe are diagnosed in `session_identity_migration_report`; runtime product paths do not route through aliases.

Only registry-file legacy aliases (`__session_registry__/{old_id}`) are migrated automatically. Rows with non-registry file paths or provider-id conflicts remain unresolved and diagnosed, because cloning them before deleting the old row can violate the unique `file_path` constraint.

## Checks for future work

- New provider adapters must return or prove provider-canonical identity before a completed session is stored.
- Do not add a durable alias column back to `session_metadata`.
- Do not use attempt ids as session ids in UI, registry, replay, resume, or open commands.
- Provider history loading should use `session_metadata.id` directly.
- If provider history is missing or unparseable, surface a typed restore failure instead of fabricating local transcript state.
- Never insert fake `session_metadata` rows to reserve worktree or sequence state; use `creation_attempts`.
- First-send from a backend-authored `Reserved` session must route through direct send, not resume/load. `Detached` is the lifecycle state that authorizes provider resume/load. Pending-creation terminal-error paths must still update both machine state and hot state, then remove the pending creation entry.
- Tests should exercise behavior through repositories, migrations, and store services; avoid source-text contract tests that assert implementation strings.

## Review-time regression checklist

When touching provider-owned identity again, run targeted coverage for:

- `cargo test db::repository_test --quiet`
- `cargo test acp::commands::tests:: --quiet`
- `cargo test acp::session_descriptor --quiet`
- `cargo test acp::session_registry --quiet`
- `cargo test history::commands::session_loading --quiet`
- `cargo test m20260426_000001_add_provider_identity_kind --quiet`
- `cargo test m20260427_000001_create_creation_attempts --quiet`
- `cargo test m20260427_000002_migrate_legacy_provider_aliases --quiet`
- `cargo test m20260427_000003_drop_provider_identity_bridge --quiet`
- `bun test src/lib/acp/errors/deserialize-acp-error.test.ts src/lib/acp/store/services/__tests__/session-messaging-service-send-message.test.ts ./src/lib/acp/store/__tests__/session-store-create-session.vitest.ts src/lib/acp/store/services/session-connection-manager.test.ts`

## Related

- `docs/solutions/best-practices/provider-owned-policy-and-identity-not-ui-projections-2026-04-09.md` — earlier runtime/replay identity policy that this storage endpoint completes.
- `docs/solutions/architectural/revisioned-session-graph-authority-2026-04-20.md` — canonical graph authority and typed restore-failure semantics that pending creation materialization depends on.
