//! Live `SessionUpdate` → ingress `ProviderEvent` mapping (shared by live and replay paths).

use crate::acp::projections::helpers::extract_tool_update_text;
use crate::acp::projections::{ComputerPermissionData, RouteDecision};
use crate::acp::session::ingress::event::{ProviderEvent, ProviderEventKind, TurnOutcome};
use crate::acp::session_update::{ContentChunk, SessionUpdate, ToolReference};
use crate::acp::types::{CanonicalAgentId, ContentBlock};
use crate::computer_use::permissions::build_computer_permission_interaction_id;
use crate::computer_use::types::ComputerError;
use serde_json::Value;

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
        SessionUpdate::ToolCallUpdate { update, session_id } => {
            tool_call_update_event_kind(update, session_id.as_deref())
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
        SessionUpdate::ConfigOptionUpdate { update, .. } => {
            ProviderEventKind::ConfigOptionsUpdate(update.clone())
        }
        SessionUpdate::ConnectionComplete {
            models,
            modes,
            available_commands,
            config_options,
            autonomous_enabled,
            ..
        } => ProviderEventKind::SessionReady {
            models: models.clone(),
            modes: modes.clone(),
            available_commands: available_commands.clone(),
            config_options: config_options.clone(),
            autonomous_enabled: *autonomous_enabled,
        },
        SessionUpdate::ConnectionFailed {
            error,
            failure_reason,
            ..
        } => ProviderEventKind::SessionFailed {
            error: error.clone(),
            failure_reason: *failure_reason,
        },
        SessionUpdate::SessionDetached {
            detached_reason, ..
        } => ProviderEventKind::SessionDetached {
            detached_reason: *detached_reason,
        },
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
        SessionUpdate::TurnError { error, turn_id, .. } => ProviderEventKind::TurnFailure {
            error: error.clone(),
            turn_id: turn_id.clone(),
        },
        SessionUpdate::TurnCancelled { .. } => ProviderEventKind::TurnEnd {
            outcome: TurnOutcome::Cancelled,
        },
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
    let provider_row_id = provider_row_id_for_live_update(provider_seq as i64, update);

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
        SessionUpdate::ToolCallUpdate { update, session_id } => {
            tool_call_update_event_kind(update, session_id.as_deref())
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

fn tool_call_update_event_kind(
    update: &crate::acp::session_update::ToolCallUpdateData,
    session_id: Option<&str>,
) -> ProviderEventKind {
    let Some(permission) = session_id
        .and_then(|session_id| computer_permission_from_tool_call_update(session_id, update))
    else {
        return ProviderEventKind::ToolCallUpdate(update.clone());
    };
    ProviderEventKind::ComputerPermissionRequest {
        update: update.clone(),
        permission,
    }
}

fn computer_permission_from_tool_call_update(
    session_id: &str,
    update: &crate::acp::session_update::ToolCallUpdateData,
) -> Option<ComputerPermissionData> {
    let error = update
        .result
        .as_ref()
        .and_then(computer_error_from_value)
        .or_else(|| {
            update
                .raw_output
                .as_ref()
                .and_then(computer_error_from_value)
        })
        .or_else(|| {
            extract_tool_update_text(update).and_then(|text| {
                serde_json::from_str::<Value>(&text)
                    .ok()
                    .and_then(|value| computer_error_from_value(&value))
            })
        })?;
    if error.code != "computer_permission_required" {
        return None;
    }
    let permission_kind = error.permission_kind?;
    Some(ComputerPermissionData {
        id: build_computer_permission_interaction_id(
            session_id,
            &update.tool_call_id,
            permission_kind,
        ),
        session_id: session_id.to_string(),
        permission_kind,
        reason: error.message,
        app: error.app.map(String::from),
        window: error.window.map(String::from),
        tool: Some(ToolReference {
            message_id: None,
            call_id: update.tool_call_id.clone(),
        }),
    })
}

fn computer_error_from_value(value: &Value) -> Option<ComputerError> {
    let error = value
        .get("error")
        .or_else(|| value.get("err"))
        .unwrap_or(value);
    serde_json::from_value::<ComputerError>(error.clone()).ok()
}

fn provider_row_id_for_live_update(event_seq: i64, update: &SessionUpdate) -> String {
    stable_provider_fact_id(update).unwrap_or_else(|| format!("journal:{event_seq}"))
}

/// Return an identity only when the provider gives one for this exact fact.
///
/// Message/part ids and tool-call ids on updates identify an aggregation target,
/// not an individual streaming delta. Reusing them would suppress legitimate
/// chunks or status transitions, so those updates intentionally fall back to the
/// journal sequence and are not deduplicated against provider history.
fn stable_provider_fact_id(update: &SessionUpdate) -> Option<String> {
    match update {
        SessionUpdate::ToolCall { tool_call, .. } => non_empty_provider_id(&tool_call.id),
        SessionUpdate::PermissionRequest { permission, .. } => {
            non_empty_provider_id(&permission.id)
        }
        SessionUpdate::QuestionRequest { question, .. } => non_empty_provider_id(&question.id),
        SessionUpdate::CompactionEvent { event, .. } => non_empty_provider_id(&event.event_id),
        SessionUpdate::UsageTelemetryUpdate { data } => {
            data.event_id.as_deref().and_then(non_empty_provider_id)
        }
        SessionUpdate::TurnComplete { turn_id, .. }
        | SessionUpdate::TurnError { turn_id, .. }
        | SessionUpdate::TurnCancelled { turn_id, .. } => {
            turn_id.as_deref().and_then(non_empty_provider_id)
        }
        SessionUpdate::UserMessageChunk { .. }
        | SessionUpdate::AgentMessageChunk { .. }
        | SessionUpdate::AgentThoughtChunk { .. }
        | SessionUpdate::ToolCallUpdate { .. }
        | SessionUpdate::Plan { .. }
        | SessionUpdate::AvailableCommandsUpdate { .. }
        | SessionUpdate::CurrentModeUpdate { .. }
        | SessionUpdate::ConfigOptionUpdate { .. }
        | SessionUpdate::ConnectionComplete { .. }
        | SessionUpdate::ConnectionFailed { .. }
        | SessionUpdate::SessionDetached { .. } => None,
    }
}

fn non_empty_provider_id(value: &str) -> Option<String> {
    (!value.trim().is_empty()).then(|| value.to_string())
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
        QuestionData, ToolArguments, ToolCallData, ToolCallStatus, ToolKind, TurnErrorData,
        UsageTelemetryData, UsageTelemetryTokens,
    };

    fn read_tool_call(id: &str) -> ToolCallData {
        ToolCallData {
            id: id.to_string(),
            name: "Read".to_string(),
            arguments: ToolArguments::Read {
                file_path: Some("/tmp/file".to_string()),
                source_context: None,
            },
            diagnostic_input: None,
            status: ToolCallStatus::InProgress,
            result: None,
            kind: Some(ToolKind::Read),
            title: Some("Read file".to_string()),
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
        }
    }

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
    fn maps_terminal_update_families_without_losing_failure_details() {
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
            ProviderEventKind::TurnFailure {
                error: TurnErrorData::Legacy(ref message),
                turn_id: Some(ref turn_id),
            } if message == "boom" && turn_id == "turn-1"
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
    fn maps_lifecycle_and_control_plane_updates_to_provider_neutral_facts() {
        let updates = [
            (
                SessionUpdate::ConfigOptionUpdate {
                    update: ConfigOptionUpdateData {
                        config_options: Vec::new(),
                    },
                    session_id: Some("sess-1".to_string()),
                },
                "config_options_update",
            ),
            (
                SessionUpdate::ConnectionComplete {
                    session_id: "sess-1".to_string(),
                    attempt_id: 1,
                    models: default_session_model_state(),
                    modes: default_modes(),
                    available_commands: None,
                    config_options: None,
                    autonomous_enabled: None,
                },
                "session_ready",
            ),
            (
                SessionUpdate::ConnectionFailed {
                    session_id: "sess-1".to_string(),
                    attempt_id: 1,
                    error: "offline".to_string(),
                    failure_reason: FailureReason::ResumeFailed,
                },
                "session_failed",
            ),
            (
                SessionUpdate::SessionDetached {
                    session_id: "sess-1".to_string(),
                    attempt_id: 1,
                    detached_reason: DetachedReason::ReconnectExhausted,
                },
                "session_detached",
            ),
        ];

        for (update, expected_kind) in updates {
            assert_eq!(mapped_kind(&update), expected_kind);
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
    fn tool_call_update_uses_journal_identity_because_target_id_is_not_event_identity() {
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

        assert_eq!(event.provider_row_id, "journal:7");
    }

    #[test]
    fn streaming_chunks_with_same_message_and_part_keep_distinct_journal_identities() {
        use crate::acp::session::engine::fold::{fold_full, FoldContext};
        use crate::acp::session_state_engine::runtime_registry::SessionGraphRuntimeRegistry;

        let update = SessionUpdate::AgentMessageChunk {
            session_id: Some("sess-1".to_string()),
            chunk: ContentChunk {
                content: ContentBlock::Text {
                    text: "delta".to_string(),
                },
                aggregation_hint: None,
            },
            message_id: Some("message-1".to_string()),
            part_id: Some("part-1".to_string()),
            parent_tool_use_id: None,
            produced_at_monotonic_ms: None,
        };

        let first = session_update_to_provider_event(
            CanonicalAgentId::ClaudeCode,
            7,
            &update,
            RouteDecision::default(),
        )
        .expect("first chunk maps");
        let second = session_update_to_provider_event(
            CanonicalAgentId::ClaudeCode,
            8,
            &update,
            RouteDecision::default(),
        )
        .expect("second chunk maps");

        assert_eq!(first.provider_row_id, "journal:7");
        assert_eq!(second.provider_row_id, "journal:8");
        assert_ne!(first.provider_row_id, second.provider_row_id);
        assert_eq!(first.fold_dedup_key(), None);
        assert_eq!(second.fold_dedup_key(), None);

        let registry = SessionGraphRuntimeRegistry::new();
        registry.seed_graph(
            "sess-1".to_string(),
            fold_full(
                &[],
                &FoldContext::new("sess-1", CanonicalAgentId::ClaudeCode, "/tmp/project"),
            ),
        );
        assert!(
            registry
                .apply_provider_event_transition("sess-1", &first)
                .expect("first chunk transition")
                .applied
        );
        let second_transition = registry
            .apply_provider_event_transition("sess-1", &second)
            .expect("second chunk transition");
        assert!(
            second_transition.applied,
            "message and part ids identify the stream target, not a unique chunk"
        );
        assert_eq!(
            second_transition.after.transcript_snapshot.entries[0]
                .segments
                .len(),
            2
        );
    }

    #[test]
    fn history_and_live_tool_identity_deduplicates_reconnect_redelivery() {
        use crate::acp::session::engine::fold::{fold_history_with_dedup_frontier, FoldContext};
        use crate::acp::session_state_engine::runtime_registry::SessionGraphRuntimeRegistry;

        let update = SessionUpdate::ToolCall {
            tool_call: read_tool_call("toolu-stable-1"),
            session_id: Some("sess-1".to_string()),
        };
        let history_events = session_updates_to_provider_events(
            CanonicalAgentId::ClaudeCode,
            std::slice::from_ref(&update),
        );
        let live_event = session_update_to_provider_event(
            CanonicalAgentId::ClaudeCode,
            99,
            &update,
            RouteDecision::default(),
        )
        .expect("live tool call must map");

        assert_eq!(
            history_events[0].provider_row_id,
            live_event.provider_row_id
        );
        assert_eq!(
            history_events[0].fold_dedup_key(),
            live_event.fold_dedup_key()
        );

        let folded = fold_history_with_dedup_frontier(
            &history_events,
            &FoldContext::new("sess-1", CanonicalAgentId::ClaudeCode, "/tmp/project"),
        );
        let registry = SessionGraphRuntimeRegistry::new();
        assert!(registry.seed_folded_history("sess-1".to_string(), folded));
        let transition = registry
            .apply_provider_event_transition("sess-1", &live_event)
            .expect("history graph must be attached");

        assert!(
            !transition.applied,
            "reconnect redelivery of the provider-stable tool fact must deduplicate"
        );
    }

    #[test]
    fn computer_permission_request_and_reply_live_in_the_held_graph() {
        use crate::acp::projections::{InteractionKind, InteractionResponse, InteractionState};
        use crate::acp::session::engine::fold::{fold_full, FoldContext};
        use crate::acp::session_state_engine::runtime_registry::SessionGraphRuntimeRegistry;
        use crate::computer_use::permissions::{
            build_computer_permission_interaction_id, ComputerPermissionKind,
        };

        let session_id = "sess-computer-permission";
        let tool_call_id = "tool-computer-1";
        let tool_call = SessionUpdate::ToolCall {
            tool_call: read_tool_call(tool_call_id),
            session_id: Some(session_id.to_string()),
        };
        let tool_update = SessionUpdate::ToolCallUpdate {
            update: crate::acp::session_update::ToolCallUpdateData {
                tool_call_id: tool_call_id.to_string(),
                result: Some(serde_json::json!({
                    "error": {
                        "code": "computer_permission_required",
                        "message": "Accessibility permission is required",
                        "permission_kind": "accessibility"
                    }
                })),
                ..Default::default()
            },
            session_id: Some(session_id.to_string()),
        };
        let registry = SessionGraphRuntimeRegistry::new();
        registry.seed_graph(
            session_id.to_string(),
            fold_full(
                &[],
                &FoldContext::new(session_id, CanonicalAgentId::ClaudeCode, "/workspace"),
            ),
        );

        for (event_seq, update) in [(1, &tool_call), (2, &tool_update)] {
            let event = session_update_to_provider_event(
                CanonicalAgentId::ClaudeCode,
                event_seq,
                update,
                RouteDecision::default(),
            )
            .expect("computer tool update should map to canonical ingress");
            assert!(
                registry
                    .apply_provider_event_transition(session_id, &event)
                    .expect("seeded graph should accept the event")
                    .applied
            );
        }

        let interaction_id = build_computer_permission_interaction_id(
            session_id,
            tool_call_id,
            ComputerPermissionKind::Accessibility,
        );
        let graph = registry
            .graph_for_session(session_id)
            .expect("held graph should exist");
        let interaction = graph
            .interactions
            .iter()
            .find(|interaction| interaction.id == interaction_id)
            .expect("computer permission must be canonical before reply lookup");
        assert_eq!(interaction.kind, InteractionKind::ComputerPermission);
        assert_eq!(interaction.state, InteractionState::Pending);
        assert_eq!(
            graph.operations[0].operation_state,
            crate::acp::projections::OperationState::Blocked
        );

        registry
            .apply_interaction_reply_transition(
                session_id,
                &interaction_id,
                InteractionState::Approved,
                InteractionResponse::ComputerPermission { accepted: true },
                3,
            )
            .expect("canonical computer permission should accept a reply");
        let next_event = ProviderEvent {
            source: CanonicalAgentId::ClaudeCode,
            provider_seq: 4,
            provider_row_id: "journal:4".to_string(),
            timestamp_ms: None,
            kind: ProviderEventKind::AssistantText {
                text: "continuing".to_string(),
            },
        };
        let after = registry
            .apply_provider_event_transition(session_id, &next_event)
            .expect("held graph should accept the next provider event")
            .after;
        let interaction = after
            .interactions
            .iter()
            .find(|interaction| interaction.id == interaction_id)
            .expect("replied interaction should survive the next provider event");
        assert_eq!(interaction.state, InteractionState::Approved);
        assert!(matches!(
            interaction.response,
            Some(InteractionResponse::ComputerPermission { accepted: true })
        ));
        assert_eq!(
            after.operations[0].operation_state,
            crate::acp::projections::OperationState::Running
        );
    }
}
