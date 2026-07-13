//! Applies one provider-neutral ingress fact to the held canonical session graph.

use super::{append_transcript_entry, thought_text_for_display, HistoryTurnContext};
use crate::acp::client_session::SessionModes;
use crate::acp::lifecycle::{FailureReason, LifecycleStatus};
use crate::acp::projections::helpers::is_terminal_operation_state;
use crate::acp::projections::{
    build_canonical_operation_id, InteractionKind, InteractionPayload, InteractionResponse,
    InteractionSnapshot, InteractionState, OperationState, SessionTurnState, TurnFailureSnapshot,
};
use crate::acp::session::engine::fold_interactions::register_computer_permission_interaction;
use crate::acp::session::engine::fold_lifecycle::apply_turn_end;
use crate::acp::session::engine::fold_operations::{apply_tool_call, apply_tool_call_update};
use crate::acp::session::ingress::event::{ProviderEvent, ProviderEventKind};
use crate::acp::session_state_engine::graph::SessionStateGraph;
use crate::acp::session_state_engine::selectors::{
    select_session_graph_activity, SessionGraphCapabilities, SessionGraphLifecycle,
};
use crate::acp::session_update::{
    sanitize_config_options_for_canonical, InteractionReplyHandler, PermissionData, QuestionData,
    TurnErrorKind, TurnErrorSource,
};
use crate::acp::transcript_projection::display_id::derive_session_activity_entry_id;
use crate::acp::transcript_projection::snapshot::user_transcript_segment_from_text;
use crate::acp::transcript_projection::{
    derive_entry_id_for_snapshot_role, TranscriptEntry, TranscriptEntryRole, TranscriptSegment,
};

