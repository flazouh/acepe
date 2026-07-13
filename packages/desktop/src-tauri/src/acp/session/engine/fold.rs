//! Deterministic session graph fold — single truth builder for live and history.
//!
//! Phase 1: skeleton + transcript facts. Full operation/interaction merge follows.

use crate::acp::client_session::SessionModes;
use crate::acp::projections::{
    build_canonical_operation_id, InteractionKind, InteractionPayload, InteractionResponse,
    InteractionSnapshot, InteractionState, SessionTurnState, TurnFailureSnapshot,
};
use crate::acp::session::engine::fold_lifecycle::{apply_historical_close, apply_turn_end};
use crate::acp::session::engine::fold_operations::{apply_tool_call, apply_tool_call_update};
use crate::acp::session::ingress::event::{ProviderEvent, ProviderEventKind};
use crate::acp::session_state_engine::graph::SessionStateGraph;
use crate::acp::session_state_engine::revision::SessionGraphRevision;
use crate::acp::session_state_engine::selectors::{
    select_session_graph_activity, SessionGraphActivity, SessionGraphCapabilities,
    SessionGraphLifecycle,
};
use crate::acp::session_update::{
    InteractionReplyHandler, PermissionData, QuestionData, TurnErrorKind, TurnErrorSource,
};
use crate::acp::transcript_projection::display_id::derive_session_activity_entry_id;
use crate::acp::transcript_projection::snapshot::user_transcript_segment_from_text;
use crate::acp::transcript_projection::{
    assistant_boundary_entry_count_from_transcript_entries, derive_entry_id_for_snapshot_role,
    turn_key_for_assistant_boundary, TranscriptEntry, TranscriptEntryRole, TranscriptSegment,
    TranscriptSnapshot,
};
use crate::acp::types::CanonicalAgentId;

/// Context supplied to the fold (session identity, not live lifecycle).
#[derive(Debug, Clone)]
pub struct FoldContext {
    pub session_id: String,
    pub agent_id: CanonicalAgentId,
    pub project_path: String,
}

impl FoldContext {
    pub fn new(
        session_id: impl Into<String>,
        agent_id: CanonicalAgentId,
        project_path: impl Into<String>,
    ) -> Self {
        Self {
            session_id: session_id.into(),
            agent_id,
            project_path: project_path.into(),
        }
    }
}

/// Delta emitted by a single live fold step (Phase 1 stub).
#[derive(Debug, Clone, Default)]
pub struct GraphDelta {
    pub transcript_revision: i64,
}

#[derive(Debug, Clone, Default)]
struct HistoryTurnContext {
    assistant_boundary_entry_count: usize,
}

impl HistoryTurnContext {
    fn from_transcript_entries(entries: &[TranscriptEntry]) -> Self {
        Self {
            assistant_boundary_entry_count: assistant_boundary_entry_count_from_transcript_entries(
                entries,
            ),
        }
    }

    fn current_turn_key(&self) -> String {
        turn_key_for_assistant_boundary(self.assistant_boundary_entry_count)
    }

    fn note_entry(&mut self, role: &TranscriptEntryRole, entries_len_after: usize) {
        if role_closes_assistant_boundary(role) {
            self.assistant_boundary_entry_count = entries_len_after;
        }
    }
}

fn role_closes_assistant_boundary(role: &TranscriptEntryRole) -> bool {
    !matches!(role, TranscriptEntryRole::Assistant)
}

/// Fold a full ordered event stream into a session graph (history open path).
#[must_use]
pub fn fold_full(events: &[ProviderEvent], ctx: &FoldContext) -> SessionStateGraph {
    let mut graph = empty_graph(ctx);
    let mut turn_context = HistoryTurnContext::default();
    for event in events {
        apply_event(&mut graph, &mut turn_context, event);
    }
    apply_historical_close(&mut graph);
    refresh_graph_activity(&mut graph);
    graph
}

/// Fold one live event onto the previous graph.
#[must_use]
pub fn fold_step(
    prev: &SessionStateGraph,
    event: &ProviderEvent,
) -> (SessionStateGraph, GraphDelta) {
    fold_step_with_dedup(prev, event, &mut None)
}

