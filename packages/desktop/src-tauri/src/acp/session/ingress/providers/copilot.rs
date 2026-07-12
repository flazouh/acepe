//! Copilot history ingress — events.jsonl → ordered `ProviderEvent` stream.

use std::path::PathBuf;

use crate::acp::session::ingress::event::{ProviderEvent, ProviderEventKind};
use crate::acp::session::ingress::source::{HistoryError, HistoryInput, HistorySource};
use crate::acp::session_descriptor::SessionReplayContext;
use crate::acp::session_update::TurnErrorKind;
use crate::acp::types::CanonicalAgentId;
use crate::cc_sdk::AssistantMessageError;
use crate::copilot_history::load_thread_snapshot_from_disk;
use crate::session_jsonl::types::StoredEntry;

/// Reads Copilot `events.jsonl` history into provider-agnostic ingress events.
pub struct CopilotHistorySource;

impl HistorySource for CopilotHistorySource {
    fn read(&self, input: HistoryInput) -> Result<Vec<ProviderEvent>, HistoryError> {
        let source_path = resolve_source_path(&input)?;
        let title = fallback_title(&input.session_id);
        let snapshot = block_on_async(load_thread_snapshot_from_disk(
            &input.session_id,
            source_path.as_deref(),
            &title,
        ))
        .map_err(|error| HistoryError::InvalidFormat(error))?;

        Ok(stored_entries_to_provider_events(
            &snapshot.entries,
            CanonicalAgentId::Copilot,
        ))
    }
}

fn block_on_async<F: std::future::Future>(future: F) -> F::Output {
    if let Ok(handle) = tokio::runtime::Handle::try_current() {
        handle.block_on(future)
    } else {
        tokio::runtime::Runtime::new()
            .expect("tokio runtime for Copilot history ingress")
            .block_on(future)
    }
}

fn fallback_title(session_id: &str) -> String {
    let short_id = &session_id[..8.min(session_id.len())];
    format!("Session {short_id}")
}

/// Resolve transcript path override from history input.
fn resolve_source_path(input: &HistoryInput) -> Result<Option<String>, HistoryError> {
    let Some(root) = &input.workspace_root else {
        return Ok(None);
    };

    if root.is_file() {
        return Ok(Some(root.display().to_string()));
    }

    if root.is_dir() {
        let direct = root.join("events.jsonl");
        if direct.is_file() {
            return Ok(Some(direct.display().to_string()));
        }

        let nested = root.join(&input.session_id).join("events.jsonl");
        if nested.is_file() {
            return Ok(Some(nested.display().to_string()));
        }
    }

    Ok(None)
}

pub(crate) fn stored_entries_to_provider_events(
    entries: &[StoredEntry],
    source: CanonicalAgentId,
) -> Vec<ProviderEvent> {
    let mut events = Vec::new();
    let mut provider_seq = 0_u64;

    for entry in entries {
        match entry {
            StoredEntry::User {
                id,
                message,
                timestamp,
            } => {
                if let Some(text) = message
                    .content
                    .text
                    .as_ref()
                    .filter(|text| !text.trim().is_empty())
                {
                    provider_seq += 1;
                    events.push(ProviderEvent {
                        source: source.clone(),
                        provider_seq,
                        provider_row_id: id.clone(),
                        timestamp_ms: parse_timestamp_to_millis(timestamp.as_deref()),
                        kind: ProviderEventKind::UserText { text: text.clone() },
                    });
                }
            }
            StoredEntry::Assistant {
                id,
                message,
                timestamp,
            } => {
                for chunk in &message.chunks {
                    let Some(text) = chunk
                        .block
                        .text
                        .as_ref()
                        .filter(|text| !text.trim().is_empty())
                    else {
                        continue;
                    };

                    provider_seq += 1;
                    let kind = if chunk.chunk_type == "thought" {
                        ProviderEventKind::AssistantThought {
                            text: text.clone(),
                            redacted: None,
                        }
                    } else {
                        ProviderEventKind::AssistantText { text: text.clone() }
                    };

                    events.push(ProviderEvent {
                        source: source.clone(),
                        provider_seq,
                        provider_row_id: id.clone(),
                        timestamp_ms: parse_timestamp_to_millis(timestamp.as_deref()),
                        kind,
                    });
                }
            }
            StoredEntry::ToolCall {
                id,
                message,
                timestamp,
            } => {
                provider_seq += 1;
                events.push(ProviderEvent {
                    source: source.clone(),
                    provider_seq,
                    provider_row_id: id.clone(),
                    timestamp_ms: parse_timestamp_to_millis(timestamp.as_deref()),
                    kind: ProviderEventKind::ToolCall(message.clone()),
                });
            }
            StoredEntry::Error {
                id,
                message,
                timestamp,
            } => {
                provider_seq += 1;
                events.push(ProviderEvent {
                    source: source.clone(),
                    provider_seq,
                    provider_row_id: id.clone(),
                    timestamp_ms: parse_timestamp_to_millis(timestamp.as_deref()),
                    kind: ProviderEventKind::AssistantError {
                        text: message.content.clone(),
                        error: assistant_message_error_from_stored(message),
                    },
                });
            }
        }
    }

    events
}

