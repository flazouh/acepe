use crate::acp::client_session::{SessionModelState, SessionModes};
use crate::acp::lifecycle::{DetachedReason, FailureReason, LifecycleState, LifecycleStatus};
use crate::acp::projections::{
    InteractionSnapshot, InteractionState, OperationSnapshot, SessionTurnState, TurnFailureSnapshot,
};
use crate::acp::session_update::{AvailableCommand, ConfigOptionData, ToolKind};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SessionRecommendedAction {
    None,
    Wait,
    Send,
    Resume,
    Retry,
    Archive,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SessionRecoveryPhase {
    None,
    Activating,
    Reconnecting,
    Detached,
    Failed,
    Archived,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionGraphActionability {
    pub can_send: bool,
    pub can_resume: bool,
    pub can_retry: bool,
    pub can_archive: bool,
    pub can_configure: bool,
    pub recommended_action: SessionRecommendedAction,
    pub recovery_phase: SessionRecoveryPhase,
    pub compact_status: LifecycleStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionGraphLifecycle {
    pub status: LifecycleStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detached_reason: Option<DetachedReason>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_reason: Option<FailureReason>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    pub actionability: SessionGraphActionability,
}

impl SessionGraphLifecycle {
    #[must_use]
    pub fn idle() -> Self {
        Self::reserved()
    }

    #[must_use]
    pub fn reserved() -> Self {
        Self::from_lifecycle_state(LifecycleState::reserved())
    }

    #[must_use]
    pub fn activating() -> Self {
        Self::from_lifecycle_state(LifecycleState::activating())
    }

    #[must_use]
    pub fn ready() -> Self {
        Self::from_lifecycle_state(LifecycleState::ready())
    }

    #[must_use]
    pub fn reconnecting() -> Self {
        Self::from_lifecycle_state(LifecycleState::reconnecting())
    }

    #[must_use]
    pub fn detached(reason: DetachedReason) -> Self {
        Self::from_lifecycle_state(LifecycleState::detached(reason))
    }

    #[must_use]
    pub fn failed(reason: FailureReason, error_message: Option<String>) -> Self {
        Self::from_lifecycle_state(LifecycleState::failed(reason, error_message))
    }

    #[must_use]
    pub fn archived() -> Self {
        Self::from_lifecycle_state(LifecycleState::archived())
    }

    #[must_use]
    pub fn from_lifecycle_state(lifecycle: LifecycleState) -> Self {
        let actionability = actionability_for_lifecycle(&lifecycle);
        Self {
            status: lifecycle.status,
            detached_reason: lifecycle.detached_reason,
            failure_reason: lifecycle.failure_reason,
            error_message: lifecycle.error_message,
            actionability,
        }
    }

    #[must_use]
    pub fn lifecycle_state(&self) -> LifecycleState {
        LifecycleState {
            status: self.status,
            detached_reason: self.detached_reason,
            failure_reason: self.failure_reason,
            error_message: self.error_message.clone(),
        }
    }
}

impl From<LifecycleState> for SessionGraphLifecycle {
    fn from(value: LifecycleState) -> Self {
        Self::from_lifecycle_state(value)
    }
}

fn is_retryable_failure(reason: Option<FailureReason>) -> bool {
    matches!(
        reason,
        Some(FailureReason::ActivationFailed | FailureReason::ResumeFailed)
    )
}

fn actionability_for_lifecycle(lifecycle: &LifecycleState) -> SessionGraphActionability {
    let can_retry = lifecycle.status == LifecycleStatus::Failed
        && is_retryable_failure(lifecycle.failure_reason);
    SessionGraphActionability {
        can_send: lifecycle.status == LifecycleStatus::Ready,
        can_resume: lifecycle.status == LifecycleStatus::Detached,
        can_retry,
        can_archive: !matches!(lifecycle.status, LifecycleStatus::Archived),
        can_configure: lifecycle.status == LifecycleStatus::Ready,
        recommended_action: match lifecycle.status {
            LifecycleStatus::Reserved
            | LifecycleStatus::Activating
            | LifecycleStatus::Reconnecting => SessionRecommendedAction::Wait,
            LifecycleStatus::Ready => SessionRecommendedAction::Send,
            LifecycleStatus::Detached => SessionRecommendedAction::Resume,
            LifecycleStatus::Failed if can_retry => SessionRecommendedAction::Retry,
            LifecycleStatus::Failed => SessionRecommendedAction::Archive,
            LifecycleStatus::Archived => SessionRecommendedAction::None,
        },
        recovery_phase: match lifecycle.status {
            LifecycleStatus::Reserved | LifecycleStatus::Ready => SessionRecoveryPhase::None,
            LifecycleStatus::Activating => SessionRecoveryPhase::Activating,
            LifecycleStatus::Reconnecting => SessionRecoveryPhase::Reconnecting,
            LifecycleStatus::Detached => SessionRecoveryPhase::Detached,
            LifecycleStatus::Failed => SessionRecoveryPhase::Failed,
            LifecycleStatus::Archived => SessionRecoveryPhase::Archived,
        },
        compact_status: lifecycle.status,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionGraphCapabilities {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub models: Option<SessionModelState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modes: Option<SessionModes>,
    #[serde(default)]
    pub available_commands: Vec<AvailableCommand>,
    #[serde(default)]
    pub config_options: Vec<ConfigOptionData>,
    #[serde(default)]
    pub autonomous_enabled: bool,
}

impl SessionGraphCapabilities {
    pub fn empty() -> Self {
        Self {
            models: None,
            modes: None,
            available_commands: Vec::new(),
            config_options: Vec::new(),
            autonomous_enabled: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SessionGraphActivityKind {
    AwaitingModel,
    RunningOperation,
    WaitingForUser,
    Paused,
    Error,
    Idle,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionGraphActivity {
    pub kind: SessionGraphActivityKind,
    pub active_operation_count: u32,
    pub active_subagent_count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dominant_operation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocking_interaction_id: Option<String>,
}

impl SessionGraphActivity {
    #[must_use]
    pub fn idle() -> Self {
        Self {
            kind: SessionGraphActivityKind::Idle,
            active_operation_count: 0,
            active_subagent_count: 0,
            dominant_operation_id: None,
            blocking_interaction_id: None,
        }
    }
}

#[must_use]
pub fn select_session_graph_activity(
    lifecycle: &SessionGraphLifecycle,
    turn_state: &SessionTurnState,
    operations: &[OperationSnapshot],
    interactions: &[InteractionSnapshot],
    active_turn_failure: Option<&TurnFailureSnapshot>,
) -> SessionGraphActivity {
    let active_operations: Vec<&OperationSnapshot> = operations
        .iter()
        .filter(|operation| {
            matches!(
                operation.operation_state,
                Some(crate::acp::projections::OperationState::Pending)
                    | Some(crate::acp::projections::OperationState::Running)
                    | Some(crate::acp::projections::OperationState::Blocked)
            )
        })
        .collect();
    let blocking_interaction = interactions
        .iter()
        .find(|interaction| interaction.state == InteractionState::Pending);
    let dominant_operation_id = active_operations
        .first()
        .map(|operation| operation.id.clone());
    let active_operation_count = u32::try_from(active_operations.len()).unwrap_or(u32::MAX);
    let active_subagent_count = u32::try_from(
        active_operations
            .iter()
            .filter(|operation| operation.kind == Some(ToolKind::Task))
            .count(),
    )
    .unwrap_or(u32::MAX);

    if lifecycle.status == LifecycleStatus::Failed || active_turn_failure.is_some() {
        return SessionGraphActivity {
            kind: SessionGraphActivityKind::Error,
            active_operation_count,
            active_subagent_count,
            dominant_operation_id,
            blocking_interaction_id: blocking_interaction.map(|interaction| interaction.id.clone()),
        };
    }

    if matches!(
        lifecycle.status,
        LifecycleStatus::Detached | LifecycleStatus::Archived
    ) {
        return SessionGraphActivity {
            kind: SessionGraphActivityKind::Paused,
            active_operation_count,
            active_subagent_count,
            dominant_operation_id,
            blocking_interaction_id: blocking_interaction.map(|interaction| interaction.id.clone()),
        };
    }

    if let Some(interaction) = blocking_interaction {
        return SessionGraphActivity {
            kind: SessionGraphActivityKind::WaitingForUser,
            active_operation_count,
            active_subagent_count,
            dominant_operation_id,
            blocking_interaction_id: Some(interaction.id.clone()),
        };
    }

    if active_operation_count > 0 {
        return SessionGraphActivity {
            kind: SessionGraphActivityKind::RunningOperation,
            active_operation_count,
            active_subagent_count,
            dominant_operation_id,
            blocking_interaction_id: None,
        };
    }

    if *turn_state == SessionTurnState::Running {
        return SessionGraphActivity {
            kind: SessionGraphActivityKind::AwaitingModel,
            active_operation_count: 0,
            active_subagent_count: 0,
            dominant_operation_id: None,
            blocking_interaction_id: None,
        };
    }

    SessionGraphActivity::idle()
}

#[cfg(test)]
mod tests {
    use super::{
        select_session_graph_activity, SessionGraphActivityKind, SessionGraphCapabilities,
        SessionGraphLifecycle,
    };
    use crate::acp::lifecycle::{DetachedReason, FailureReason, LifecycleStatus};
    use crate::acp::projections::{
        InteractionKind, InteractionPayload, InteractionSnapshot, InteractionState,
        OperationSnapshot, OperationState, SessionTurnState, TurnFailureSnapshot,
    };
    use crate::acp::session_update::{
        PermissionData, ToolArguments, ToolCallStatus, ToolKind, TurnErrorKind, TurnErrorSource,
    };
    use serde_json::json;

    fn active_operation(
        id: &str,
        status: ToolCallStatus,
        kind: Option<ToolKind>,
        parent_operation_id: Option<&str>,
    ) -> OperationSnapshot {
        OperationSnapshot {
            id: id.to_string(),
            session_id: "session-1".to_string(),
            tool_call_id: format!("tool-{id}"),
            name: "task".to_string(),
            kind,
            status: status.clone(),
            title: None,
            arguments: ToolArguments::Other { raw: json!({}) },
            progressive_arguments: None,
            result: None,
            command: None,
            normalized_todos: None,
            parent_tool_call_id: parent_operation_id.map(|parent| format!("tool-{parent}")),
            parent_operation_id: parent_operation_id.map(str::to_string),
            child_tool_call_ids: Vec::new(),
            child_operation_ids: Vec::new(),
            operation_provenance_key: None,
            operation_state: Some(match status {
                ToolCallStatus::Pending => OperationState::Pending,
                ToolCallStatus::InProgress => OperationState::Running,
                ToolCallStatus::Completed => OperationState::Completed,
                ToolCallStatus::Failed => OperationState::Failed,
            }),
            locations: None,
            skill_meta: None,
            normalized_questions: None,
            question_answer: None,
            awaiting_plan_approval: false,
            plan_approval_request_id: None,
            started_at_ms: None,
            completed_at_ms: None,
            source_entry_id: None,
            degradation_reason: None,
        }
    }

    fn pending_interaction(id: &str) -> InteractionSnapshot {
        InteractionSnapshot {
            id: id.to_string(),
            session_id: "session-1".to_string(),
            kind: InteractionKind::Permission,
            state: InteractionState::Pending,
            json_rpc_request_id: Some(1),
            reply_handler: None,
            tool_reference: None,
            responded_at_event_seq: None,
            response: None,
            payload: InteractionPayload::Permission(PermissionData {
                id: id.to_string(),
                session_id: "session-1".to_string(),
                json_rpc_request_id: Some(1),
                reply_handler: None,
                permission: "execute".to_string(),
                patterns: vec!["echo hi".to_string()],
                metadata: json!({ "command": "echo hi" }),
                always: Vec::new(),
                auto_accepted: false,
                tool: None,
            }),
            canonical_operation_id: None,
        }
    }

    #[test]
    fn selector_returns_awaiting_model_when_turn_is_running_without_active_work() {
        let activity = select_session_graph_activity(
            &SessionGraphLifecycle::ready(),
            &SessionTurnState::Running,
            &[],
            &[],
            None,
        );

        assert_eq!(activity.kind, SessionGraphActivityKind::AwaitingModel);
        assert_eq!(activity.active_operation_count, 0);
        assert_eq!(activity.active_subagent_count, 0);
        assert_eq!(activity.dominant_operation_id, None);
    }

    #[test]
    fn selector_returns_running_operation_with_cardinality_and_subagent_counts() {
        let activity = select_session_graph_activity(
            &SessionGraphLifecycle::ready(),
            &SessionTurnState::Running,
            &[
                active_operation(
                    "op-1",
                    ToolCallStatus::InProgress,
                    Some(ToolKind::Task),
                    None,
                ),
                active_operation(
                    "op-2",
                    ToolCallStatus::Pending,
                    Some(ToolKind::Execute),
                    Some("op-1"),
                ),
            ],
            &[],
            None,
        );

        assert_eq!(activity.kind, SessionGraphActivityKind::RunningOperation);
        assert_eq!(activity.active_operation_count, 2);
        assert_eq!(activity.active_subagent_count, 1);
        assert_eq!(activity.dominant_operation_id.as_deref(), Some("op-1"));
    }

    #[test]
    fn selector_prefers_pending_interactions_over_running_operations() {
        let activity = select_session_graph_activity(
            &SessionGraphLifecycle::ready(),
            &SessionTurnState::Running,
            &[active_operation(
                "op-1",
                ToolCallStatus::InProgress,
                Some(ToolKind::Execute),
                None,
            )],
            &[pending_interaction("interaction-1")],
            None,
        );

        assert_eq!(activity.kind, SessionGraphActivityKind::WaitingForUser);
        assert_eq!(
            activity.blocking_interaction_id.as_deref(),
            Some("interaction-1")
        );
        assert_eq!(activity.dominant_operation_id.as_deref(), Some("op-1"));
    }

    #[test]
    fn selector_prefers_errors_over_waiting_and_running() {
        let activity = select_session_graph_activity(
            &SessionGraphLifecycle::ready(),
            &SessionTurnState::Failed,
            &[active_operation(
                "op-1",
                ToolCallStatus::InProgress,
                Some(ToolKind::Task),
                None,
            )],
            &[pending_interaction("interaction-1")],
            Some(&TurnFailureSnapshot {
                turn_id: Some("turn-1".to_string()),
                message: "boom".to_string(),
                code: Some("E_FAIL".to_string()),
                kind: TurnErrorKind::Recoverable,
                source: TurnErrorSource::Process,
            }),
        );

        assert_eq!(activity.kind, SessionGraphActivityKind::Error);
        assert_eq!(activity.active_operation_count, 1);
        assert_eq!(activity.active_subagent_count, 1);
        assert_eq!(activity.dominant_operation_id.as_deref(), Some("op-1"));
        assert_eq!(
            activity.blocking_interaction_id.as_deref(),
            Some("interaction-1")
        );
    }

    #[test]
    fn capabilities_empty_stays_stable() {
        let capabilities = SessionGraphCapabilities::empty();

        assert!(capabilities.models.is_none());
        assert!(capabilities.modes.is_none());
        assert!(capabilities.available_commands.is_empty());
        assert!(capabilities.config_options.is_empty());
        assert!(!capabilities.autonomous_enabled);
    }

    #[test]
    fn lifecycle_actionability_uses_seven_state_contract() {
        let ready = SessionGraphLifecycle::ready();
        assert_eq!(ready.status, LifecycleStatus::Ready);
        assert!(ready.actionability.can_send);
        assert!(ready.actionability.can_archive);
        assert!(!ready.actionability.can_resume);
        assert!(!ready.actionability.can_retry);

        let detached = SessionGraphLifecycle::detached(DetachedReason::ReconnectExhausted);
        assert_eq!(detached.status, LifecycleStatus::Detached);
        assert!(detached.actionability.can_resume);
        assert!(!detached.actionability.can_send);

        let failed = SessionGraphLifecycle::failed(FailureReason::ResumeFailed, None);
        assert_eq!(failed.status, LifecycleStatus::Failed);
        assert!(failed.actionability.can_retry);

        let archived = SessionGraphLifecycle::archived();
        assert_eq!(archived.status, LifecycleStatus::Archived);
        assert!(!archived.actionability.can_archive);
    }
}