/// Fold one live event with optional idempotency keys (live replay only).
#[must_use]
pub fn fold_step_with_dedup(
    prev: &SessionStateGraph,
    event: &ProviderEvent,
    dedup_keys: &mut Option<std::collections::HashSet<String>>,
) -> (SessionStateGraph, GraphDelta) {
    if fold_event_is_duplicate(dedup_keys, event) {
        return (
            prev.clone(),
            GraphDelta {
                transcript_revision: prev.transcript_snapshot.revision,
            },
        );
    }

    let mut graph = prev.clone();
    let mut turn_context =
        HistoryTurnContext::from_transcript_entries(&graph.transcript_snapshot.entries);
    let mut delta = GraphDelta {
        transcript_revision: graph.transcript_snapshot.revision,
    };

    apply_event(&mut graph, &mut turn_context, event);
    record_fold_applied_key(dedup_keys, event);

    delta.transcript_revision = graph.transcript_snapshot.revision;
    (graph, delta)
}

fn fold_event_is_duplicate(
    dedup_keys: &Option<std::collections::HashSet<String>>,
    event: &ProviderEvent,
) -> bool {
    dedup_keys
        .as_ref()
        .is_some_and(|keys| keys.contains(&fold_applied_key_for_event(event)))
}

fn record_fold_applied_key(
    dedup_keys: &mut Option<std::collections::HashSet<String>>,
    event: &ProviderEvent,
) {
    if let Some(keys) = dedup_keys {
        keys.insert(fold_applied_key_for_event(event));
    }
}

fn fold_applied_key_for_event(event: &ProviderEvent) -> String {
    format!("{}:{}", event.provider_row_id, event.kind_discriminant())
}