fn assistant_message_error_from_stored(
    message: &crate::session_jsonl::types::StoredErrorMessage,
) -> AssistantMessageError {
    if message.code.as_deref() == Some("429") {
        return AssistantMessageError::RateLimit;
    }

    match message.kind {
        TurnErrorKind::Fatal => AssistantMessageError::InvalidRequest,
        TurnErrorKind::Recoverable => AssistantMessageError::Unknown,
    }
}

fn parse_timestamp_to_millis(timestamp: Option<&str>) -> Option<i64> {
    timestamp.and_then(|value| {
        chrono::DateTime::parse_from_rfc3339(value)
            .ok()
            .map(|dt| dt.timestamp_millis())
    })
}

/// Load Copilot history events for production replay.
pub async fn load_replay_events(
    replay_context: &SessionReplayContext,
) -> Result<Vec<ProviderEvent>, HistoryError> {
    let source = CopilotHistorySource;
    source.read(HistoryInput {
        session_id: replay_context.history_session_id.clone(),
        workspace_root: replay_context.source_path.as_ref().map(PathBuf::from),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::session::ingress::event::ProviderEventKind;
    use crate::acp::session_update::{
        ContentChunk, ToolArguments, ToolCallData, ToolCallStatus, ToolCallUpdateData, ToolKind,
    };
    use crate::acp::types::ContentBlock;
    use crate::copilot_history::convert_replay_updates_to_session;
    use crate::session_jsonl::types::StoredEntry;

    #[test]
    fn copilot_history_source_maps_replay_entries_to_provider_events() {
        const SESSION_ID: &str = "copilot-session-1";
        let snapshot = convert_replay_updates_to_session(
            SESSION_ID,
            "Copilot Session",
            &[
                (
                    1_710_000_000_000,
                    crate::acp::session_update::SessionUpdate::UserMessageChunk {
                        chunk: ContentChunk {
                            content: ContentBlock::Text {
                                text: "Summarize the repo".to_string(),
                            },
                            aggregation_hint: None,
                        },
                        session_id: Some(SESSION_ID.to_string()),
                        attempt_id: None,
                    },
                ),
                (
                    1_710_000_001_000,
                    crate::acp::session_update::SessionUpdate::ToolCall {
                        tool_call: ToolCallData {
                            id: "tool-1".to_string(),
                            name: "Read".to_string(),
                            arguments: ToolArguments::Read {
                                file_path: Some("/repo/README.md".to_string()),
                                source_context: None,
                            },
                            diagnostic_input: None,
                            status: ToolCallStatus::Pending,
                            result: None,
                            kind: Some(ToolKind::Read),
                            title: Some("Read README".to_string()),
                            locations: None,
                            skill_meta: None,
                            normalized_questions: None,
                            normalized_todos: None,
                            normalized_todo_update: None,
                            parent_tool_use_id: None,
                            task_children: None,
                            question_answer: None,
                            awaiting_plan_approval: false,
                            plan_approval_request_id: None,
                        },
                        session_id: Some(SESSION_ID.to_string()),
                    },
                ),
                (
                    1_710_000_001_500,
                    crate::acp::session_update::SessionUpdate::ToolCallUpdate {
                        update: ToolCallUpdateData {
                            tool_call_id: "tool-1".to_string(),
                            status: Some(ToolCallStatus::Completed),
                            result: Some(serde_json::json!({ "ok": true })),
                            ..Default::default()
                        },
                        session_id: Some(SESSION_ID.to_string()),
                    },
                ),
            ],
        );

        let events =
            stored_entries_to_provider_events(&snapshot.entries, CanonicalAgentId::Copilot);

        assert_eq!(events.len(), 2);
        assert!(matches!(
            &events[0].kind,
            ProviderEventKind::UserText { text } if text == "Summarize the repo"
        ));
        match &events[1].kind {
            ProviderEventKind::ToolCall(tool_call) => {
                assert_eq!(tool_call.id, "tool-1");
                assert_eq!(tool_call.status, ToolCallStatus::Completed);
                assert_eq!(tool_call.result, Some(serde_json::json!({ "ok": true })));
            }
            other => panic!("expected tool call event, got {other:?}"),
        }
    }

    #[test]
    fn stored_entries_mapping_emits_assistant_thought_chunks() {
        let entries = vec![StoredEntry::Assistant {
            id: "assistant-1".to_string(),
            message: crate::session_jsonl::types::StoredAssistantMessage {
                chunks: vec![
                    crate::session_jsonl::types::StoredAssistantChunk {
                        chunk_type: "thought".to_string(),
                        block: crate::session_jsonl::types::StoredContentBlock {
                            block_type: "text".to_string(),
                            text: Some("thinking".to_string()),
                        },
                    },
                    crate::session_jsonl::types::StoredAssistantChunk {
                        chunk_type: "message".to_string(),
                        block: crate::session_jsonl::types::StoredContentBlock {
                            block_type: "text".to_string(),
                            text: Some("answer".to_string()),
                        },
                    },
                ],
                model: None,
                display_model: None,
                received_at: None,
            },
            timestamp: None,
        }];

        let events = stored_entries_to_provider_events(&entries, CanonicalAgentId::Copilot);
        assert_eq!(events.len(), 2);
        assert!(matches!(
            &events[0].kind,
            ProviderEventKind::AssistantThought { text, .. } if text == "thinking"
        ));
        assert!(matches!(
            &events[1].kind,
            ProviderEventKind::AssistantText { text } if text == "answer"
        ));
    }
}
