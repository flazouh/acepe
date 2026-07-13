use super::{empty_graph, fold_step, FoldContext};
use crate::acp::client_session::{default_modes, default_session_model_state};
use crate::acp::lifecycle::{DetachedReason, FailureReason, LifecycleStatus};
use crate::acp::session::ingress::event::{ProviderEvent, ProviderEventKind};
use crate::acp::session_update::{TurnErrorData, TurnErrorInfo, TurnErrorKind, TurnErrorSource};
use crate::acp::types::CanonicalAgentId;

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
fn fold_step_applies_session_lifecycle_and_config_facts() {
    let ctx = FoldContext::new("sess-control", CanonicalAgentId::Cursor, "/tmp");
    let empty = empty_graph(&ctx);
    let (ready, _) = fold_step(
        &empty,
        &provider_event(
            1,
            ProviderEventKind::SessionReady {
                models: default_session_model_state(),
                modes: default_modes(),
                available_commands: None,
                config_options: None,
                autonomous_enabled: Some(true),
            },
        ),
    );
    assert_eq!(ready.lifecycle.status, LifecycleStatus::Ready);
    assert_eq!(ready.capabilities.autonomous_enabled, Some(true));

    let (configured, _) = fold_step(
        &ready,
        &provider_event(
            2,
            ProviderEventKind::ConfigOptionsUpdate(
                crate::acp::session_update::ConfigOptionUpdateData {
                    config_options: Vec::new(),
                },
            ),
        ),
    );
    assert!(configured
        .capabilities
        .config_options
        .as_ref()
        .is_some_and(Vec::is_empty));

    let (failed, _) = fold_step(
        &configured,
        &provider_event(
            3,
            ProviderEventKind::SessionFailed {
                error: "offline".to_string(),
                failure_reason: FailureReason::ResumeFailed,
            },
        ),
    );
    assert_eq!(failed.lifecycle.status, LifecycleStatus::Failed);
    assert_eq!(
        failed.lifecycle.failure_reason,
        Some(FailureReason::ResumeFailed)
    );
    assert_eq!(failed.lifecycle.error_message.as_deref(), Some("offline"));

    let (detached, _) = fold_step(
        &failed,
        &provider_event(
            4,
            ProviderEventKind::SessionDetached {
                detached_reason: DetachedReason::ReconnectExhausted,
            },
        ),
    );
    assert_eq!(detached.lifecycle.status, LifecycleStatus::Detached);
    assert_eq!(
        detached.lifecycle.detached_reason,
        Some(DetachedReason::ReconnectExhausted)
    );
    assert_eq!(detached.revision.graph_revision, 4);
    assert_eq!(detached.revision.last_event_seq, 4);
}

#[test]
fn turn_failure_during_activation_promotes_lifecycle_to_activation_failed() {
    let ctx = FoldContext::new("sess-activation-failure", CanonicalAgentId::Cursor, "/tmp");
    let reserved = empty_graph(&ctx);
    let mut activating = reserved.clone();
    activating.lifecycle =
        crate::acp::session_state_engine::selectors::SessionGraphLifecycle::activating();

    for (provider_seq, graph) in [(1, reserved), (2, activating)] {
        let (failed, _) = fold_step(
            &graph,
            &provider_event(
                provider_seq,
                ProviderEventKind::TurnFailure {
                    error: TurnErrorData::Structured(TurnErrorInfo {
                        message: "agent failed to start".to_string(),
                        kind: TurnErrorKind::Fatal,
                        code: Some("START_FAILED".to_string()),
                        source: Some(TurnErrorSource::Transport),
                        details: Some("connection closed".to_string()),
                    }),
                    turn_id: Some("activation-turn".to_string()),
                },
            ),
        );

        assert_eq!(failed.lifecycle.status, LifecycleStatus::Failed);
        assert_eq!(
            failed.lifecycle.failure_reason,
            Some(FailureReason::ActivationFailed)
        );
        assert_eq!(
            failed.lifecycle.error_message.as_deref(),
            Some("agent failed to start")
        );
        let turn_failure = failed.active_turn_failure.expect("structured turn failure");
        assert_eq!(turn_failure.code.as_deref(), Some("START_FAILED"));
        assert_eq!(turn_failure.details.as_deref(), Some("connection closed"));
        assert_eq!(turn_failure.source, TurnErrorSource::Transport);
    }
}

#[test]
fn turn_failure_after_ready_preserves_ready_lifecycle() {
    let ctx = FoldContext::new("sess-ready-turn-failure", CanonicalAgentId::Cursor, "/tmp");
    let mut ready = empty_graph(&ctx);
    ready.lifecycle = crate::acp::session_state_engine::selectors::SessionGraphLifecycle::ready();

    let (failed_turn, _) = fold_step(
        &ready,
        &provider_event(
            1,
            ProviderEventKind::TurnFailure {
                error: TurnErrorData::Legacy("turn failed".to_string()),
                turn_id: Some("turn-1".to_string()),
            },
        ),
    );

    assert_eq!(failed_turn.lifecycle.status, LifecycleStatus::Ready);
    assert_eq!(failed_turn.lifecycle.failure_reason, None);
    assert_eq!(failed_turn.lifecycle.error_message, None);
    assert_eq!(
        failed_turn
            .active_turn_failure
            .as_ref()
            .map(|failure| failure.message.as_str()),
        Some("turn failed")
    );
}
