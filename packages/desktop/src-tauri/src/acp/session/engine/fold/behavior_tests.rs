use super::{empty_graph, fold_full, fold_step, FoldContext};
use crate::acp::projections::{
    InteractionKind, InteractionResponse, InteractionState, SessionTurnState,
};
use crate::acp::session::ingress::event::{ProviderEvent, ProviderEventKind};
use crate::acp::session_update::{
    AvailableCommand, AvailableCommandsData, CurrentModeData, InteractionReplyHandler,
    PermissionData, PlanData, QuestionData, TurnErrorKind, TurnErrorSource, UsageTelemetryData,
    UsageTelemetryTokens,
};
use crate::acp::types::CanonicalAgentId;
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
fn fold_step_preserves_structured_live_turn_failure() {
    use crate::acp::session_update::{TurnErrorData, TurnErrorInfo};

    let ctx = FoldContext::new("sess-1", CanonicalAgentId::Cursor, "/tmp");
    let empty = empty_graph(&ctx);
    let (failed, _) = fold_step(
        &empty,
        &provider_event(
            1,
            ProviderEventKind::TurnFailure {
                error: TurnErrorData::Structured(TurnErrorInfo {
                    message: "transport closed".to_string(),
                    kind: TurnErrorKind::Fatal,
                    code: Some("EPIPE".to_string()),
                    source: Some(TurnErrorSource::Transport),
                    details: Some("socket reset".to_string()),
                }),
                turn_id: Some("turn-1".to_string()),
            },
        ),
    );

    assert_eq!(failed.turn_state, SessionTurnState::Failed);
    let failure = failed.active_turn_failure.expect("failure");
    assert_eq!(failure.turn_id.as_deref(), Some("turn-1"));
    assert_eq!(failure.message, "transport closed");
    assert_eq!(failure.code.as_deref(), Some("EPIPE"));
    assert_eq!(failure.source, TurnErrorSource::Transport);
    assert_eq!(failed.last_terminal_turn_id.as_deref(), Some("turn-1"));
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
