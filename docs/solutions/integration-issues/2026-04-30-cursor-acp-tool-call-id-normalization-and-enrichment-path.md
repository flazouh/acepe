---
title: Normalize Cursor ACP tool-call IDs before canonical operation projection
date: 2026-04-30
category: integration-issues
module: acp/providers/cursor
problem_type: integration_issue
component: assistant
symptoms:
  - Cursor ACP tool calls rendered with orange degraded styling in the Agent Panel
  - Tool call labels showed sparse or raw text with no arguments
  - SessionStateGraph projected operations as degraded with invalid_provenance_key
  - Cursor tool-call enrichment never backfilled arguments from the persisted ACP store
  - Reopened sessions could briefly show orange `Unresolved tool` rows, then resolve after attach refreshed session state
root_cause: logic_error
resolution_type: code_fix
severity: high
related_components:
  - tooling
tags:
  - cursor
  - acp
  - tool-call
  - id-normalization
  - provenance-key
  - enrichment
  - agent-panel
  - degraded-state
---

# Normalize Cursor ACP tool-call IDs before canonical operation projection

## Problem

Cursor ACP tool calls were reaching Acepe as structured tool updates, but the Agent Panel rendered them as sparse tool rows with orange degraded labels. The canonical graph correctly rejected the provider's raw operation provenance because Cursor emitted composite tool-call IDs containing a literal newline.

The same sessions also lacked rich tool details because Cursor enrichment did not load the ACP-session SQLite store where Cursor persisted the complete tool arguments. After live parsing was fixed, reopened sessions could still show orange because the provider-history restore converter also emitted raw newline IDs into canonical projection. A later reopen bug had the same root family: the initial open response normalized operation source links but built transcript rows from raw stored tool-entry IDs, so the Agent Panel could not join the row to its operation until a later attach snapshot refreshed state.

## Symptoms

- Tool labels rendered orange through `ToolLabel`'s `status === "degraded"` path.
- `acp_get_session_state` showed operations with `operation_state: "degraded"` and `degradation_reason.code: "invalid_provenance_key"`.
- Live streaming logs had structured tool calls like `title: "Find"`, `kind: "search"`, and `rawInput: {}`, but their `toolCallId` values contained a literal newline: `call_...\nfc_...`.
- Persisted Cursor ACP store entries under `~/.cursor/acp-sessions/<session-id>/store.db` had the missing rich args, such as `glob_pattern` and `target_directory`.
- The copied/exported transcript still showed generic `## Tool: Find` / `## Tool: grep` rows because the live payloads lacked arguments to format.
- After restart/reopen, canonical state could still contain raw newline `tool_call_id` values if the restored `FullSession` conversion path bypassed the ACP live parser.

## What Didn't Work

- Treating the orange UI as a design-system color bug. The color was a correct presentation of canonical `operation_state: degraded`.
- Adding UI fallbacks for tool details. That would have hidden a canonical provenance failure and violated the rule that provider quirks stop at the adapter/parser boundary.
- Looking only in `~/.cursor/chats/<project-hash>/<session-id>/store.db`. Acepe-launched Cursor ACP sessions persist under `~/.cursor/acp-sessions/<session-id>/store.db`.
- Indexing persisted tool uses by raw provider ID while live updates used canonical-safe IDs. Even after finding the right store, raw `call_...\nfc_...` and normalized `call_...%0Afc_...` keys would not match.
- Normalizing only live ACP `tool_call` / `tool_call_update` events. Cursor reopen also converts persisted `FullSession` `ContentBlock::ToolUse` values into `StoredEntry::ToolCall`; that path must normalize before `ProjectionRegistry` validates operation provenance.
- Normalizing only operation projection. The initial session-open payload also includes a transcript snapshot, and transcript tool-entry IDs must use the same canonical-safe key as `OperationSourceLink::TranscriptLinked`.
- Calling `normalize_tool_call_id` again at the snapshot rehydration boundary on already-normalized stored IDs. The original implementation was not idempotent: it escaped `%` to `%25` to make the encoding round-trip-safe, so re-applying it turned `call_..%0Afc_..` into `call_..%250Afc_..`. Live ingress and `session_converter::cursor` already normalize at persistence time, so a second normalization at read time produces a key that no longer matches the operation projection's join key — recreating the exact orange-degraded symptom the fix was meant to resolve.

