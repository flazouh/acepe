//! Live `SessionUpdate` → ingress `ProviderEvent` mapping (shared by live and replay paths).

use crate::acp::projections::RouteDecision;
use crate::acp::session::ingress::event::{ProviderEvent, ProviderEventKind, TurnOutcome};
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
            if parent_tool_use_id.is_some() {
                return None;
            }
            let text = assistant_text_from_chunk(chunk)?;
            ProviderEventKind::AssistantText { text }
        }
        SessionUpdate::AgentThoughtChunk {
            chunk,
            parent_tool_use_id,
            ..
        } => {
            if parent_tool_use_id.is_some() {
                return None;
            }
            let text = assistant_text_from_chunk(chunk)?;
            ProviderEventKind::AssistantThought {
                text,
                redacted: None,
            }
        }
        SessionUpdate::ToolCall { tool_call, .. } => ProviderEventKind::ToolCall(tool_call.clone()),
        SessionUpdate::ToolCallUpdate { update, .. } => {
            ProviderEventKind::ToolCallUpdate(update.clone())
        }
        SessionUpdate::CompactionEvent { event, .. } => {
            ProviderEventKind::Compaction(event.clone())
        }
        SessionUpdate::Plan { plan, .. } => ProviderEventKind::Plan(plan.clone()),
        SessionUpdate::AvailableCommandsUpdate { update, .. } => {
            ProviderEventKind::CapabilitiesUpdate(update.clone())
        }
        SessionUpdate::CurrentModeUpdate { update, .. } => {
            ProviderEventKind::ModeUpdate(update.clone())
        }
        SessionUpdate::PermissionRequest { permission, .. } => {
            ProviderEventKind::Permission(permission.clone())
        }
        SessionUpdate::QuestionRequest { question, .. } => {
            ProviderEventKind::Question(question.clone())
        }
        SessionUpdate::UsageTelemetryUpdate { data } => ProviderEventKind::Usage(data.clone()),
        SessionUpdate::TurnComplete { .. } => ProviderEventKind::TurnEnd {
            outcome: TurnOutcome::Completed,
        },
        SessionUpdate::TurnError { .. } => ProviderEventKind::TurnEnd {
            outcome: TurnOutcome::Failed,
        },
        SessionUpdate::TurnCancelled { .. } => ProviderEventKind::TurnEnd {
            outcome: TurnOutcome::Cancelled,
        },
        // These update the connection/capability control plane. The canonical
        // provider fact vocabulary intentionally has no exact equivalent.
        SessionUpdate::ConfigOptionUpdate { .. }
        | SessionUpdate::ConnectionComplete { .. }
        | SessionUpdate::ConnectionFailed { .. }
        | SessionUpdate::SessionDetached { .. } => return None,
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
    use crate::acp::client_session::{default_modes, default_session_model_state};
    use crate::acp::lifecycle::{DetachedReason, FailureReason};
    use crate::acp::session_update::{
        AvailableCommandsData, ConfigOptionUpdateData, CurrentModeData, PermissionData, PlanData,
        QuestionData, ToolCallStatus, TurnErrorData, UsageTelemetryData, UsageTelemetryTokens,
    };

    fn mapped_kind(update: &SessionUpdate) -> &'static str {
        session_update_to_provider_event(
            CanonicalAgentId::ClaudeCode,
            1,
            update,
            RouteDecision::default(),
        )
        .expect("update should map to a provider event")
        .kind_discriminant()
    }

    #[test]
    fn maps_canonical_state_and_interaction_update_families() {
        let plan = SessionUpdate::Plan {
            plan: PlanData::from_steps(Vec::new()),
            session_id: Some("sess-1".to_string()),
        };
        let commands = SessionUpdate::AvailableCommandsUpdate {
            update: AvailableCommandsData {
                available_commands: Vec::new(),
            },
            session_id: Some("sess-1".to_string()),
        };
        let mode = SessionUpdate::CurrentModeUpdate {
            update: CurrentModeData {
                current_mode_id: "agent".to_string(),
            },
            session_id: Some("sess-1".to_string()),
        };
        let permission = SessionUpdate::PermissionRequest {
            permission: PermissionData {
                id: "permission-1".to_string(),
                session_id: "sess-1".to_string(),
                json_rpc_request_id: None,
                reply_handler: None,
                permission: "write".to_string(),
                patterns: Vec::new(),
                metadata: serde_json::Value::Null,
                always: Vec::new(),
                auto_accepted: false,
                tool: None,
            },
            session_id: Some("sess-1".to_string()),
        };
        let question = SessionUpdate::QuestionRequest {
            question: QuestionData {
                id: "question-1".to_string(),
                session_id: "sess-1".to_string(),
                json_rpc_request_id: None,
                reply_handler: None,
                questions: Vec::new(),
                tool: None,
            },
            session_id: Some("sess-1".to_string()),
        };
        let usage = SessionUpdate::UsageTelemetryUpdate {
            data: UsageTelemetryData {
                session_id: "sess-1".to_string(),
                event_id: None,
                scope: "turn".to_string(),
                cost_usd: None,
                tokens: UsageTelemetryTokens::default(),
                source_model_id: None,
                timestamp_ms: None,
                context_window_size: None,
                context_window_source: None,
                parent_tool_use_id: None,
            },
        };

        assert_eq!(mapped_kind(&plan), "plan");
        assert_eq!(mapped_kind(&commands), "capabilities_update");
        assert_eq!(mapped_kind(&mode), "mode_update");
        assert_eq!(mapped_kind(&permission), "permission");
        assert_eq!(mapped_kind(&question), "question");
        assert_eq!(mapped_kind(&usage), "usage");
    }

    #[test]
    fn maps_all_terminal_update_families_to_turn_end() {
        let complete = SessionUpdate::TurnComplete {
            session_id: Some("sess-1".to_string()),
            turn_id: Some("turn-1".to_string()),
        };
        let error = SessionUpdate::TurnError {
            error: TurnErrorData::Legacy("boom".to_string()),
            session_id: Some("sess-1".to_string()),
            turn_id: Some("turn-1".to_string()),
        };
        let cancelled = SessionUpdate::TurnCancelled {
            session_id: Some("sess-1".to_string()),
            turn_id: Some("turn-1".to_string()),
        };

        assert!(matches!(
            session_update_to_provider_event(
                CanonicalAgentId::ClaudeCode,
                1,
                &complete,
                RouteDecision::default(),
            )
            .expect("complete maps")
            .kind,
            ProviderEventKind::TurnEnd {
                outcome: crate::acp::session::ingress::event::TurnOutcome::Completed
            }
        ));
        assert!(matches!(
            session_update_to_provider_event(
                CanonicalAgentId::ClaudeCode,
                2,
                &error,
                RouteDecision::default(),
            )
            .expect("error maps")
            .kind,
            ProviderEventKind::TurnEnd {
                outcome: crate::acp::session::ingress::event::TurnOutcome::Failed
            }
        ));
        assert!(matches!(
            session_update_to_provider_event(
                CanonicalAgentId::ClaudeCode,
                3,
                &cancelled,
                RouteDecision::default(),
            )
            .expect("cancelled maps")
            .kind,
            ProviderEventKind::TurnEnd {
                outcome: crate::acp::session::ingress::event::TurnOutcome::Cancelled
            }
        ));
    }

    #[test]
    fn leaves_updates_without_an_exact_provider_fact_unmapped() {
        let updates = [
            SessionUpdate::ConfigOptionUpdate {
                update: ConfigOptionUpdateData {
                    config_options: Vec::new(),
                },
                session_id: Some("sess-1".to_string()),
            },
            SessionUpdate::ConnectionComplete {
                session_id: "sess-1".to_string(),
                attempt_id: 1,
                models: default_session_model_state(),
                modes: default_modes(),
                available_commands: None,
                config_options: None,
                autonomous_enabled: None,
            },
            SessionUpdate::ConnectionFailed {
                session_id: "sess-1".to_string(),
                attempt_id: 1,
                error: "offline".to_string(),
                failure_reason: FailureReason::ResumeFailed,
            },
            SessionUpdate::SessionDetached {
                session_id: "sess-1".to_string(),
                attempt_id: 1,
                detached_reason: DetachedReason::ReconnectExhausted,
            },
        ];

        for update in updates {
            assert!(session_update_to_provider_event(
                CanonicalAgentId::ClaudeCode,
                1,
                &update,
                RouteDecision::default(),
            )
            .is_none());
        }
    }

    #[test]
    fn keeps_late_terminal_duplicate_suppression() {
        let decision = RouteDecision {
            suppress: false,
            ignore_late: true,
            resets: false,
        };
        let complete = SessionUpdate::TurnComplete {
            session_id: Some("sess-1".to_string()),
            turn_id: Some("turn-1".to_string()),
        };
        let error = SessionUpdate::TurnError {
            error: TurnErrorData::Legacy("boom".to_string()),
            session_id: Some("sess-1".to_string()),
            turn_id: Some("turn-1".to_string()),
        };

        assert!(session_update_to_provider_event(
            CanonicalAgentId::ClaudeCode,
            1,
            &complete,
            decision,
        )
        .is_none());
        assert!(session_update_to_provider_event(
            CanonicalAgentId::ClaudeCode,
            2,
            &error,
            decision,
        )
        .is_none());
    }

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
}
