//! OpenCode message → ingress events and fold-backed session snapshots.

use crate::acp::parsers::AgentType;
use crate::acp::session::fold_export::{
    materialized_thread_snapshot_from_history_events, provider_owned_snapshot_from_materialized,
    MaterializedThreadSnapshot,
};
use crate::acp::session::ingress::canonical_events::canonical_transcript_events_to_provider_events;
use crate::acp::session::ingress::event::ProviderEvent;
use crate::acp::session_thread_snapshot::ProviderOwnedSessionSnapshot;
use crate::acp::transcript_projection::{CanonicalTranscriptEvent, CanonicalTranscriptEventKind};
use crate::acp::types::CanonicalAgentId;
use crate::opencode_history::types::{OpenCodeMessage, OpenCodeMessagePart};

/// Map OpenCode messages to ordered ingress `ProviderEvent`s (no legacy entry DTO intermediate).
pub fn opencode_messages_to_provider_events(messages: &[OpenCodeMessage]) -> Vec<ProviderEvent> {
    let canonical = materialize_opencode_canonical_transcript_events(messages);
    canonical_transcript_events_to_provider_events(
        &canonical,
        CanonicalAgentId::OpenCode,
        AgentType::OpenCode,
    )
}

/// Fold OpenCode messages into materialized transcript + projection (ingress → fold spine).
pub fn materialized_thread_snapshot_from_opencode_messages(
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

/// Fold OpenCode messages into a provider-owned snapshot via the ingress event path.
pub fn provider_owned_snapshot_from_opencode_messages(
    session_id: &str,
    project_path: &str,
    messages: Vec<OpenCodeMessage>,
    title_override: Option<String>,
) -> Result<ProviderOwnedSessionSnapshot, String> {
    let canonical = materialize_opencode_canonical_transcript_events(&messages);
    let title = title_override.unwrap_or_else(|| opencode_title_from_messages(&messages));
    let materialized = materialized_thread_snapshot_from_opencode_messages(
        session_id,
        project_path,
        &messages,
        None,
    );
    Ok(provider_owned_snapshot_from_materialized(
        &materialized,
        title,
        canonical,
    ))
}

pub(crate) fn materialize_opencode_canonical_transcript_events(
    messages: &[OpenCodeMessage],
) -> Vec<CanonicalTranscriptEvent> {
    let mut events = Vec::new();
    let mut transcript_seq = 0_u64;

    for (message_index, msg) in messages.iter().enumerate() {
        for (block_index, part) in msg.parts.iter().enumerate() {
            let timestamp = msg.timestamp.clone().unwrap_or_default();
            let maybe_event = match part {
                OpenCodeMessagePart::Text { text }
                    if msg.role == "user" && !text.trim().is_empty() =>
                {
                    Some(CanonicalTranscriptEvent {
                        transcript_seq,
                        source: AgentType::OpenCode,
                        provider_row_id: msg.id.clone(),
                        provider_msg_id: Some(msg.id.clone()),
                        request_id: None,
                        block_index,
                        display_id: opencode_text_display_id(message_index, "user"),
                        timestamp,
                        model: msg.model.clone(),
                        kind: CanonicalTranscriptEventKind::UserText { text: text.clone() },
                    })
                }
                OpenCodeMessagePart::Text { text }
                    if msg.role == "assistant" && !text.trim().is_empty() =>
                {
                    Some(CanonicalTranscriptEvent {
                        transcript_seq,
                        source: AgentType::OpenCode,
                        provider_row_id: msg.id.clone(),
                        provider_msg_id: Some(msg.id.clone()),
                        request_id: None,
                        block_index,
                        display_id: opencode_text_display_id(message_index, "assistant"),
                        timestamp,
                        model: msg.model.clone(),
                        kind: CanonicalTranscriptEventKind::AssistantText {
                            text: text.clone(),
                            parent_tool_use_id: None,
                        },
                    })
                }
                OpenCodeMessagePart::ToolInvocation {
                    id, name, input, ..
                } if msg.role == "assistant" => Some(CanonicalTranscriptEvent {
                    transcript_seq,
                    source: AgentType::OpenCode,
                    provider_row_id: msg.id.clone(),
                    provider_msg_id: Some(msg.id.clone()),
                    request_id: None,
                    block_index,
                    display_id: id.clone(),
                    timestamp,
                    model: msg.model.clone(),
                    kind: CanonicalTranscriptEventKind::ToolUse {
                        tool_call_id: id.clone(),
                        name: name.clone(),
                        input: input.clone(),
                        parent_tool_use_id: None,
                    },
                }),
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

fn opencode_text_display_id(message_index: usize, role: &str) -> String {
    format!("opencode-event-{message_index}:{role}")
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
    use crate::acp::parsers::AgentType;
    use crate::acp::session::fold_export::materialized_thread_snapshot_from_provider_fold_first;
    use crate::acp::session_descriptor::{SessionDescriptorCompatibility, SessionReplayContext};
    use crate::acp::transcript_projection::{TranscriptEntryRole, TranscriptSegment};
    use crate::acp::types::CanonicalAgentId;

    fn opencode_replay_context(session_id: &str) -> SessionReplayContext {
        SessionReplayContext {
            local_session_id: session_id.to_string(),
            history_session_id: session_id.to_string(),
            agent_id: CanonicalAgentId::OpenCode,
            parser_agent_type: AgentType::OpenCode,
            project_path: "/test/project".to_string(),
            worktree_path: None,
            effective_cwd: "/test/project".to_string(),
            source_path: None,
            compatibility: SessionDescriptorCompatibility::Canonical,
        }
    }

    #[test]
    fn opencode_provider_owned_snapshot_promotes_canonical_transcript_events() {
        let snapshot = provider_owned_snapshot_from_opencode_messages(
            "session-1",
            "/test/project",
            vec![
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
            ],
            None,
        )
        .expect("OpenCode messages should convert");

        assert_eq!(snapshot.canonical_transcript_events.len(), 2);

        let materialized = materialized_thread_snapshot_from_provider_fold_first(
            "session-1",
            &opencode_replay_context("session-1"),
            &snapshot,
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
    fn opencode_canonical_events_keep_provider_id_out_of_display_identity() {
        let snapshot = provider_owned_snapshot_from_opencode_messages(
            "session-1",
            "/test/project",
            vec![
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
            ],
            None,
        )
        .expect("OpenCode messages should convert");

        let provider_msg_ids: Vec<Option<&str>> = snapshot
            .canonical_transcript_events
            .iter()
            .map(|event| event.provider_msg_id.as_deref())
            .collect();
        let event_display_ids: Vec<&str> = snapshot
            .canonical_transcript_events
            .iter()
            .map(|event| event.display_id.as_str())
            .collect();

        assert_eq!(
            provider_msg_ids,
            vec![
                Some("provider-reused-message"),
                Some("provider-reused-message"),
                Some("provider-reused-message")
            ]
        );
        assert_eq!(
            event_display_ids,
            vec![
                "opencode-event-0:assistant",
                "toolu_read",
                "opencode-event-2:assistant"
            ]
        );

        let materialized = materialized_thread_snapshot_from_provider_fold_first(
            "session-1",
            &opencode_replay_context("session-1"),
            &snapshot,
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