## Solution

Normalize provider tool-call IDs before they become canonical operation provenance, and make Cursor enrichment search the ACP-session store layout before the legacy chat layout.

`extract_tool_call_id` now applies one normalization function at the ACP field boundary:

```rust
pub fn extract_tool_call_id(data: &serde_json::Value) -> Result<String, ParseError> {
    data.get(TOOL_CALL_ID)
        .or_else(|| data.get(ID))
        .or_else(|| data.get(TOOL_USE_ID))
        .and_then(|v| v.as_str())
        .map(normalize_tool_call_id)
        .ok_or_else(|| ParseError::MissingField("toolCallId, id, or tool_use_id".to_string()))
}

pub fn normalize_tool_call_id(raw_id: &str) -> String {
    // Idempotent: inputs without control characters are returned unchanged. Tool-call
    // IDs are opaque provider identifiers that never legitimately contain `%`, so
    // skipping work on already-normalized inputs prevents double-encoding (`%0A` →
    // `%250A`) when this function is called along multiple boundaries (live ingress
    // + persistence + snapshot rehydration).
    if !raw_id.chars().any(char::is_control) {
        return raw_id.to_string();
    }
    let mut normalized = String::with_capacity(raw_id.len());
    for character in raw_id.chars() {
        if character == '%' {
            normalized.push_str("%25");
            continue;
        }
        if character.is_control() {
            let mut buffer = [0_u8; 4];
            for byte in character.encode_utf8(&mut buffer).as_bytes() {
                normalized.push('%');
                normalized.push_str(&format!("{byte:02X}"));
            }
            continue;
        }
        normalized.push(character);
    }
    normalized
}
```

The persisted Cursor tool-use index uses the same normalization helper:

```rust
if let ContentBlock::ToolUse { id, name, input } = block {
    index.insert(
        normalize_tool_call_id(id),
        PersistedToolUse {
            name: name.clone(),
            input: input.clone(),
        },
    );
}
```

Cursor store lookup now prefers the ACP-session layout and falls back to interactive chat history:

```rust
pub(super) async fn find_cursor_store_db_for_session(
    chats_dir: &Path,
    acp_sessions_dir: &Path,
    session_id: &str,
) -> Result<Option<PathBuf>> {
    if let Some(store_db) =
        find_acp_sessions_store_db_for_session(acp_sessions_dir, session_id).await?
    {
        return Ok(Some(store_db));
    }

    find_sqlite_store_db_for_session(chats_dir, session_id).await
}
```

Cursor provider-history restore now normalizes IDs while converting `FullSession` content blocks into stored tool-call entries, and the streaming-log overlay normalizes raw old log IDs before matching restored entries:

```rust
let normalized_id = normalize_tool_call_id(id);
let result = tool_results.get(&normalized_id).cloned();

tool_entries.push(StoredEntry::ToolCall {
    id: normalized_id.clone(),
    message: ToolCallData {
        id: normalized_id,
        // ...
    },
    timestamp: Some(msg.timestamp.clone()),
});
```

Transcript snapshots normalize stored tool-call entry IDs too, so initial open rows and canonical operations join on the same provenance key before TypeScript renders anything:

```rust
StoredEntry::ToolCall { id, message, .. } => {
    let entry_id = normalize_tool_call_id(id);
    Some(Self {
        entry_id: entry_id.clone(),
        role: TranscriptEntryRole::Tool,
        segments: vec![TranscriptSegment::Text {
            segment_id: format!("{entry_id}:tool"),
            text: message.title.clone().unwrap_or_else(|| message.name.clone()),
        }],
    })
}
```

