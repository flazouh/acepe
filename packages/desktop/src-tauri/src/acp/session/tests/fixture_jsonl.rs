//! Parse historical NDJSON session-update fixtures into ingress events (test helpers).

use crate::acp::session::ingress::jsonl::parse_jsonl_file;
use crate::acp::session_thread_snapshot::SessionThreadSnapshot;
use crate::acp::session_update::tool_merge::merge_tool_call_update;
use crate::acp::session_update::{ContentChunk, SessionUpdate};
use crate::acp::types::{CanonicalAgentId, ContentBlock};
use crate::session_jsonl::types::{StoredContentBlock, StoredEntry, StoredUserMessage};
use std::collections::HashMap;
use std::path::Path;

/// Read an NDJSON fixture and parse each non-empty line into a typed [`SessionUpdate`].
pub fn parse_jsonl_fixture(path: &Path) -> Vec<SessionUpdate> {
    parse_jsonl_file(path).unwrap_or_else(|error| {
        panic!(
            "fixture not found or invalid at {}: {error}",
            path.display()
        )
    })
}

pub use crate::acp::session::ingress::jsonl::session_updates_to_provider_events;

fn user_text_from_chunk(chunk: &ContentChunk) -> Option<String> {
    match &chunk.content {
        ContentBlock::Text { text } if !text.is_empty() => Some(text.clone()),
        _ => None,
    }
}

/// Replay typed session updates into a provider-owned thread snapshot for materialization.
pub fn replay_session_updates_to_thread_snapshot(
    session_id: &str,
    updates: &[SessionUpdate],
) -> SessionThreadSnapshot {
    let mut entries = Vec::new();
    let mut tool_call_indices = HashMap::new();
    let mut next_user_index = 1usize;

    for update in updates {
        match update {
            SessionUpdate::UserMessageChunk { chunk, .. } => {
                let Some(text) = user_text_from_chunk(chunk) else {
                    continue;
                };
                let id = format!("user-{next_user_index}");
                next_user_index += 1;
                entries.push(StoredEntry::User {
                    id: id.clone(),
                    message: StoredUserMessage {
                        id: Some(id),
                        content: StoredContentBlock {
                            block_type: "text".to_string(),
                            text: Some(text),
                        },
                        chunks: Vec::new(),
                        sent_at: None,
                    },
                    timestamp: None,
                });
            }
            SessionUpdate::ToolCall { tool_call, .. } => {
                if let Some(index) = tool_call_indices.get(&tool_call.id).copied() {
                    if let StoredEntry::ToolCall { message, .. } = &mut entries[index] {
                        *message = tool_call.clone();
                    }
                } else {
                    let entry_index = entries.len();
                    tool_call_indices.insert(tool_call.id.clone(), entry_index);
                    entries.push(StoredEntry::ToolCall {
                        id: tool_call.id.clone(),
                        message: tool_call.clone(),
                        timestamp: None,
                    });
                }
            }
            SessionUpdate::ToolCallUpdate { update, .. } => {
                if let Some(index) = tool_call_indices.get(&update.tool_call_id).copied() {
                    if let StoredEntry::ToolCall { message, .. } = &mut entries[index] {
                        merge_tool_call_update(message, update);
                    }
                }
            }
            _ => {}
        }
    }

    SessionThreadSnapshot {
        entries,
        title: format!("Fixture {session_id}"),
        created_at: "2026-07-12T00:00:00Z".to_string(),
        current_mode_id: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::session::ingress::event::ProviderEventKind;
    use crate::acp::session_update::ToolCallStatus;
    use std::path::PathBuf;

    #[test]
    fn historical_tool_call_fixture_parses_and_maps_to_provider_events() {
        let fixture_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("src/acp/session/ingress/tool_identity/tests/fixtures/historical-tool-call-session.jsonl");
        let updates = parse_jsonl_fixture(&fixture_path);
        assert_eq!(updates.len(), 4);

        let events = session_updates_to_provider_events(CanonicalAgentId::ClaudeCode, &updates);
        assert_eq!(events.len(), 4);
        assert!(events.iter().any(|event| {
            matches!(
                &event.kind,
                ProviderEventKind::ToolCall(tool_call)
                    if tool_call.id == "call-read-1"
            )
        }));
        assert!(events.iter().any(|event| {
            matches!(
                &event.kind,
                ProviderEventKind::ToolCallUpdate(update)
                    if update.tool_call_id == "call-read-1"
                        && update.status == Some(ToolCallStatus::Completed)
            )
        }));
    }
}
