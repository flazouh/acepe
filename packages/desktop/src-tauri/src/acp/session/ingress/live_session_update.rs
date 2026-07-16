//! Live `SessionUpdate` → ingress `ProviderEvent` mapping (shared by live and replay paths).

use crate::acp::projections::RouteDecision;
use crate::acp::session::ingress::event::{ProviderEvent, ProviderEventKind};
use crate::acp::session_update::{ContentChunk, SessionUpdate};
use crate::acp::types::{CanonicalAgentId, ContentBlock};

/// Map one live session update into zero or one provider event.
///
/// Respects terminal-turn routing (`ignore_late`, `suppress`) the same way the legacy
/// transcript runtime did before fold cutover.
#[must_use]
pub fn session_update_to_provider_event(
    source: CanonicalAgentId,
    event_seq: i64,
    update: &SessionUpdate,
    decision: RouteDecision,
) -> Option<ProviderEvent> {
    if decision.ignore_late {
        if matches!(
            update,
            SessionUpdate::TurnError { .. } | SessionUpdate::TurnComplete { .. }
        ) {
            return None;
        }
    }
    if decision.suppress {
        if matches!(
            update,
            SessionUpdate::AgentMessageChunk { .. }
                | SessionUpdate::AgentThoughtChunk { .. }
                | SessionUpdate::ToolCall { .. }
                | SessionUpdate::ToolCallUpdate { .. }
        ) {
            return None;
        }
    }

    let provider_seq = u64::try_from(event_seq.max(0)).unwrap_or(0);
    let provider_row_id = provider_row_id_for_live_update(event_seq, update);

    let kind = match update {
        SessionUpdate::UserMessageChunk {
            chunk, attempt_id, ..
        } => {
            let text = user_text_from_chunk(chunk)?;
            ProviderEventKind::UserText {
                text,
                attempt_id: attempt_id.clone(),
            }
        }
        SessionUpdate::AgentMessageChunk {
            chunk,
            parent_tool_use_id,
            ..
        } => {
            let text = assistant_text_from_chunk(chunk)?;
            ProviderEventKind::AssistantText {
                text,
                parent_tool_use_id: parent_tool_use_id.clone(),
            }
        }
        SessionUpdate::AgentThoughtChunk {
            chunk,
            parent_tool_use_id,
            ..
        } => {
            let text = assistant_text_from_chunk(chunk)?;
            ProviderEventKind::AssistantThought {
                text,
                redacted: None,
                parent_tool_use_id: parent_tool_use_id.clone(),
            }
        }
        SessionUpdate::ToolCall { tool_call, .. } => ProviderEventKind::ToolCall(tool_call.clone()),
        SessionUpdate::ToolCallUpdate { update, .. } => {
            ProviderEventKind::ToolCallUpdate(update.clone())
        }
        SessionUpdate::CompactionEvent { event, .. } => {
            ProviderEventKind::Compaction(event.clone())
        }
        _ => return None,
    };

    Some(ProviderEvent {
        source,
        provider_seq,
        provider_row_id,
        timestamp_ms: None,
        kind,
    })
}

/// Map replayed history session updates (no live routing guard).
#[must_use]
pub fn session_updates_to_provider_events(
    source: CanonicalAgentId,
    updates: &[SessionUpdate],
) -> Vec<ProviderEvent> {
    updates
        .iter()
        .enumerate()
        .filter_map(|(index, update)| {
            let event_seq = i64::try_from(index + 1).unwrap_or(i64::MAX);
            session_update_to_provider_event(
                source.clone(),
                event_seq,
                update,
                RouteDecision::default(),
            )
            .or_else(|| history_fallback_event(source.clone(), index, update))
        })
        .collect()
}

