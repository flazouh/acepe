//! OpenCode message → ingress events and fold-backed session snapshots.

use crate::acp::parsers::AgentType;
use crate::acp::session::fold_export::{
    materialized_thread_snapshot_from_history_events, MaterializedThreadSnapshot,
};
use crate::acp::session::ingress::event::{ProviderEvent, ProviderEventKind};
use crate::acp::session_update::{build_tool_call_from_raw, RawToolCallInput, ToolCallStatus};
use crate::acp::types::CanonicalAgentId;
use crate::opencode_history::types::{OpenCodeMessage, OpenCodeMessagePart};

/// Map OpenCode messages to ordered ingress `ProviderEvent`s (no legacy entry DTO intermediate).
pub fn opencode_messages_to_provider_events(messages: &[OpenCodeMessage]) -> Vec<ProviderEvent> {
    materialize_opencode_provider_events(messages)
}

/// Fold OpenCode messages into materialized transcript + projection (ingress → fold spine).
pub(crate) fn materialized_thread_snapshot_from_opencode_messages(
    session_id: &str,
    project_path: &str,
    messages: &[OpenCodeMessage],
    title_override: Option<String>,
) -> MaterializedThreadSnapshot {
    let events = opencode_messages_to_provider_events(messages);
    let title = title_override.unwrap_or_else(|| opencode_title_from_messages(messages));
    materialized_thread_snapshot_from_history_events(
        session_id,
        &CanonicalAgentId::OpenCode,
        project_path,
        &events,
        title,
        0,
    )
}

pub(crate) fn materialize_opencode_provider_events(
    messages: &[OpenCodeMessage],
) -> Vec<ProviderEvent> {
    let mut events = Vec::new();
    let mut transcript_seq = 0_u64;

    for msg in messages {
        for part in &msg.parts {
            let timestamp = msg.timestamp.clone().unwrap_or_default();
            let maybe_event = match part {
                OpenCodeMessagePart::Text { text }
                    if msg.role == "user" && !text.trim().is_empty() =>
                {
                    Some(ProviderEvent {
                        provider_seq: transcript_seq,
                        source: CanonicalAgentId::OpenCode,
                        provider_row_id: msg.id.clone(),
                        timestamp_ms: parse_timestamp_to_millis(&timestamp),
                        kind: ProviderEventKind::UserText {
                            text: text.clone(),
                            attempt_id: None,
                        },
                    })
                }
                OpenCodeMessagePart::Text { text }
                    if msg.role == "assistant" && !text.trim().is_empty() =>
                {
                    Some(ProviderEvent {
                        provider_seq: transcript_seq,
                        source: CanonicalAgentId::OpenCode,
                        provider_row_id: msg.id.clone(),
                        timestamp_ms: parse_timestamp_to_millis(&timestamp),
                        kind: ProviderEventKind::AssistantText { text: text.clone() },
                    })
                }
                OpenCodeMessagePart::ToolInvocation {
                    id, name, input, ..
                } if msg.role == "assistant" => {
                    let tool_call = build_tool_call_from_raw(
                        crate::acp::parsers::get_parser(AgentType::OpenCode),
                        RawToolCallInput {
                            id: id.clone(),
                            name: Some(name.clone()),
                            arguments: input.clone(),
                            status: ToolCallStatus::Pending,
                            kind: None,
                            title: Some(name.clone()),
                            suppress_title_read_path_hint: false,
                            parent_tool_use_id: None,
                            task_children: None,
                        },
                    );
                    Some(ProviderEvent {
                        provider_seq: transcript_seq,
                        source: CanonicalAgentId::OpenCode,
                        provider_row_id: id.clone(),
                        timestamp_ms: parse_timestamp_to_millis(&timestamp),
                        kind: ProviderEventKind::ToolCall(tool_call),
                    })
                }
                OpenCodeMessagePart::Text { .. }
                | OpenCodeMessagePart::ToolInvocation { .. }
                | OpenCodeMessagePart::ToolResult { .. } => None,
            };

            if let Some(event) = maybe_event {
                events.push(event);
                transcript_seq += 1;
            }
        }
    }

    events
}

fn parse_timestamp_to_millis(timestamp: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(timestamp)
        .ok()
        .map(|value| value.timestamp_millis())
}