Regression coverage should prove all three contracts:

- Cursor `tool_call` and `tool_call_update` with `call_...\nfc_...` normalize to the same `%0A` key.
- Persisted Cursor tool-use IDs are indexed by the normalized ID, so live updates recover stored `Glob` arguments.
- `get_sqlite_store_db_path_for_session` prefers `~/.cursor/acp-sessions/<session-id>/store.db` over the legacy `~/.cursor/chats` layout.
- Reopened Cursor `FullSession` tool-use IDs normalize before projection, and old streaming-log updates with raw newline IDs still overlay onto normalized restored entries.
- Session-open transcript snapshots normalize stored tool-entry IDs, so `TranscriptEntry.entry_id` matches `OperationSourceLink::TranscriptLinked.entry_id` on the first render.
- `normalize_tool_call_id` is idempotent: `normalize(normalize(id)) == normalize(id)`. Re-applying the helper at any boundary is safe and produces identical canonical join keys.

## Why This Works

The bug was a two-part integration failure:

1. Cursor emitted a valid provider-local composite ID that was not valid canonical operation provenance because it contained a control character.
2. Acepe looked for enrichment data in the wrong Cursor storage layout, and even the correct store used the raw provider ID.

Normalizing at `extract_tool_call_id` keeps the canonical graph strict while making provider IDs printable and delimiter-safe before projection. Applying the same helper to persisted Cursor tool-use IDs makes live updates and stored arguments join on one deterministic key. Applying it to transcript tool rows closes the open-time join contract: the transcript snapshot and operation snapshot now enter the frontend already aligned, instead of relying on a later resume/attach snapshot to correct mismatched IDs.

Searching `~/.cursor/acp-sessions` first restores the missing enrichment source for Acepe-launched Cursor ACP sessions. Normalizing both live events and restored history entries ensures the Agent Panel receives rich typed arguments instead of empty `rawInput`, and canonical operations no longer degrade because of invalid provenance keys on either live or reopened sessions.

## Prevention

- Normalize provider-owned IDs at the Rust parser/adapter boundary, before they enter `SessionStateGraph` or any canonical provenance key.
- Audit reopen/history converters separately from live ACP parsers. Provider-history restore can bypass live parser helpers and still feed canonical projection.
- Do not fix provider ID quirks in the TypeScript UI. Orange/degraded labels are a canonical signal, not a styling fallback to override.
- Keep one normalization function shared by live parse paths and persisted-history enrichment. Separate lookup-time normalizers will drift.
- Test provider storage layouts explicitly. Cursor ACP sessions use `~/.cursor/acp-sessions/<session-id>/store.db`; interactive Cursor chats use `~/.cursor/chats/<project-hash>/<session-id>/store.db`.
- When tool rows are sparse and degraded, inspect both sides of the join: whether the provider store was found and whether the live tool-call ID matches the persisted tool-use ID after normalization.
- For restored sessions, inspect both open payload halves: transcript `entry_id` and operation `source_link.entry_id` must already match before any attach/resume event is processed.
- Make string-transform helpers used at multiple boundaries idempotent. If a normalization function will be called at ingress + persistence + snapshot rehydration, re-applying it on already-normalized input must produce the same output. A non-idempotent helper that escapes its own escape character (`%` → `%25`) silently turns multi-boundary normalization into a corruption pipeline.

## Related Issues

- `docs/solutions/architectural/final-god-architecture-2026-04-25.md` - parent GOD rule: provider quirks stop at adapter edges; canonical operation provenance stays strict.
- `docs/solutions/best-practices/deterministic-tool-call-reconciler-2026-04-18.md` - related provider-boundary rule for tool classification and argument-shape enrichment.
- `docs/solutions/architectural/revisioned-session-graph-authority-2026-04-20.md` - canonical graph authority and per-provider provenance-key stability.
- `docs/solutions/logic-errors/operation-interaction-association-2026-04-07.md` - transport IDs are adapter metadata; do not fake transcript-operation joins by tool-call ID.