fn history_fallback_event(
    source: CanonicalAgentId,
    index: usize,
    update: &SessionUpdate,
) -> Option<ProviderEvent> {
    let provider_seq = index as u64 + 1;
    let provider_row_id = provider_row_id_for_history_update(index, update);

    let kind = match update {
        SessionUpdate::UserMessageChunk {
            chunk, attempt_id, ..
        } => {
            let text = user_text_from_chunk(chunk)?;
            ProviderEventKind::UserText {
                text,
                attempt_id: attempt_id.clone(),
            }
        }
        SessionUpdate::ToolCall { tool_call, .. } => ProviderEventKind::ToolCall(tool_call.clone()),
        SessionUpdate::ToolCallUpdate { update, .. } => {
            ProviderEventKind::ToolCallUpdate(update.clone())
        }
        _ => return None,
    };

    Some(ProviderEvent {
        source,
        provider_seq,
        provider_row_id,
        timestamp_ms: None,
        kind,
    })
}

/// Re-stamp a pre-normalized live ingress event with the journaled event sequence.
#[must_use]
pub fn restamp_live_provider_event(
    mut event: ProviderEvent,
    event_seq: i64,
    update: &SessionUpdate,
) -> ProviderEvent {
    event.provider_seq = u64::try_from(event_seq.max(0)).unwrap_or(0);
    event.provider_row_id = provider_row_id_for_live_update(event_seq, update);
    event
}

fn provider_row_id_for_live_update(event_seq: i64, update: &SessionUpdate) -> String {
    match update {
        SessionUpdate::ToolCall { tool_call, .. } => format!("{}:{event_seq}", tool_call.id),
        SessionUpdate::ToolCallUpdate { update, .. } => {
            format!("{}:update:{event_seq}", update.tool_call_id)
        }
        SessionUpdate::UserMessageChunk { .. } => format!("user:{event_seq}"),
        SessionUpdate::AgentMessageChunk {
            message_id,
            part_id,
            ..
        } => format!(
            "assistant:{}:{}:{event_seq}",
            message_id.as_deref().unwrap_or("msg"),
            part_id.as_deref().unwrap_or("part")
        ),
        SessionUpdate::AgentThoughtChunk {
            message_id,
            part_id,
            ..
        } => format!(
            "thought:{}:{}:{event_seq}",
            message_id.as_deref().unwrap_or("msg"),
            part_id.as_deref().unwrap_or("part")
        ),
        SessionUpdate::CompactionEvent { event, .. } => {
            format!("compaction:{}:{event_seq}", event.event_id)
        }
        _ => format!("row:{event_seq}"),
    }
}

fn provider_row_id_for_history_update(index: usize, update: &SessionUpdate) -> String {
    match update {
        SessionUpdate::ToolCall { tool_call, .. } => tool_call.id.clone(),
        SessionUpdate::ToolCallUpdate { update, .. } => format!("{}:update", update.tool_call_id),
        SessionUpdate::UserMessageChunk { .. } => format!("user-{index}"),
        _ => format!("row-{index}"),
    }
}

fn user_text_from_chunk(chunk: &ContentChunk) -> Option<String> {
    match &chunk.content {
        ContentBlock::Text { text } if !text.is_empty() => Some(text.clone()),
        _ => None,
    }
}