pub(super) fn apply_event(
    graph: &mut SessionStateGraph,
    turn_context: &mut HistoryTurnContext,
    event: &ProviderEvent,
) {
    match &event.kind {
        ProviderEventKind::UserText { text, attempt_id } => {
            mark_turn_running(graph);
            if !text.is_empty() {
                let turn_key = turn_context.current_turn_key();
                let entry_id =
                    derive_entry_id_for_snapshot_role(&turn_key, &TranscriptEntryRole::User, None);
                let segment_id = format!("{entry_id}:segment:{}", event.provider_seq);
                append_transcript_entry(
                    graph,
                    turn_context,
                    event,
                    TranscriptEntry {
                        entry_id,
                        role: TranscriptEntryRole::User,
                        segments: vec![user_transcript_segment_from_text(segment_id, text.clone())],
                        attempt_id: attempt_id.clone(),
                        timestamp_ms: event.timestamp_ms,
                    },
                );
            }
        }
        ProviderEventKind::UserPastedContent { text } => {
            mark_turn_running(graph);
            if !text.is_empty() {
                let turn_key = turn_context.current_turn_key();
                let entry_id =
                    derive_entry_id_for_snapshot_role(&turn_key, &TranscriptEntryRole::User, None);
                append_transcript_entry(
                    graph,
                    turn_context,
                    event,
                    TranscriptEntry {
                        entry_id,
                        role: TranscriptEntryRole::User,
                        segments: vec![TranscriptSegment::PastedContent {
                            segment_id: format!("{turn_key}:event:{}", event.provider_seq),
                            text: text.clone(),
                        }],
                        attempt_id: None,
                        timestamp_ms: event.timestamp_ms,
                    },
                );
            }
        }
        ProviderEventKind::AssistantText { text } => {
            mark_turn_running(graph);
            let turn_key = turn_context.current_turn_key();
            let entry_id =
                derive_entry_id_for_snapshot_role(&turn_key, &TranscriptEntryRole::Assistant, None);
            append_transcript_entry(
                graph,
                turn_context,
                event,
                TranscriptEntry {
                    entry_id: entry_id.clone(),
                    role: TranscriptEntryRole::Assistant,
                    segments: vec![TranscriptSegment::Text {
                        segment_id: format!("{entry_id}:segment:{}", event.provider_seq),
                        text: text.clone(),
                    }],
                    attempt_id: None,
                    timestamp_ms: event.timestamp_ms,
                },
            );
        }
        ProviderEventKind::AssistantThought { text, redacted } => {
            mark_turn_running(graph);
            if !text.is_empty() || redacted.is_some() {
                let turn_key = turn_context.current_turn_key();
                let entry_id = derive_entry_id_for_snapshot_role(
                    &turn_key,
                    &TranscriptEntryRole::Assistant,
                    None,
                );
                append_transcript_entry(
                    graph,
                    turn_context,
                    event,
                    TranscriptEntry {
                        entry_id: entry_id.clone(),
                        role: TranscriptEntryRole::Assistant,
                        segments: vec![TranscriptSegment::Thought {
                            segment_id: format!("{entry_id}:segment:{}", event.provider_seq),
                            text: thought_text_for_display(text, redacted.as_deref()),
                        }],
                        attempt_id: None,
                        timestamp_ms: event.timestamp_ms,
                    },
                );
            }
        }
        ProviderEventKind::ToolCall(tool_call) => {
            mark_turn_running(graph);
            apply_tool_call(graph, event, tool_call);
            turn_context.note_entry(
                &TranscriptEntryRole::Tool,
                graph.transcript_snapshot.entries.len(),
            );
        }
        ProviderEventKind::ToolCallUpdate(update) => {
            mark_turn_running(graph);
            apply_tool_call_update(graph, update);
        }
        ProviderEventKind::ComputerPermissionRequest { update, permission } => {
            mark_turn_running(graph);
            apply_tool_call_update(graph, update);
            register_computer_permission_interaction(graph, permission);
        }
        ProviderEventKind::Permission(permission) => apply_permission(graph, event, permission),
        ProviderEventKind::Question(question) => apply_question(graph, question),
        ProviderEventKind::Plan(_) | ProviderEventKind::Usage(_) => {
            // Dedicated payloads own plan and telemetry state; the graph does not duplicate them.
        }
        ProviderEventKind::ModeUpdate(mode) => {
            if let Some(modes) = graph.capabilities.modes.as_mut() {
                modes.current_mode_id = mode.current_mode_id.clone();
            } else {
                graph.capabilities.modes = Some(SessionModes {
                    current_mode_id: mode.current_mode_id.clone(),
                    available_modes: Vec::new(),
                });
            }
            graph.revision.graph_revision += 1;
        }
        ProviderEventKind::CapabilitiesUpdate(update) => {
            graph.capabilities.available_commands = Some(update.available_commands.clone());
            graph.revision.graph_revision += 1;
        }
        ProviderEventKind::ConfigOptionsUpdate(update) => {
            graph.capabilities.config_options = Some(sanitize_config_options_for_canonical(
                update.config_options.clone(),
            ));
        }
        ProviderEventKind::SessionReady {
            models,
            modes,
            available_commands,
            config_options,
            autonomous_enabled,
        } => {
            graph.lifecycle = SessionGraphLifecycle::ready();
            graph.capabilities = SessionGraphCapabilities {
                models: Some(models.clone()),
                modes: Some(modes.clone()),
                available_commands: available_commands.clone(),
                config_options: config_options
                    .clone()
                    .map(sanitize_config_options_for_canonical),
                autonomous_enabled: *autonomous_enabled,
            };
        }
        ProviderEventKind::SessionFailed {
            error,
            failure_reason,
        } => {
            graph.lifecycle = SessionGraphLifecycle::failed(*failure_reason, Some(error.clone()));
        }
        ProviderEventKind::SessionDetached { detached_reason } => {
            graph.lifecycle = SessionGraphLifecycle::detached(*detached_reason);
        }
        ProviderEventKind::TurnBegin { .. } => {
            graph.turn_state = SessionTurnState::Running;
            graph.active_turn_failure = None;
            graph.last_terminal_turn_id = None;
            graph.revision.graph_revision += 1;
        }
        ProviderEventKind::AssistantError { text, error } => {
            graph.turn_state = SessionTurnState::Failed;
            graph.active_turn_failure = Some(TurnFailureSnapshot {
                turn_id: None,
                message: text.clone(),
                code: assistant_error_code(error),
                details: None,
                kind: assistant_error_kind(error),
                source: TurnErrorSource::Unknown,
            });
            graph.last_terminal_turn_id = None;
            graph.revision.graph_revision += 1;
        }
        ProviderEventKind::Compaction(compaction_event) => {
            let turn_key = turn_context.current_turn_key();
            let entry_id = derive_session_activity_entry_id(&turn_key, &compaction_event.event_id);
            append_transcript_entry(
                graph,
                turn_context,
                event,
                TranscriptEntry {
                    entry_id: entry_id.clone(),
                    role: TranscriptEntryRole::SessionActivity,
                    segments: vec![TranscriptSegment::Compaction {
                        segment_id: format!("{entry_id}:compaction"),
                        event: compaction_event.clone(),
                    }],
                    attempt_id: None,
                    timestamp_ms: compaction_event.timestamp_ms,
                },
            );
        }
        ProviderEventKind::TurnEnd { outcome } => {
            apply_turn_end(graph, *outcome);
            if !matches!(
                outcome,
                crate::acp::session::ingress::event::TurnOutcome::Failed
            ) {
                graph.active_turn_failure = None;
            }
            graph.revision.graph_revision += 1;
        }
        ProviderEventKind::TurnFailure { error, turn_id } => {
            let failure =
                crate::acp::projections::convert_turn_error_snapshot(error, turn_id.clone());
            if matches!(
                graph.lifecycle.status,
                LifecycleStatus::Reserved | LifecycleStatus::Activating
            ) {
                graph.lifecycle = SessionGraphLifecycle::failed(
                    FailureReason::ActivationFailed,
                    Some(failure.message.clone()),
                );
            }
            graph.turn_state = SessionTurnState::Failed;
            graph.active_turn_failure = Some(failure);
            graph.last_terminal_turn_id = turn_id.clone();
            graph.revision.graph_revision += 1;
        }
    }

    refresh_graph_activity(graph);
}

