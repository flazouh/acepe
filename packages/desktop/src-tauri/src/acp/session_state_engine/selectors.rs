use crate::acp::client_session::{SessionModelState, SessionModes};
use crate::acp::projections::{
    InteractionSnapshot, InteractionState, OperationSnapshot, SessionTurnState, TurnFailureSnapshot,
};
use crate::acp::session_update::{AvailableCommand, ConfigOptionData, ToolCallStatus, ToolKind};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SessionGraphLifecycleStatus {
    Idle,
    Connecting,
    Ready,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionGraphLifecycle {
    pub status: SessionGraphLifecycleStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    pub can_reconnect: bool,
}

impl SessionGraphLifecycle {
    pub fn idle() -> Self {
        Self {
            status: SessionGraphLifecycleStatus::Idle,
            error_message: None,
            can_reconnect: true,
        }
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
        .filter(|operation| matches!(operation.status, ToolCallStatus::Pending | ToolCallStatus::InProgress))
        .collect();
    let blocking_interaction = interactions
        .iter()
        .find(|interaction| interaction.state == InteractionState::Pending);
    let dominant_operation_id = active_operations.first().map(|operation| operation.id.clone());
    let active_operation_count = u32::try_from(active_operations.len()).unwrap_or(u32::MAX);
    let active_subagent_count = u32::try_from(
        active_operations
            .iter()
            .filter(|operation| operation.kind == Some(ToolKind::Task))
            .count(),
    )
    .unwrap_or(u32::MAX);

    if lifecycle.status == SessionGraphLifecycleStatus::Error || active_turn_failure.is_some() {
        return SessionGraphActivity {
            kind: SessionGraphActivityKind::Error,
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
        SessionGraphLifecycle, SessionGraphLifecycleStatus,
    };
    use crate::acp::projections::{
        InteractionKind, InteractionPayload, InteractionSnapshot, InteractionState,
        OperationSnapshot, SessionTurnState, TurnFailureSnapshot,
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
            status,
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
        }
    }

    #[test]
    fn selector_returns_awaiting_model_when_turn_is_running_without_active_work() {
        let activity = select_session_graph_activity(
            &SessionGraphLifecycle {
                status: SessionGraphLifecycleStatus::Ready,
                error_message: None,
                can_reconnect: true,
            },
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
            &SessionGraphLifecycle {
                status: SessionGraphLifecycleStatus::Ready,
                error_message: None,
                can_reconnect: true,
            },
            &SessionTurnState::Running,
            &[
                active_operation("op-1", ToolCallStatus::InProgress, Some(ToolKind::Task), None),
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
            &SessionGraphLifecycle {
                status: SessionGraphLifecycleStatus::Ready,
                error_message: None,
                can_reconnect: true,
            },
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
            &SessionGraphLifecycle {
                status: SessionGraphLifecycleStatus::Ready,
                error_message: None,
                can_reconnect: true,
            },
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
}