fn apply_event(
    graph: &mut SessionStateGraph,
    turn_context: &mut HistoryTurnContext,
    event: &ProviderEvent,
) {
    match &event.kind {
        ProviderEventKind::UserText { text, attempt_id } => {
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
            apply_tool_call(graph, event, tool_call);
            turn_context.note_entry(
                &TranscriptEntryRole::Tool,
                graph.transcript_snapshot.entries.len(),
            );
        }
        ProviderEventKind::ToolCallUpdate(update) => {
            apply_tool_call_update(graph, update);
        }
        ProviderEventKind::Permission(permission) => {
            apply_permission(graph, event, permission);
        }
        ProviderEventKind::Question(question) => {
            apply_question(graph, question);
        }
        ProviderEventKind::Plan(_) | ProviderEventKind::Usage(_) => {
            // Plans and telemetry are emitted as dedicated `SessionStatePayload`
            // variants. `SessionStateGraph` deliberately has no payload field for
            // either, so accepting these facts must not invent duplicate state.
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
    }

    refresh_graph_activity(graph);
}

fn refresh_graph_activity(graph: &mut SessionStateGraph) {
    graph.activity = select_session_graph_activity(
        &graph.lifecycle,
        &graph.turn_state,
        &graph.operations,
        &graph.interactions,
        graph.active_turn_failure.as_ref(),
    );
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

fn empty_graph(ctx: &FoldContext) -> SessionStateGraph {
    SessionStateGraph {
        requested_session_id: ctx.session_id.clone(),
        canonical_session_id: ctx.session_id.clone(),
        is_alias: false,
        agent_id: ctx.agent_id.clone(),
        project_path: ctx.project_path.clone(),
        worktree_path: None,
        source_path: None,
        sequence_id: None,
        revision: SessionGraphRevision::new(0, 0, 0),
        transcript_snapshot: TranscriptSnapshot {
            revision: 0,
            entries: Vec::new(),
        },
        operations: Vec::new(),
        interactions: Vec::new(),
        turn_state: SessionTurnState::Idle,
        message_count: 0,
        active_streaming_tail: None,
        active_turn_failure: None,
        last_terminal_turn_id: None,
        lifecycle: SessionGraphLifecycle::idle(),
        activity: SessionGraphActivity::idle(),
        capabilities: SessionGraphCapabilities::empty(),
    }
}

fn append_transcript_entry(
    graph: &mut SessionStateGraph,
    turn_context: &mut HistoryTurnContext,
    _event: &ProviderEvent,
    entry: TranscriptEntry,
) {
    graph.transcript_snapshot.revision += 1;
    let role = entry.role.clone();
    append_or_merge_entry(&mut graph.transcript_snapshot.entries, entry);
    turn_context.note_entry(&role, graph.transcript_snapshot.entries.len());
    graph.message_count += 1;
    graph.revision.transcript_revision = graph.transcript_snapshot.revision;
}

fn append_or_merge_entry(entries: &mut Vec<TranscriptEntry>, entry: TranscriptEntry) {
    let Some(last_entry) = entries.last_mut() else {
        entries.push(entry);
        return;
    };

    if last_entry.entry_id == entry.entry_id && last_entry.role == entry.role {
        if last_entry.timestamp_ms.is_none() {
            last_entry.timestamp_ms = entry.timestamp_ms;
        }
        last_entry.segments.extend(entry.segments);
        return;
    }

    entries.push(entry);
}

fn thought_text_for_display(text: &str, redacted_provider_data: Option<&str>) -> String {
    match redacted_provider_data {
        Some(_) if text.trim().is_empty() => "[REDACTED]".to_string(),
        _ => text.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::projections::{InteractionKind, InteractionState};
    use crate::acp::session_update::{
        AvailableCommand, AvailableCommandsData, CurrentModeData, InteractionReplyHandler,
        PermissionData, PlanData, QuestionData, UsageTelemetryData, UsageTelemetryTokens,
    };
    use crate::cc_sdk::AssistantMessageError;

    fn provider_event(provider_seq: u64, kind: ProviderEventKind) -> ProviderEvent {
        ProviderEvent {
            source: CanonicalAgentId::Cursor,
            provider_seq,
            provider_row_id: format!("row-{provider_seq}"),
            timestamp_ms: None,
            kind,
        }
    }

    #[test]
    fn fold_full_user_text_produces_transcript_entry() {
        let ctx = FoldContext::new("sess-1", CanonicalAgentId::Cursor, "/tmp");
        let events = vec![ProviderEvent {
            source: CanonicalAgentId::Cursor,
            provider_seq: 1,
            provider_row_id: "user-1".to_string(),
            timestamp_ms: None,
            kind: ProviderEventKind::UserText {
                text: "hi".to_string(),
                attempt_id: None,
            },
        }];

        let graph = fold_full(&events, &ctx);
        assert_eq!(graph.transcript_snapshot.entries.len(), 1);
        assert_eq!(graph.message_count, 1);
    }

    #[test]
    fn fold_user_text_entry_id_matches_display_id_authority() {
        let ctx = FoldContext::new("sess-1", CanonicalAgentId::Cursor, "/tmp");
        let events = vec![ProviderEvent {
            source: CanonicalAgentId::Cursor,
            provider_seq: 1,
            provider_row_id: "user-1".to_string(),
            timestamp_ms: None,
            kind: ProviderEventKind::UserText {
                text: "hi".to_string(),
                attempt_id: None,
            },
        }];

        let graph = fold_full(&events, &ctx);
        assert_eq!(graph.transcript_snapshot.entries.len(), 1);
        assert_eq!(
            graph.transcript_snapshot.entries[0].entry_id,
            "acepe::entry::session-start::user::."
        );
    }

    #[test]
    fn fold_merges_consecutive_assistant_text_into_one_entry() {
        let ctx = FoldContext::new("sess-1", CanonicalAgentId::Cursor, "/tmp");
        let events = vec![
            ProviderEvent {
                source: CanonicalAgentId::Cursor,
                provider_seq: 0,
                provider_row_id: "user-0".to_string(),
                timestamp_ms: None,
                kind: ProviderEventKind::UserText {
                    text: "hello".to_string(),
                    attempt_id: None,
                },
            },
            ProviderEvent {
                source: CanonicalAgentId::Cursor,
                provider_seq: 1,
                provider_row_id: "asst-1".to_string(),
                timestamp_ms: None,
                kind: ProviderEventKind::AssistantText {
                    text: "part one".to_string(),
                },
            },
            ProviderEvent {
                source: CanonicalAgentId::Cursor,
                provider_seq: 2,
                provider_row_id: "asst-2".to_string(),
                timestamp_ms: None,
                kind: ProviderEventKind::AssistantText {
                    text: "part two".to_string(),
                },
            },
            ProviderEvent {
                source: CanonicalAgentId::Cursor,
                provider_seq: 3,
                provider_row_id: "asst-3".to_string(),
                timestamp_ms: None,
                kind: ProviderEventKind::AssistantText {
                    text: "part three".to_string(),
                },
            },
        ];

        let graph = fold_full(&events, &ctx);
        assert_eq!(graph.transcript_snapshot.entries.len(), 2);
        assert_eq!(graph.message_count, 4);

        let assistant = &graph.transcript_snapshot.entries[1];
        assert_eq!(assistant.role, TranscriptEntryRole::Assistant);
        assert_eq!(assistant.segments.len(), 3);
        assert_eq!(
            assistant.segments[0],
            TranscriptSegment::Text {
                segment_id: "acepe::entry::assistant-boundary:1::assistant::.:segment:1"
                    .to_string(),
                text: "part one".to_string(),
            }
        );
        assert_eq!(
            assistant.segments[1],
            TranscriptSegment::Text {
                segment_id: "acepe::entry::assistant-boundary:1::assistant::.:segment:2"
                    .to_string(),
                text: "part two".to_string(),
            }
        );
        assert_eq!(
            assistant.segments[2],
            TranscriptSegment::Text {
                segment_id: "acepe::entry::assistant-boundary:1::assistant::.:segment:3"
                    .to_string(),
                text: "part three".to_string(),
            }
        );
    }

    #[test]
    fn fold_step_registers_permission_and_question_interactions() {
        let ctx = FoldContext::new("sess-1", CanonicalAgentId::Cursor, "/tmp");
        let empty = empty_graph(&ctx);
        let permission = PermissionData {
            id: "permission-1".to_string(),
            session_id: "sess-1".to_string(),
            json_rpc_request_id: Some(7),
            reply_handler: None,
            permission: "Read".to_string(),
            patterns: vec!["/tmp/file".to_string()],
            metadata: serde_json::json!({}),
            always: Vec::new(),
            auto_accepted: false,
            tool: None,
        };
        let (with_permission, _) = fold_step(
            &empty,
            &provider_event(1, ProviderEventKind::Permission(permission)),
        );

        assert_eq!(with_permission.interactions.len(), 1);
        assert_eq!(
            with_permission.interactions[0].kind,
            InteractionKind::Permission
        );
        assert_eq!(
            with_permission.interactions[0].state,
            InteractionState::Pending
        );
        assert_eq!(
            with_permission.interactions[0].reply_handler,
            Some(InteractionReplyHandler::json_rpc(7))
        );

        let question = QuestionData {
            id: "question-1".to_string(),
            session_id: "sess-1".to_string(),
            json_rpc_request_id: None,
            reply_handler: None,
            questions: Vec::new(),
            tool: None,
        };
        let (with_question, _) = fold_step(
            &with_permission,
            &provider_event(2, ProviderEventKind::Question(question)),
        );

        assert_eq!(with_question.interactions.len(), 2);
        assert_eq!(
            with_question.interactions[1].kind,
            InteractionKind::Question
        );
        assert_eq!(
            with_question.interactions[1].state,
            InteractionState::Pending
        );
        assert_eq!(
            with_question.interactions[1].reply_handler,
            Some(InteractionReplyHandler::http("question-1"))
        );
        assert_eq!(
            with_question.activity.kind,
            crate::acp::session_state_engine::selectors::SessionGraphActivityKind::WaitingForUser
        );
    }

    #[test]
    fn fold_full_closes_pending_question_before_selecting_activity() {
        let ctx = FoldContext::new("sess-1", CanonicalAgentId::Cursor, "/tmp");
        let question = QuestionData {
            id: "question-1".to_string(),
            session_id: "sess-1".to_string(),
            json_rpc_request_id: None,
            reply_handler: None,
            questions: Vec::new(),
            tool: None,
        };

        let graph = fold_full(
            &[provider_event(1, ProviderEventKind::Question(question))],
            &ctx,
        );

        assert_eq!(graph.interactions[0].state, InteractionState::Unresolved);
        assert_eq!(
            graph.activity.kind,
            crate::acp::session_state_engine::selectors::SessionGraphActivityKind::Idle
        );
    }

    #[test]
    fn fold_step_marks_auto_accepted_permission_as_answered() {
        let ctx = FoldContext::new("sess-1", CanonicalAgentId::Cursor, "/tmp");
        let empty = empty_graph(&ctx);
        let permission = PermissionData {
            id: "permission-1".to_string(),
            session_id: "sess-1".to_string(),
            json_rpc_request_id: None,
            reply_handler: None,
            permission: "Read".to_string(),
            patterns: Vec::new(),
            metadata: serde_json::json!({}),
            always: Vec::new(),
            auto_accepted: true,
            tool: None,
        };

        let (graph, _) = fold_step(
            &empty,
            &provider_event(12, ProviderEventKind::Permission(permission)),
        );

        let interaction = &graph.interactions[0];
        assert_eq!(interaction.state, InteractionState::Approved);
        assert_eq!(interaction.responded_at_event_seq, Some(12));
        assert!(matches!(
            interaction.response,
            Some(InteractionResponse::Permission { accepted: true, .. })
        ));
        assert_eq!(
            graph.activity.kind,
            crate::acp::session_state_engine::selectors::SessionGraphActivityKind::Idle
        );
    }

    #[test]
    fn fold_step_applies_mode_and_available_command_capabilities() {
        let ctx = FoldContext::new("sess-1", CanonicalAgentId::Cursor, "/tmp");
        let empty = empty_graph(&ctx);
        let (with_mode, _) = fold_step(
            &empty,
            &provider_event(
                1,
                ProviderEventKind::ModeUpdate(CurrentModeData {
                    current_mode_id: "plan".to_string(),
                }),
            ),
        );

        assert_eq!(
            with_mode
                .capabilities
                .modes
                .as_ref()
                .map(|modes| modes.current_mode_id.as_str()),
            Some("plan")
        );

        let (with_commands, _) = fold_step(
            &with_mode,
            &provider_event(
                2,
                ProviderEventKind::CapabilitiesUpdate(AvailableCommandsData {
                    available_commands: vec![AvailableCommand {
                        name: "compact".to_string(),
                        description: "Compact context".to_string(),
                        input: None,
                    }],
                }),
            ),
        );

        assert_eq!(
            with_commands
                .capabilities
                .available_commands
                .as_ref()
                .and_then(|commands| commands.first())
                .map(|command| command.name.as_str()),
            Some("compact")
        );
    }

    #[test]
    fn fold_step_applies_turn_boundaries_and_assistant_failure() {
        let ctx = FoldContext::new("sess-1", CanonicalAgentId::Cursor, "/tmp");
        let empty = empty_graph(&ctx);
        let (running, _) = fold_step(
            &empty,
            &provider_event(
                1,
                ProviderEventKind::TurnBegin {
                    request_id: Some("turn-1".to_string()),
                },
            ),
        );
        assert_eq!(running.turn_state, SessionTurnState::Running);

        let (failed, _) = fold_step(
            &running,
            &provider_event(
                2,
                ProviderEventKind::AssistantError {
                    text: "rate limited".to_string(),
                    error: AssistantMessageError::RateLimit,
                },
            ),
        );
        assert_eq!(failed.turn_state, SessionTurnState::Failed);
        let failure = failed.active_turn_failure.as_ref().expect("failure");
        assert_eq!(failure.message, "rate limited");
        assert_eq!(failure.code.as_deref(), Some("429"));
        assert_eq!(failure.turn_id, None);

        let (completed, _) = fold_step(
            &failed,
            &provider_event(
                3,
                ProviderEventKind::TurnEnd {
                    outcome: crate::acp::session::ingress::event::TurnOutcome::Completed,
                },
            ),
        );
        assert_eq!(completed.turn_state, SessionTurnState::Completed);
        assert!(completed.active_turn_failure.is_none());
        assert_eq!(completed.last_terminal_turn_id, None);
    }

    #[test]
    fn plan_and_usage_events_leave_graph_payload_fields_unchanged() {
        let ctx = FoldContext::new("sess-1", CanonicalAgentId::Cursor, "/tmp");
        let empty = empty_graph(&ctx);
        let (after_plan, _) = fold_step(
            &empty,
            &provider_event(1, ProviderEventKind::Plan(PlanData::from_steps(Vec::new()))),
        );
        let usage = UsageTelemetryData {
            session_id: "sess-1".to_string(),
            event_id: Some("usage-1".to_string()),
            scope: "turn".to_string(),
            cost_usd: Some(0.01),
            tokens: UsageTelemetryTokens::default(),
            source_model_id: None,
            timestamp_ms: None,
            context_window_size: None,
            context_window_source: None,
            parent_tool_use_id: None,
        };
        let (after_usage, _) = fold_step(
            &after_plan,
            &provider_event(2, ProviderEventKind::Usage(usage)),
        );

        assert_eq!(after_usage.transcript_snapshot.entries.len(), 0);
        assert_eq!(after_usage.operations.len(), 0);
        assert_eq!(after_usage.interactions.len(), 0);
        assert_eq!(after_usage.turn_state, SessionTurnState::Idle);
    }
}