pub(super) fn refresh_graph_activity(graph: &mut SessionStateGraph) {
    graph.activity = select_session_graph_activity(
        &graph.lifecycle,
        &graph.turn_state,
        &graph.operations,
        &graph.interactions,
        graph.active_turn_failure.as_ref(),
    );
}

pub(super) fn apply_interaction_reply(
    graph: &mut SessionStateGraph,
    interaction_id: &str,
    state: InteractionState,
    response: InteractionResponse,
    event_seq: i64,
) -> bool {
    let Some(interaction_index) = graph
        .interactions
        .iter()
        .position(|interaction| interaction.id == interaction_id)
    else {
        return false;
    };

    let canonical_operation_id = graph.interactions[interaction_index]
        .canonical_operation_id
        .clone();
    graph.interactions[interaction_index].state = state.clone();
    graph.interactions[interaction_index].responded_at_event_seq = Some(event_seq);
    graph.interactions[interaction_index].response = Some(response);

    if let Some(operation_id) = canonical_operation_id {
        let has_other_pending_interaction = graph.interactions.iter().any(|interaction| {
            interaction.id != interaction_id
                && interaction.state == InteractionState::Pending
                && interaction.canonical_operation_id.as_deref() == Some(operation_id.as_str())
        });
        if let Some(operation) = graph
            .operations
            .iter_mut()
            .find(|operation| operation.id == operation_id)
        {
            if !is_terminal_operation_state(&operation.operation_state) {
                match state {
                    InteractionState::Approved | InteractionState::Answered
                        if !has_other_pending_interaction =>
                    {
                        operation.operation_state = OperationState::Running;
                    }
                    InteractionState::Rejected | InteractionState::Unresolved => {
                        operation.operation_state = OperationState::Cancelled;
                    }
                    InteractionState::Pending
                    | InteractionState::Approved
                    | InteractionState::Answered => {}
                }
            }
        }
    }

    refresh_graph_activity(graph);
    true
}

