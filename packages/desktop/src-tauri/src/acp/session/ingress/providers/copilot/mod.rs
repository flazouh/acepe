//! Copilot history ingress — events.jsonl → ordered `ProviderEvent` stream.
//!
//! Production replay routes `events.jsonl` → `ProviderEventReplayAccumulator` →
//! ordered `ProviderEvent` stream (no `StoredEntry` or `SessionThreadSnapshot` on ingress).
//! The accumulator merges duplicate tool-call rows, applies todo timing, and drops
//! `AgentThoughtChunk` updates before fold replay.

pub mod copilot_history;
mod disk;

pub use disk::load_provider_events_from_disk;

use std::path::PathBuf;

use crate::acp::session::ingress::event::ProviderEvent;
use crate::acp::session::ingress::source::{HistoryError, HistoryInput, HistorySource};
use crate::acp::session_descriptor::SessionReplayContext;

/// Reads Copilot `events.jsonl` history into provider-agnostic ingress events.
pub struct CopilotHistorySource;

impl HistorySource for CopilotHistorySource {
    fn read(&self, input: HistoryInput) -> Result<Vec<ProviderEvent>, HistoryError> {
        let source_path = resolve_source_path(&input)?;
        let title = fallback_title(&input.session_id);
        block_on_async(load_provider_events_from_disk(
            &input.session_id,
            source_path.as_deref(),
            &title,
        ))
        .map_err(HistoryError::InvalidFormat)
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

/// Load Copilot history events for production replay.
pub async fn load_replay_events(
    replay_context: &SessionReplayContext,
) -> Result<Vec<ProviderEvent>, HistoryError> {
    let input = HistoryInput {
        session_id: replay_context.history_session_id.clone(),
        workspace_root: replay_context.source_path.as_ref().map(PathBuf::from),
    };
    let source_path = resolve_source_path(&input)?;
    let title = fallback_title(&input.session_id);
    load_provider_events_from_disk(&input.session_id, source_path.as_deref(), &title)
        .await
        .map_err(HistoryError::InvalidFormat)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::parsers::AgentType;
    use crate::acp::session::ingress::event::ProviderEventKind;
    use crate::acp::session_descriptor::{SessionDescriptorCompatibility, SessionReplayContext};
    use crate::acp::session_update::{
        ContentChunk, ToolArguments, ToolCallData, ToolCallStatus, ToolCallUpdateData, ToolKind,
    };
    use crate::acp::types::ContentBlock;
    use crate::copilot_history::convert_replay_updates_to_provider_events;

    #[test]
    fn copilot_history_source_maps_replay_entries_to_provider_events() {
        const SESSION_ID: &str = "copilot-session-1";
        let events = convert_replay_updates_to_provider_events(&[
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
        ]);

        assert_eq!(events.len(), 2);
        assert!(matches!(
            &events[0].kind,
            ProviderEventKind::UserText { text, .. } if text == "Summarize the repo"
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
    fn direct_provider_event_mapping_skips_thought_chunks() {
        const SESSION_ID: &str = "copilot-session-thought";
        let events = convert_replay_updates_to_provider_events(&[
            (
                1_710_000_020_000,
                crate::acp::session_update::SessionUpdate::AgentThoughtChunk {
                    chunk: ContentChunk {
                        content: ContentBlock::Text {
                            text: "Investigating codebase options".to_string(),
                        },
                        aggregation_hint: None,
                    },
                    part_id: None,
                    message_id: Some("assistant-1".to_string()),
                    parent_tool_use_id: None,
                    session_id: Some(SESSION_ID.to_string()),
                },
            ),
            (
                1_710_000_020_500,
                crate::acp::session_update::SessionUpdate::AgentMessageChunk {
                    chunk: ContentChunk {
                        content: ContentBlock::Text {
                            text: "I found the replay path.".to_string(),
                        },
                        aggregation_hint: None,
                    },
                    part_id: None,
                    message_id: Some("assistant-1".to_string()),
                    parent_tool_use_id: None,
                    session_id: Some(SESSION_ID.to_string()),
                    produced_at_monotonic_ms: None,
                },
            ),
        ]);

        assert_eq!(events.len(), 1);
        assert!(matches!(
            &events[0].kind,
            ProviderEventKind::AssistantText { text, .. } if text == "I found the replay path."
        ));
    }

    #[tokio::test]
    async fn copilot_replay_returns_an_error_inside_an_active_tokio_runtime() {
        let replay_context = SessionReplayContext {
            local_session_id: "copilot-nested-runtime".to_string(),
            history_session_id: "copilot-nested-runtime".to_string(),
            agent_id: crate::acp::types::CanonicalAgentId::Copilot,
            parser_agent_type: AgentType::Copilot,
            project_path: "/project".to_string(),
            worktree_path: None,
            effective_cwd: "/project".to_string(),
            source_path: None,
            compatibility: SessionDescriptorCompatibility::Canonical,
        };

        let result = load_replay_events(&replay_context).await;

        assert!(result.is_err());
    }
}