fn assistant_text_from_chunk(chunk: &ContentChunk) -> Option<String> {
    match &chunk.content {
        ContentBlock::Text { text } => Some(text.clone()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::session_update::{ToolArguments, ToolCallData, ToolCallStatus, ToolKind};

    #[test]
    fn suppresses_late_assistant_chunks_after_terminal_turn() {
        let update = SessionUpdate::AgentMessageChunk {
            session_id: Some("sess-1".to_string()),
            chunk: ContentChunk {
                content: ContentBlock::Text {
                    text: "late".to_string(),
                },
                aggregation_hint: None,
            },
            message_id: None,
            part_id: None,
            parent_tool_use_id: None,
            produced_at_monotonic_ms: None,
        };
        let decision = RouteDecision {
            suppress: true,
            ignore_late: false,
            resets: false,
        };

        assert!(session_update_to_provider_event(
            CanonicalAgentId::ClaudeCode,
            42,
            &update,
            decision,
        )
        .is_none());
    }

    #[test]
    fn maps_tool_call_update_with_live_row_id() {
        use crate::acp::session_update::ToolCallUpdateData;

        let update = SessionUpdate::ToolCallUpdate {
            session_id: Some("sess-1".to_string()),
            update: ToolCallUpdateData {
                tool_call_id: "call-1".to_string(),
                status: Some(ToolCallStatus::Completed),
                result: None,
                content: None,
                raw_output: None,
                title: None,
                locations: None,
                streaming_input_delta: None,
                normalized_todos: None,
                normalized_questions: None,
                streaming_arguments: None,
                streaming_plan: None,
                arguments: None,
                failure_reason: None,
            },
        };

        let event = session_update_to_provider_event(
            CanonicalAgentId::ClaudeCode,
            7,
            &update,
            RouteDecision::default(),
        )
        .expect("tool call update maps");

        assert_eq!(event.provider_row_id, "call-1:update:7");
    }

    #[test]
    fn live_ingress_preserves_subagent_parent_scope_metadata() {
        const PARENT_TOOL_CALL_ID: &str = "toolu_task_parent";
        let updates = vec![
            SessionUpdate::AgentThoughtChunk {
                session_id: Some("sess-1".to_string()),
                chunk: ContentChunk {
                    content: ContentBlock::Text {
                        text: "Inspecting the modal.".to_string(),
                    },
                    aggregation_hint: None,
                },
                message_id: Some("thought-1".to_string()),
                part_id: Some("thought-part-1".to_string()),
                parent_tool_use_id: Some(PARENT_TOOL_CALL_ID.to_string()),
            },
            SessionUpdate::ToolCall {
                session_id: Some("sess-1".to_string()),
                tool_call: ToolCallData {
                    id: "toolu_child_read".to_string(),
                    name: "Read".to_string(),
                    arguments: ToolArguments::Other {
                        raw: serde_json::json!({ "file_path": "/project/src/modal.ts" }),
                        intent: None,
                    },
                    diagnostic_input: None,
                    status: ToolCallStatus::InProgress,
                    result: None,
                    kind: Some(ToolKind::Read),
                    title: Some("Read modal".to_string()),
                    locations: None,
                    skill_meta: None,
                    normalized_questions: None,
                    normalized_todos: None,
                    normalized_todo_update: None,
                    parent_tool_use_id: Some(PARENT_TOOL_CALL_ID.to_string()),
                    task_children: None,
                    question_answer: None,
                    awaiting_plan_approval: false,
                    plan_approval_request_id: None,
                },
            },
            SessionUpdate::AgentMessageChunk {
                session_id: Some("sess-1".to_string()),
                chunk: ContentChunk {
                    content: ContentBlock::Text {
                        text: "The modal is wired correctly.".to_string(),
                    },
                    aggregation_hint: None,
                },
                message_id: Some("message-1".to_string()),
                part_id: Some("message-part-1".to_string()),
                parent_tool_use_id: Some(PARENT_TOOL_CALL_ID.to_string()),
                produced_at_monotonic_ms: None,
            },
        ];

        let parent_ids: Vec<Option<String>> = updates
            .iter()
            .enumerate()
            .map(|(index, update)| {
                let event = session_update_to_provider_event(
                    CanonicalAgentId::ClaudeCode,
                    index as i64 + 1,
                    update,
                    RouteDecision::default(),
                )
                .expect("subagent update maps");
                match event.kind {
                    ProviderEventKind::AssistantThought {
                        parent_tool_use_id, ..
                    }
                    | ProviderEventKind::AssistantText {
                        parent_tool_use_id, ..
                    } => parent_tool_use_id,
                    ProviderEventKind::ToolCall(tool_call) => tool_call.parent_tool_use_id,
                    other => panic!("unexpected live ingress fact {other:?}"),
                }
            })
            .collect();

        assert_eq!(
            parent_ids,
            vec![
                Some(PARENT_TOOL_CALL_ID.to_string()),
                Some(PARENT_TOOL_CALL_ID.to_string()),
                Some(PARENT_TOOL_CALL_ID.to_string()),
            ]
        );
    }
}