fn opencode_title_from_messages(messages: &[OpenCodeMessage]) -> String {
    messages
        .iter()
        .find(|message| message.role == "user")
        .and_then(|message| {
            message.parts.iter().find_map(|part| {
                if let OpenCodeMessagePart::Text { text } = part {
                    Some(text.chars().take(50).collect::<String>())
                } else {
                    None
                }
            })
        })
        .unwrap_or_else(|| "OpenCode Session".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::session::fold_export::materialized_thread_snapshot_from_history_events;
    use crate::acp::transcript_projection::{TranscriptEntryRole, TranscriptSegment};

    #[test]
    fn opencode_messages_emit_provider_events_that_fold_to_canonical_transcript() {
        let events = opencode_messages_to_provider_events(&[
            OpenCodeMessage {
                id: "provider-user-message".to_string(),
                role: "user".to_string(),
                parts: vec![OpenCodeMessagePart::Text {
                    text: "Inspect this".to_string(),
                }],
                model: None,
                timestamp: Some("1000".to_string()),
            },
            OpenCodeMessage {
                id: "provider-assistant-message".to_string(),
                role: "assistant".to_string(),
                parts: vec![OpenCodeMessagePart::Text {
                    text: "Looks good".to_string(),
                }],
                model: Some("openai/gpt-5".to_string()),
                timestamp: Some("1001".to_string()),
            },
        ]);

        assert_eq!(events.len(), 2);

        let materialized = materialized_thread_snapshot_from_history_events(
            "session-1",
            &CanonicalAgentId::OpenCode,
            "/test/project",
            &events,
            "Session session-1".to_string(),
            7,
        );

        assert_eq!(materialized.transcript_snapshot.entries.len(), 2);
        assert_eq!(
            materialized.transcript_snapshot.entries[1].entry_id,
            "acepe::entry::assistant-boundary:1::assistant::."
        );
        assert_eq!(
            materialized.transcript_snapshot.entries[1].role,
            TranscriptEntryRole::Assistant
        );
        assert_eq!(
            materialized.transcript_snapshot.entries[1].segments,
            vec![TranscriptSegment::Text {
                segment_id: "acepe::entry::assistant-boundary:1::assistant::.:segment:1"
                    .to_string(),
                text: "Looks good".to_string(),
            }]
        );
    }

    #[test]
    fn opencode_provider_events_keep_provider_id_out_of_display_identity() {
        let events = opencode_messages_to_provider_events(&[
            OpenCodeMessage {
                id: "provider-reused-message".to_string(),
                role: "assistant".to_string(),
                parts: vec![OpenCodeMessagePart::Text {
                    text: "I will inspect it first.".to_string(),
                }],
                model: Some("openai/gpt-5".to_string()),
                timestamp: Some("1001".to_string()),
            },
            OpenCodeMessage {
                id: "provider-reused-message".to_string(),
                role: "assistant".to_string(),
                parts: vec![OpenCodeMessagePart::ToolInvocation {
                    id: "toolu_read".to_string(),
                    name: "Read".to_string(),
                    input: serde_json::json!({ "file_path": "/tmp/a" }),
                    state: None,
                }],
                model: Some("openai/gpt-5".to_string()),
                timestamp: Some("1002".to_string()),
            },
            OpenCodeMessage {
                id: "provider-reused-message".to_string(),
                role: "assistant".to_string(),
                parts: vec![OpenCodeMessagePart::Text {
                    text: "The file is clean.".to_string(),
                }],
                model: Some("openai/gpt-5".to_string()),
                timestamp: Some("1003".to_string()),
            },
        ]);

        let provider_row_ids: Vec<&str> = events
            .iter()
            .map(|event| event.provider_row_id.as_str())
            .collect();

        assert_eq!(
            provider_row_ids,
            vec![
                "provider-reused-message",
                "toolu_read",
                "provider-reused-message"
            ]
        );

        let materialized = materialized_thread_snapshot_from_history_events(
            "session-1",
            &CanonicalAgentId::OpenCode,
            "/test/project",
            &events,
            "Session session-1".to_string(),
            7,
        );
        let entry_ids: Vec<&str> = materialized
            .transcript_snapshot
            .entries
            .iter()
            .map(|entry| entry.entry_id.as_str())
            .collect();

        assert_eq!(
            entry_ids,
            vec![
                "acepe::entry::session-start::assistant::.",
                "acepe::entry::session-start::tool::toolu_read",
                "acepe::entry::assistant-boundary:2::assistant::.",
            ]
        );
        assert!(entry_ids
            .iter()
            .all(|entry_id| !entry_id.contains("provider-reused-message")));
    }
}