fn mark_turn_running(graph: &mut SessionStateGraph) {
    graph.turn_state = SessionTurnState::Running;
    graph.active_turn_failure = None;
    graph.last_terminal_turn_id = None;
}

fn apply_permission(
    graph: &mut SessionStateGraph,
    event: &ProviderEvent,
    permission: &PermissionData,
) {
    let event_seq = i64::try_from(event.provider_seq).unwrap_or(i64::MAX);
    let interaction = InteractionSnapshot {
        id: permission.id.clone(),
        session_id: permission.session_id.clone(),
        kind: InteractionKind::Permission,
        state: if permission.auto_accepted {
            InteractionState::Approved
        } else {
            InteractionState::Pending
        },
        json_rpc_request_id: permission.json_rpc_request_id,
        reply_handler: permission.reply_handler.clone().or_else(|| {
            permission
                .json_rpc_request_id
                .map(InteractionReplyHandler::json_rpc)
                .or_else(|| Some(InteractionReplyHandler::http(permission.id.clone())))
        }),
        tool_reference: permission.tool.clone(),
        responded_at_event_seq: permission.auto_accepted.then_some(event_seq),
        response: permission
            .auto_accepted
            .then_some(InteractionResponse::Permission {
                accepted: true,
                option_id: Some("allow".to_string()),
                reply: Some("once".to_string()),
            }),
        payload: InteractionPayload::Permission(permission.clone()),
        canonical_operation_id: permission
            .tool
            .as_ref()
            .map(|tool| build_canonical_operation_id(&permission.session_id, &tool.call_id)),
    };
    upsert_direct_interaction(graph, interaction);
}

fn apply_question(graph: &mut SessionStateGraph, question: &QuestionData) {
    let interaction = InteractionSnapshot {
        id: question.id.clone(),
        session_id: question.session_id.clone(),
        kind: InteractionKind::Question,
        state: InteractionState::Pending,
        json_rpc_request_id: question.json_rpc_request_id,
        reply_handler: question.reply_handler.clone().or_else(|| {
            question
                .json_rpc_request_id
                .map(InteractionReplyHandler::json_rpc)
                .or_else(|| Some(InteractionReplyHandler::http(question.id.clone())))
        }),
        tool_reference: question.tool.clone(),
        responded_at_event_seq: None,
        response: None,
        payload: InteractionPayload::Question(question.clone()),
        canonical_operation_id: question
            .tool
            .as_ref()
            .map(|tool| build_canonical_operation_id(&question.session_id, &tool.call_id)),
    };
    upsert_direct_interaction(graph, interaction);
}

fn upsert_direct_interaction(graph: &mut SessionStateGraph, interaction: InteractionSnapshot) {
    if let Some(index) = graph
        .interactions
        .iter()
        .position(|existing| existing.id == interaction.id)
    {
        graph.interactions[index] = interaction;
    } else {
        graph.interactions.push(interaction);
    }
    graph.revision.graph_revision += 1;
}

fn assistant_error_code(error: &crate::cc_sdk::AssistantMessageError) -> Option<String> {
    match error {
        crate::cc_sdk::AssistantMessageError::RateLimit => Some("429".to_string()),
        _ => None,
    }
}

fn assistant_error_kind(error: &crate::cc_sdk::AssistantMessageError) -> TurnErrorKind {
    match error {
        crate::cc_sdk::AssistantMessageError::AuthenticationFailed
        | crate::cc_sdk::AssistantMessageError::BillingError
        | crate::cc_sdk::AssistantMessageError::InvalidRequest => TurnErrorKind::Fatal,
        crate::cc_sdk::AssistantMessageError::RateLimit
        | crate::cc_sdk::AssistantMessageError::ServerError
        | crate::cc_sdk::AssistantMessageError::Unknown => TurnErrorKind::Recoverable,
    }
}
