//! Session and interaction projection snapshots for the hub (operations, permissions, questions).
//!
//! Tool-call **argument** semantics and payload shaping for the desktop wire contract live in
//! [`crate::acp::reconciler::projector`]. This module tracks operational state derived from
//! already-projected [`ToolCallData`] / updates — it does not re-classify tools.

use crate::acp::session_thread_snapshot::SessionThreadSnapshot;
use crate::acp::session_update::{
    InteractionReplyHandler, PermissionData, QuestionData, SessionUpdate, ToolArguments,
    ToolCallData, ToolCallStatus, ToolCallUpdateData, ToolKind, ToolReference,
};
use crate::acp::types::CanonicalAgentId;
use crate::session_jsonl::types::ConvertedSession;
use crate::session_jsonl::types::StoredEntry;
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::Type;
use std::sync::Arc;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum SessionTurnState {
    Idle,
    Running,
    Completed,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct TurnFailureSnapshot {
    pub turn_id: Option<String>,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    pub kind: crate::acp::session_update::TurnErrorKind,
    pub source: crate::acp::session_update::TurnErrorSource,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SessionSnapshot {
    pub session_id: String,
    pub agent_id: Option<CanonicalAgentId>,
    pub last_event_seq: i64,
    pub turn_state: SessionTurnState,
    pub message_count: u64,
    pub last_agent_message_id: Option<String>,
    pub active_tool_call_ids: Vec<String>,
    pub completed_tool_call_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_turn_failure: Option<TurnFailureSnapshot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_terminal_turn_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct OperationSnapshot {
    pub id: String,
    pub session_id: String,
    pub tool_call_id: String,
    pub name: String,
    pub kind: Option<crate::acp::session_update::ToolKind>,
    pub status: ToolCallStatus,
    pub title: Option<String>,
    pub arguments: crate::acp::session_update::ToolArguments,
    pub progressive_arguments: Option<crate::acp::session_update::ToolArguments>,
    pub result: Option<Value>,
    pub command: Option<String>,
    pub parent_tool_call_id: Option<String>,
    pub parent_operation_id: Option<String>,
    pub child_tool_call_ids: Vec<String>,
    pub child_operation_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum InteractionKind {
    Permission,
    Question,
    PlanApproval,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum InteractionState {
    Pending,
    Approved,
    Rejected,
    Answered,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum PlanApprovalSource {
    CreatePlan,
    ExitPlanMode,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub enum InteractionPayload {
    Permission(PermissionData),
    Question(QuestionData),
    PlanApproval { source: PlanApprovalSource },
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum InteractionResponse {
    Permission {
        accepted: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        option_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        reply: Option<String>,
    },
    Question {
        answers: Value,
    },
    PlanApproval {
        approved: bool,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct InteractionSnapshot {
    pub id: String,
    pub session_id: String,
    pub kind: InteractionKind,
    pub state: InteractionState,
    pub json_rpc_request_id: Option<u64>,
    pub reply_handler: Option<InteractionReplyHandler>,
    pub tool_reference: Option<ToolReference>,
    pub responded_at_event_seq: Option<i64>,
    pub response: Option<InteractionResponse>,
    pub payload: InteractionPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SessionProjectionSnapshot {
    pub session: Option<SessionSnapshot>,
    pub operations: Vec<OperationSnapshot>,
    pub interactions: Vec<InteractionSnapshot>,
}

impl SessionSnapshot {
    #[must_use]
    pub fn new(session_id: String, agent_id: Option<CanonicalAgentId>) -> Self {
        Self {
            session_id,
            agent_id,
            last_event_seq: 0,
            turn_state: SessionTurnState::Idle,
            message_count: 0,
            last_agent_message_id: None,
            active_tool_call_ids: Vec::new(),
            completed_tool_call_ids: Vec::new(),
            active_turn_failure: None,
            last_terminal_turn_id: None,
        }
    }
}

fn matches_terminal_turn_id(left: Option<&str>, right: Option<&str>) -> bool {
    match (left, right) {
        (Some(left), Some(right)) => left == right,
        (None, None) => true,
        _ => false,
    }
}

fn preserves_failed_turn(snapshot: &SessionSnapshot) -> bool {
    snapshot.turn_state == SessionTurnState::Failed && snapshot.active_turn_failure.is_some()
}

fn start_running_turn(snapshot: &mut SessionSnapshot) {
    snapshot.turn_state = SessionTurnState::Running;
    snapshot.active_turn_failure = None;
    snapshot.last_terminal_turn_id = None;
}

fn should_ignore_turn_complete(snapshot: &SessionSnapshot, turn_id: Option<&str>) -> bool {
    preserves_failed_turn(snapshot)
        && (turn_id.is_none()
            || matches_terminal_turn_id(snapshot.last_terminal_turn_id.as_deref(), turn_id))
}

#[derive(Debug, Clone, Default)]
pub struct ProjectionRegistry {
    snapshots: Arc<DashMap<String, SessionSnapshot>>,
    operations_by_id: Arc<DashMap<String, OperationSnapshot>>,
    operation_id_by_tool_key: Arc<DashMap<String, String>>,
    session_operation_ids: Arc<DashMap<String, Vec<String>>>,
    interactions_by_id: Arc<DashMap<String, InteractionSnapshot>>,
    interaction_id_by_request_key: Arc<DashMap<String, String>>,
    session_interaction_ids: Arc<DashMap<String, Vec<String>>>,
}

impl ProjectionRegistry {
    #[must_use]
    pub fn new() -> Self {
        Self {
            snapshots: Arc::new(DashMap::new()),
            operations_by_id: Arc::new(DashMap::new()),
            operation_id_by_tool_key: Arc::new(DashMap::new()),
            session_operation_ids: Arc::new(DashMap::new()),
            interactions_by_id: Arc::new(DashMap::new()),
            interaction_id_by_request_key: Arc::new(DashMap::new()),
            session_interaction_ids: Arc::new(DashMap::new()),
        }
    }

    pub fn register_session(&self, session_id: String, agent_id: CanonicalAgentId) {
        let _ = self
            .snapshots
            .entry(session_id.clone())
            .and_modify(|snapshot| {
                snapshot.agent_id = Some(agent_id.clone());
            })
            .or_insert_with(|| SessionSnapshot::new(session_id, Some(agent_id)));
    }

    pub fn restore_session_projection(&self, projection: SessionProjectionSnapshot) {
        let session_id = projection
            .session
            .as_ref()
            .map(|session| session.session_id.clone())
            .or_else(|| {
                projection
                    .operations
                    .first()
                    .map(|operation| operation.session_id.clone())
            })
            .or_else(|| {
                projection
                    .interactions
                    .first()
                    .map(|interaction| interaction.session_id.clone())
            });
        let Some(session_id) = session_id else {
            return;
        };

        self.remove_session(&session_id);
        if let Some(session) = projection.session {
            self.snapshots.insert(session_id.clone(), session);
        }
        for operation in projection.operations {
            self.operations_by_id
                .insert(operation.id.clone(), operation.clone());
            self.operation_id_by_tool_key.insert(
                create_session_tool_key(&session_id, &operation.tool_call_id),
                operation.id.clone(),
            );
            self.insert_session_operation_id(&session_id, &operation.id);
        }
        for interaction in projection.interactions {
            self.upsert_interaction(interaction);
        }
    }

    #[must_use]
    pub fn project_thread_snapshot(
        session_id: &str,
        agent_id: Option<CanonicalAgentId>,
        thread_snapshot: &SessionThreadSnapshot,
    ) -> SessionProjectionSnapshot {
        let registry = Self::new();
        registry.import_thread_snapshot(session_id, agent_id, thread_snapshot);
        registry.session_projection(session_id)
    }

    #[must_use]
    pub fn project_converted_session(
        session_id: &str,
        agent_id: Option<CanonicalAgentId>,
        converted: &ConvertedSession,
    ) -> SessionProjectionSnapshot {
        let thread_snapshot = SessionThreadSnapshot::from(converted.clone());
        Self::project_thread_snapshot(session_id, agent_id, &thread_snapshot)
    }

    pub fn remove_session(&self, session_id: &str) {
        self.snapshots.remove(session_id);
        if let Some((_, operation_ids)) = self.session_operation_ids.remove(session_id) {
            for operation_id in operation_ids {
                if let Some((_, operation)) = self.operations_by_id.remove(&operation_id) {
                    self.operation_id_by_tool_key
                        .remove(&create_session_tool_key(
                            session_id,
                            &operation.tool_call_id,
                        ));
                }
            }
        }
        if let Some((_, interaction_ids)) = self.session_interaction_ids.remove(session_id) {
            for interaction_id in interaction_ids {
                if let Some((_, interaction)) = self.interactions_by_id.remove(&interaction_id) {
                    if let Some(request_id) = interaction.json_rpc_request_id {
                        self.interaction_id_by_request_key
                            .remove(&create_session_request_key(session_id, request_id));
                    }
                }
            }
        }
    }

    #[must_use]
    pub fn snapshot_for_session(&self, session_id: &str) -> Option<SessionSnapshot> {
        self.snapshots.get(session_id).map(|entry| entry.clone())
    }

    pub fn apply_session_update(&self, session_id: &str, update: &SessionUpdate) {
        let mut snapshot = self
            .snapshots
            .entry(session_id.to_string())
            .or_insert_with(|| SessionSnapshot::new(session_id.to_string(), None));

        snapshot.last_event_seq = snapshot.last_event_seq.saturating_add(1);

        match update {
            SessionUpdate::UserMessageChunk { .. } => {
                snapshot.message_count = snapshot.message_count.saturating_add(1);
                start_running_turn(&mut snapshot);
            }
            SessionUpdate::AgentMessageChunk { message_id, .. } => {
                snapshot.message_count = snapshot.message_count.saturating_add(1);
                if let Some(message_id) = message_id {
                    snapshot.last_agent_message_id = Some(message_id.clone());
                }
                if !preserves_failed_turn(&snapshot) {
                    start_running_turn(&mut snapshot);
                }
            }
            SessionUpdate::AgentThoughtChunk { .. } if !preserves_failed_turn(&snapshot) => {
                start_running_turn(&mut snapshot);
            }
            SessionUpdate::AgentThoughtChunk { .. } => {}
            SessionUpdate::ToolCall { tool_call, .. } => {
                upsert_active_tool_call(&mut snapshot.active_tool_call_ids, &tool_call.id);
                if is_terminal_tool_call_status(&tool_call.status) {
                    mark_tool_call_completed(&mut snapshot, &tool_call.id);
                }
                self.upsert_tool_call_projection(
                    session_id,
                    tool_call,
                    None,
                    tool_call.parent_tool_use_id.clone(),
                );
                self.register_plan_approval_interaction(session_id, tool_call);
                if !preserves_failed_turn(&snapshot) {
                    start_running_turn(&mut snapshot);
                }
            }
            SessionUpdate::ToolCallUpdate { update, .. } => {
                upsert_active_tool_call(&mut snapshot.active_tool_call_ids, &update.tool_call_id);
                if update
                    .status
                    .as_ref()
                    .is_some_and(is_terminal_tool_call_status)
                {
                    mark_tool_call_completed(&mut snapshot, &update.tool_call_id);
                }
                self.apply_tool_call_update_projection(session_id, update);
                if !preserves_failed_turn(&snapshot) {
                    start_running_turn(&mut snapshot);
                }
            }
            SessionUpdate::PermissionRequest { permission, .. } => {
                self.register_permission_interaction(permission, snapshot.last_event_seq);
            }
            SessionUpdate::QuestionRequest { question, .. } => {
                self.register_question_interaction(question);
            }
            SessionUpdate::TurnComplete { turn_id, .. } => {
                if should_ignore_turn_complete(&snapshot, turn_id.as_deref()) {
                    return;
                }
                snapshot.turn_state = SessionTurnState::Completed;
                snapshot.active_tool_call_ids.clear();
                snapshot.active_turn_failure = None;
                snapshot.last_terminal_turn_id = turn_id.clone();
            }
            SessionUpdate::TurnError { error, turn_id, .. } => {
                if preserves_failed_turn(&snapshot)
                    && matches_terminal_turn_id(
                        snapshot.last_terminal_turn_id.as_deref(),
                        turn_id.as_deref(),
                    )
                {
                    return;
                }
                snapshot.turn_state = SessionTurnState::Failed;
                snapshot.active_tool_call_ids.clear();
                snapshot.active_turn_failure =
                    Some(convert_turn_error_snapshot(error, turn_id.clone()));
                snapshot.last_terminal_turn_id = turn_id.clone();
            }
            _ => {}
        }
    }

    #[must_use]
    pub fn operation_for_tool_call(
        &self,
        session_id: &str,
        tool_call_id: &str,
    ) -> Option<OperationSnapshot> {
        let tool_key = create_session_tool_key(session_id, tool_call_id);
        let operation_id = self.operation_id_by_tool_key.get(&tool_key)?;
        self.operations_by_id
            .get(operation_id.value())
            .map(|snapshot| snapshot.clone())
    }

    #[must_use]
    pub fn session_operations(&self, session_id: &str) -> Vec<OperationSnapshot> {
        let Some(operation_ids) = self.session_operation_ids.get(session_id) else {
            return Vec::new();
        };

        operation_ids
            .iter()
            .filter_map(|operation_id| {
                self.operations_by_id
                    .get(operation_id)
                    .map(|snapshot| snapshot.clone())
            })
            .collect()
    }

    #[must_use]
    pub fn interaction(&self, interaction_id: &str) -> Option<InteractionSnapshot> {
        self.interactions_by_id
            .get(interaction_id)
            .map(|interaction| interaction.clone())
    }

    #[must_use]
    pub fn session_interactions(&self, session_id: &str) -> Vec<InteractionSnapshot> {
        let Some(interaction_ids) = self.session_interaction_ids.get(session_id) else {
            return Vec::new();
        };

        interaction_ids
            .iter()
            .filter_map(|interaction_id| {
                self.interactions_by_id
                    .get(interaction_id)
                    .map(|interaction| interaction.clone())
            })
            .collect()
    }

    #[must_use]
    pub fn session_projection(&self, session_id: &str) -> SessionProjectionSnapshot {
        SessionProjectionSnapshot {
            session: self.snapshot_for_session(session_id),
            operations: self.session_operations(session_id),
            interactions: self.session_interactions(session_id),
        }
    }

    #[must_use]
    pub fn interaction_for_request_id(
        &self,
        session_id: &str,
        request_id: u64,
    ) -> Option<InteractionSnapshot> {
        let interaction_id = self
            .interaction_id_by_request_key
            .get(&create_session_request_key(session_id, request_id))
            .map(|entry| entry.value().clone())?;
        self.interaction(&interaction_id)
    }

    pub fn resolve_interaction(
        &self,
        session_id: &str,
        interaction_id: &str,
        state: InteractionState,
        response: InteractionResponse,
    ) -> Option<InteractionSnapshot> {
        let responded_at_event_seq = self.advance_session_event_seq(session_id);
        let mut interaction = self
            .interactions_by_id
            .get(interaction_id)
            .map(|entry| entry.clone())?;
        if interaction.session_id != session_id {
            return None;
        }

        interaction.state = state;
        interaction.responded_at_event_seq = Some(responded_at_event_seq);
        interaction.response = Some(response);
        self.interactions_by_id
            .insert(interaction_id.to_string(), interaction.clone());
        Some(interaction)
    }

    pub fn resolve_interaction_by_request_id(
        &self,
        session_id: &str,
        request_id: u64,
        state: InteractionState,
        response: InteractionResponse,
    ) -> Option<InteractionSnapshot> {
        let interaction_id = self
            .interaction_id_by_request_key
            .get(&create_session_request_key(session_id, request_id))
            .map(|entry| entry.value().clone())?;
        self.resolve_interaction(session_id, &interaction_id, state, response)
    }

    fn import_thread_snapshot(
        &self,
        session_id: &str,
        agent_id: Option<CanonicalAgentId>,
        thread_snapshot: &SessionThreadSnapshot,
    ) {
        let mut snapshot = SessionSnapshot::new(session_id.to_string(), agent_id);

        for entry in &thread_snapshot.entries {
            snapshot.last_event_seq = snapshot.last_event_seq.saturating_add(1);

            match entry {
                StoredEntry::User { .. } => {
                    if snapshot.active_turn_failure.is_some() {
                        start_running_turn(&mut snapshot);
                    }
                    snapshot.message_count = snapshot.message_count.saturating_add(1);
                }
                StoredEntry::Assistant { id, .. } => {
                    if snapshot.active_turn_failure.is_some() {
                        start_running_turn(&mut snapshot);
                    }
                    snapshot.message_count = snapshot.message_count.saturating_add(1);
                    snapshot.last_agent_message_id = Some(id.clone());
                }
                StoredEntry::ToolCall { message, .. } => {
                    if snapshot.active_turn_failure.is_some() {
                        start_running_turn(&mut snapshot);
                    }
                    upsert_active_tool_call(&mut snapshot.active_tool_call_ids, &message.id);
                    if is_terminal_tool_call_status(&message.status) {
                        mark_tool_call_completed(&mut snapshot, &message.id);
                    }

                    self.upsert_tool_call_projection(
                        session_id,
                        message,
                        None,
                        message.parent_tool_use_id.clone(),
                    );
                    self.register_plan_approval_interaction(session_id, message);
                    self.register_converted_question_interaction(
                        session_id,
                        message,
                        snapshot.last_event_seq,
                    );
                }
                StoredEntry::Error { message, .. } => {
                    snapshot.active_turn_failure = Some(convert_stored_error_snapshot(message));
                    snapshot.last_terminal_turn_id = None;
                    snapshot.active_tool_call_ids.clear();
                }
            }
        }

        if snapshot.active_turn_failure.is_some() {
            snapshot.turn_state = SessionTurnState::Failed;
        } else if !snapshot.active_tool_call_ids.is_empty() {
            snapshot.turn_state = SessionTurnState::Running;
        } else if snapshot.last_event_seq > 0 {
            snapshot.turn_state = SessionTurnState::Completed;
        }

        self.snapshots.insert(session_id.to_string(), snapshot);
    }

    fn upsert_tool_call_projection(
        &self,
        session_id: &str,
        tool_call: &ToolCallData,
        parent_operation_id: Option<String>,
        parent_tool_call_id: Option<String>,
    ) -> OperationSnapshot {
        let operation_id = build_operation_id(session_id, &tool_call.id);
        let existing = self
            .operations_by_id
            .get(&operation_id)
            .map(|operation| operation.clone());
        let resolved_parent_tool_call_id =
            tool_call.parent_tool_use_id.clone().or(parent_tool_call_id);
        let mut child_tool_call_ids = Vec::new();
        let mut child_operation_ids = Vec::new();

        if let Some(children) = tool_call.task_children.as_ref() {
            for child in children {
                let child_operation = self.upsert_tool_call_projection(
                    session_id,
                    child,
                    Some(operation_id.clone()),
                    Some(tool_call.id.clone()),
                );
                child_tool_call_ids.push(child.id.clone());
                child_operation_ids.push(child_operation.id);
            }
        }

        let operation = OperationSnapshot {
            id: operation_id.clone(),
            session_id: session_id.to_string(),
            tool_call_id: tool_call.id.clone(),
            name: tool_call.name.clone(),
            kind: tool_call.kind,
            status: tool_call.status.clone(),
            title: tool_call.title.clone(),
            arguments: tool_call.arguments.clone(),
            progressive_arguments: existing
                .as_ref()
                .and_then(|operation| operation.progressive_arguments.clone()),
            result: tool_call.result.clone(),
            command: extract_operation_command(
                Some(&tool_call.arguments),
                existing
                    .as_ref()
                    .and_then(|operation| operation.progressive_arguments.as_ref()),
                tool_call.title.as_deref(),
            ),
            parent_tool_call_id: resolved_parent_tool_call_id,
            parent_operation_id,
            child_tool_call_ids,
            child_operation_ids,
        };

        self.operations_by_id
            .insert(operation_id.clone(), operation.clone());
        self.operation_id_by_tool_key.insert(
            create_session_tool_key(session_id, &tool_call.id),
            operation_id.clone(),
        );
        self.insert_session_operation_id(session_id, &operation_id);

        operation
    }

    fn apply_tool_call_update_projection(&self, session_id: &str, update: &ToolCallUpdateData) {
        let tool_key = create_session_tool_key(session_id, &update.tool_call_id);
        let Some(operation_id) = self
            .operation_id_by_tool_key
            .get(&tool_key)
            .map(|entry| entry.value().clone())
        else {
            return;
        };
        let Some(existing) = self
            .operations_by_id
            .get(&operation_id)
            .map(|operation| operation.clone())
        else {
            return;
        };

        let next_status = update.status.clone().unwrap_or(existing.status);
        let next_arguments = update
            .arguments
            .clone()
            .unwrap_or_else(|| existing.arguments.clone());
        let next_progressive_arguments =
            if let Some(streaming_arguments) = update.streaming_arguments.clone() {
                Some(streaming_arguments)
            } else if update.arguments.is_some()
                || update
                    .status
                    .as_ref()
                    .is_some_and(is_terminal_tool_call_status)
            {
                None
            } else {
                existing.progressive_arguments.clone()
            };
        let next_title = update.title.clone().or(existing.title.clone());
        let next_result = update.result.clone().or(existing.result.clone());

        self.operations_by_id.insert(
            operation_id,
            OperationSnapshot {
                id: existing.id,
                session_id: existing.session_id,
                tool_call_id: existing.tool_call_id,
                name: existing.name,
                kind: existing.kind,
                status: next_status,
                title: next_title.clone(),
                arguments: next_arguments.clone(),
                progressive_arguments: next_progressive_arguments.clone(),
                result: next_result,
                command: extract_operation_command(
                    Some(&next_arguments),
                    next_progressive_arguments.as_ref(),
                    next_title.as_deref(),
                ),
                parent_tool_call_id: existing.parent_tool_call_id,
                parent_operation_id: existing.parent_operation_id,
                child_tool_call_ids: existing.child_tool_call_ids,
                child_operation_ids: existing.child_operation_ids,
            },
        );
    }

    fn insert_session_operation_id(&self, session_id: &str, operation_id: &str) {
        let mut operation_ids = self
            .session_operation_ids
            .entry(session_id.to_string())
            .or_default();
        if operation_ids
            .iter()
            .any(|candidate| candidate == operation_id)
        {
            return;
        }

        operation_ids.push(operation_id.to_string());
    }

    fn advance_session_event_seq(&self, session_id: &str) -> i64 {
        let mut snapshot = self
            .snapshots
            .entry(session_id.to_string())
            .or_insert_with(|| SessionSnapshot::new(session_id.to_string(), None));
        snapshot.last_event_seq = snapshot.last_event_seq.saturating_add(1);
        snapshot.last_event_seq
    }

    fn register_permission_interaction(&self, permission: &PermissionData, event_seq: i64) {
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
        };
        self.upsert_interaction(interaction);
    }

    fn register_question_interaction(&self, question: &QuestionData) {
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
        };
        self.upsert_interaction(interaction);
    }

    fn register_plan_approval_interaction(&self, session_id: &str, tool_call: &ToolCallData) {
        if !tool_call.awaiting_plan_approval {
            return;
        }
        let Some(plan_approval_request_id) = tool_call.plan_approval_request_id else {
            return;
        };

        let interaction_id =
            build_plan_approval_interaction_id(session_id, &tool_call.id, plan_approval_request_id);
        let source = if tool_call.kind == Some(ToolKind::ExitPlanMode) {
            PlanApprovalSource::ExitPlanMode
        } else {
            PlanApprovalSource::CreatePlan
        };
        let interaction = InteractionSnapshot {
            id: interaction_id,
            session_id: session_id.to_string(),
            kind: InteractionKind::PlanApproval,
            state: InteractionState::Pending,
            json_rpc_request_id: Some(plan_approval_request_id),
            reply_handler: Some(InteractionReplyHandler::json_rpc(plan_approval_request_id)),
            tool_reference: Some(ToolReference {
                message_id: String::new(),
                call_id: tool_call.id.clone(),
            }),
            responded_at_event_seq: None,
            response: None,
            payload: InteractionPayload::PlanApproval { source },
        };
        self.upsert_interaction(interaction);
    }

    fn register_converted_question_interaction(
        &self,
        session_id: &str,
        tool_call: &ToolCallData,
        event_seq: i64,
    ) {
        let question_items =
            if let Some(normalized_questions) = tool_call.normalized_questions.clone() {
                normalized_questions
            } else if let Some(question_answer) = tool_call.question_answer.clone() {
                question_answer.questions
            } else {
                return;
            };

        let question = QuestionData {
            id: tool_call.id.clone(),
            session_id: session_id.to_string(),
            json_rpc_request_id: None,
            reply_handler: Some(InteractionReplyHandler::http(tool_call.id.clone())),
            questions: question_items,
            tool: Some(ToolReference {
                message_id: String::new(),
                call_id: tool_call.id.clone(),
            }),
        };

        let (state, responded_at_event_seq, response) =
            if let Some(question_answer) = tool_call.question_answer.as_ref() {
                let answers = serde_json::to_value(&question_answer.answers).unwrap_or(Value::Null);
                (
                    InteractionState::Answered,
                    Some(event_seq),
                    Some(InteractionResponse::Question { answers }),
                )
            } else {
                (InteractionState::Pending, None, None)
            };

        let interaction = InteractionSnapshot {
            id: question.id.clone(),
            session_id: session_id.to_string(),
            kind: InteractionKind::Question,
            state,
            json_rpc_request_id: None,
            reply_handler: question.reply_handler.clone(),
            tool_reference: question.tool.clone(),
            responded_at_event_seq,
            response,
            payload: InteractionPayload::Question(question),
        };
        self.upsert_interaction(interaction);
    }

    fn upsert_interaction(&self, interaction: InteractionSnapshot) {
        let interaction_id = interaction.id.clone();
        let session_id = interaction.session_id.clone();
        let request_id = interaction.json_rpc_request_id;
        self.interactions_by_id
            .insert(interaction_id.clone(), interaction);
        if let Some(request_id) = request_id {
            self.interaction_id_by_request_key.insert(
                create_session_request_key(&session_id, request_id),
                interaction_id.clone(),
            );
        }

        let mut interaction_ids = self.session_interaction_ids.entry(session_id).or_default();
        if interaction_ids
            .iter()
            .any(|candidate| candidate == &interaction_id)
        {
            return;
        }

        interaction_ids.push(interaction_id);
    }
}

fn create_session_tool_key(session_id: &str, tool_call_id: &str) -> String {
    format!("{session_id}::{tool_call_id}")
}

fn convert_turn_error_snapshot(
    error: &crate::acp::session_update::TurnErrorData,
    turn_id: Option<String>,
) -> TurnFailureSnapshot {
    match error {
        crate::acp::session_update::TurnErrorData::Legacy(message) => TurnFailureSnapshot {
            turn_id,
            message: message.clone(),
            code: None,
            kind: crate::acp::session_update::TurnErrorKind::Recoverable,
            source: crate::acp::session_update::TurnErrorSource::Unknown,
        },
        crate::acp::session_update::TurnErrorData::Structured(info) => TurnFailureSnapshot {
            turn_id,
            message: info.message.clone(),
            code: info.code.map(|code| code.to_string()),
            kind: info.kind,
            source: info
                .source
                .unwrap_or(crate::acp::session_update::TurnErrorSource::Unknown),
        },
    }
}

fn convert_stored_error_snapshot(
    message: &crate::session_jsonl::types::StoredErrorMessage,
) -> TurnFailureSnapshot {
    TurnFailureSnapshot {
        turn_id: None,
        message: message.content.clone(),
        code: message.code.clone(),
        kind: message.kind,
        source: message
            .source
            .unwrap_or(crate::acp::session_update::TurnErrorSource::Unknown),
    }
}

fn create_session_request_key(session_id: &str, request_id: u64) -> String {
    format!("{session_id}::{request_id}")
}

fn build_operation_id(session_id: &str, tool_call_id: &str) -> String {
    format!("{session_id}:{tool_call_id}")
}

fn build_plan_approval_interaction_id(
    session_id: &str,
    tool_call_id: &str,
    json_rpc_request_id: u64,
) -> String {
    format!("{session_id}\u{0}{tool_call_id}\u{0}plan\u{0}{json_rpc_request_id}")
}

fn normalize_command(value: Option<&str>) -> Option<String> {
    let value = value?;
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    Some(trimmed.split_whitespace().collect::<Vec<_>>().join(" "))
}

fn extract_command_from_arguments(arguments: Option<&ToolArguments>) -> Option<String> {
    match arguments {
        Some(ToolArguments::Execute { command }) => normalize_command(command.as_deref()),
        _ => None,
    }
}

fn extract_operation_command(
    arguments: Option<&ToolArguments>,
    progressive_arguments: Option<&ToolArguments>,
    title: Option<&str>,
) -> Option<String> {
    if let Some(command) = extract_command_from_arguments(progressive_arguments) {
        return Some(command);
    }

    if let Some(command) = extract_command_from_arguments(arguments) {
        return Some(command);
    }

    let title = title?;
    let stripped = title
        .strip_prefix('`')
        .and_then(|value| value.strip_suffix('`'));
    normalize_command(stripped)
}

fn is_terminal_tool_call_status(status: &ToolCallStatus) -> bool {
    matches!(status, ToolCallStatus::Completed | ToolCallStatus::Failed)
}

fn upsert_active_tool_call(active_tool_call_ids: &mut Vec<String>, tool_call_id: &str) {
    if active_tool_call_ids
        .iter()
        .any(|candidate| candidate == tool_call_id)
    {
        return;
    }

    active_tool_call_ids.push(tool_call_id.to_string());
}

fn mark_tool_call_completed(snapshot: &mut SessionSnapshot, tool_call_id: &str) {
    snapshot
        .active_tool_call_ids
        .retain(|candidate| candidate != tool_call_id);
    if snapshot
        .completed_tool_call_ids
        .iter()
        .any(|candidate| candidate == tool_call_id)
    {
        return;
    }

    snapshot
        .completed_tool_call_ids
        .push(tool_call_id.to_string());
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::session_update::{
        ContentChunk, ToolArguments, ToolCallData, ToolCallUpdateData, ToolKind,
    };
    use crate::acp::types::ContentBlock;
    use crate::session_jsonl::types::{
        ConvertedSession, QuestionAnswer, SessionStats, StoredAssistantChunk,
        StoredAssistantMessage, StoredContentBlock, StoredEntry, StoredUserMessage,
    };
    use serde_json::json;
    use std::collections::HashMap;

    #[test]
    fn apply_session_update_tracks_agent_message_and_turn_completion() {
        let registry = ProjectionRegistry::new();
        registry.register_session("session-1".to_string(), CanonicalAgentId::ClaudeCode);

        registry.apply_session_update(
            "session-1",
            &SessionUpdate::AgentMessageChunk {
                chunk: ContentChunk {
                    content: ContentBlock::Text {
                        text: "hello".to_string(),
                    },
                    aggregation_hint: None,
                },
                part_id: None,
                message_id: Some("msg-1".to_string()),
                session_id: Some("session-1".to_string()),
            },
        );
        registry.apply_session_update(
            "session-1",
            &SessionUpdate::TurnComplete {
                session_id: Some("session-1".to_string()),
                turn_id: None,
            },
        );

        let snapshot = registry
            .snapshot_for_session("session-1")
            .expect("expected session snapshot");
        assert_eq!(snapshot.agent_id, Some(CanonicalAgentId::ClaudeCode));
        assert_eq!(snapshot.message_count, 1);
        assert_eq!(snapshot.last_agent_message_id.as_deref(), Some("msg-1"));
        assert_eq!(snapshot.turn_state, SessionTurnState::Completed);
        assert_eq!(snapshot.last_event_seq, 2);
    }

    #[test]
    fn apply_session_update_keeps_failed_turn_terminal_for_late_same_turn_updates() {
        let registry = ProjectionRegistry::new();
        registry.register_session("session-1".to_string(), CanonicalAgentId::Codex);

        registry.apply_session_update(
            "session-1",
            &SessionUpdate::TurnError {
                error: crate::acp::session_update::TurnErrorData::Structured(
                    crate::acp::session_update::TurnErrorInfo {
                        message: "Usage limit reached".to_string(),
                        kind: crate::acp::session_update::TurnErrorKind::Recoverable,
                        code: Some(429),
                        source: Some(crate::acp::session_update::TurnErrorSource::Process),
                    },
                ),
                session_id: Some("session-1".to_string()),
                turn_id: Some("turn-1".to_string()),
            },
        );

        let failed_snapshot = registry
            .snapshot_for_session("session-1")
            .expect("expected failed snapshot");
        assert_eq!(failed_snapshot.turn_state, SessionTurnState::Failed);
        assert_eq!(
            failed_snapshot.last_terminal_turn_id.as_deref(),
            Some("turn-1")
        );
        assert_eq!(
            failed_snapshot
                .active_turn_failure
                .as_ref()
                .map(|failure| failure.message.as_str()),
            Some("Usage limit reached")
        );

        registry.apply_session_update(
            "session-1",
            &SessionUpdate::TurnComplete {
                session_id: Some("session-1".to_string()),
                turn_id: Some("turn-1".to_string()),
            },
        );

        registry.apply_session_update(
            "session-1",
            &SessionUpdate::AgentMessageChunk {
                chunk: ContentChunk {
                    content: ContentBlock::Text {
                        text: "late chunk".to_string(),
                    },
                    aggregation_hint: None,
                },
                part_id: None,
                session_id: Some("session-1".to_string()),
                message_id: Some("msg-late".to_string()),
            },
        );

        registry.apply_session_update(
            "session-1",
            &SessionUpdate::TurnComplete {
                session_id: Some("session-1".to_string()),
                turn_id: Some("turn-1".to_string()),
            },
        );

        let failed_snapshot = registry
            .snapshot_for_session("session-1")
            .expect("expected failed snapshot after late updates");
        assert_eq!(failed_snapshot.turn_state, SessionTurnState::Failed);
        assert_eq!(
            failed_snapshot.last_terminal_turn_id.as_deref(),
            Some("turn-1")
        );
        assert_eq!(
            failed_snapshot
                .active_turn_failure
                .as_ref()
                .map(|failure| failure.message.as_str()),
            Some("Usage limit reached")
        );
    }

    #[test]
    fn apply_session_update_clears_failed_turn_when_new_user_turn_starts() {
        let registry = ProjectionRegistry::new();
        registry.register_session("session-1".to_string(), CanonicalAgentId::Codex);

        registry.apply_session_update(
            "session-1",
            &SessionUpdate::TurnError {
                error: crate::acp::session_update::TurnErrorData::Structured(
                    crate::acp::session_update::TurnErrorInfo {
                        message: "Usage limit reached".to_string(),
                        kind: crate::acp::session_update::TurnErrorKind::Recoverable,
                        code: Some(429),
                        source: Some(crate::acp::session_update::TurnErrorSource::Process),
                    },
                ),
                session_id: Some("session-1".to_string()),
                turn_id: Some("turn-1".to_string()),
            },
        );

        registry.apply_session_update(
            "session-1",
            &SessionUpdate::UserMessageChunk {
                chunk: ContentChunk {
                    content: ContentBlock::Text {
                        text: "retry".to_string(),
                    },
                    aggregation_hint: None,
                },
                session_id: Some("session-1".to_string()),
            },
        );

        let running_snapshot = registry
            .snapshot_for_session("session-1")
            .expect("expected running snapshot");
        assert_eq!(running_snapshot.turn_state, SessionTurnState::Running);
        assert!(running_snapshot.active_turn_failure.is_none());
        assert!(running_snapshot.last_terminal_turn_id.is_none());
    }

    fn create_execute_tool_call(id: &str, command: &str, status: ToolCallStatus) -> ToolCallData {
        ToolCallData {
            id: id.to_string(),
            name: "bash".to_string(),
            arguments: ToolArguments::Execute {
                command: Some(command.to_string()),
            },
            raw_input: None,
            status,
            result: None,
            kind: Some(ToolKind::Execute),
            title: Some("Run command".to_string()),
            locations: None,
            skill_meta: None,
            normalized_questions: None,
            normalized_todos: None,
            parent_tool_use_id: None,
            task_children: None,
            question_answer: None,
            awaiting_plan_approval: false,
            plan_approval_request_id: None,
        }
    }

    #[test]
    fn operation_projection_tracks_one_canonical_tool_lifecycle() {
        let registry = ProjectionRegistry::new();

        registry.apply_session_update(
            "session-1",
            &SessionUpdate::ToolCall {
                tool_call: create_execute_tool_call(
                    "tool-1",
                    "mkdir demo",
                    ToolCallStatus::Pending,
                ),
                session_id: Some("session-1".to_string()),
            },
        );

        let created = registry
            .operation_for_tool_call("session-1", "tool-1")
            .expect("expected created operation");
        assert_eq!(created.command.as_deref(), Some("mkdir demo"));
        assert_eq!(created.status, ToolCallStatus::Pending);

        registry.apply_session_update(
            "session-1",
            &SessionUpdate::ToolCallUpdate {
                update: ToolCallUpdateData {
                    tool_call_id: "tool-1".to_string(),
                    streaming_arguments: Some(ToolArguments::Execute {
                        command: Some("mkdir demo && cd demo".to_string()),
                    }),
                    ..ToolCallUpdateData::default()
                },
                session_id: Some("session-1".to_string()),
            },
        );

        let streaming = registry
            .operation_for_tool_call("session-1", "tool-1")
            .expect("expected streaming operation");
        assert_eq!(streaming.id, created.id);
        match streaming.progressive_arguments {
            Some(ToolArguments::Execute { command }) => {
                assert_eq!(command.as_deref(), Some("mkdir demo && cd demo"));
            }
            other => panic!("expected execute progressive arguments, got {:?}", other),
        }

        registry.apply_session_update(
            "session-1",
            &SessionUpdate::ToolCallUpdate {
                update: ToolCallUpdateData {
                    tool_call_id: "tool-1".to_string(),
                    status: Some(ToolCallStatus::Completed),
                    result: Some(json!("done")),
                    arguments: Some(ToolArguments::Execute {
                        command: Some("mkdir demo && cd demo".to_string()),
                    }),
                    ..ToolCallUpdateData::default()
                },
                session_id: Some("session-1".to_string()),
            },
        );

        let completed = registry
            .operation_for_tool_call("session-1", "tool-1")
            .expect("expected completed operation");
        assert_eq!(completed.id, created.id);
        assert_eq!(completed.status, ToolCallStatus::Completed);
        assert_eq!(completed.result, Some(json!("done")));
        assert!(completed.progressive_arguments.is_none());
    }

    #[test]
    fn operation_projection_preserves_parent_child_relationships() {
        let registry = ProjectionRegistry::new();
        let mut parent = ToolCallData {
            id: "task-parent".to_string(),
            name: "task".to_string(),
            arguments: ToolArguments::Other { raw: json!({}) },
            raw_input: None,
            status: ToolCallStatus::Pending,
            result: None,
            kind: Some(ToolKind::Task),
            title: Some("Task".to_string()),
            locations: None,
            skill_meta: None,
            normalized_questions: None,
            normalized_todos: None,
            parent_tool_use_id: None,
            task_children: None,
            question_answer: None,
            awaiting_plan_approval: false,
            plan_approval_request_id: None,
        };
        let mut child =
            create_execute_tool_call("task-child", "go test ./...", ToolCallStatus::Pending);
        child.parent_tool_use_id = Some("task-parent".to_string());
        parent.task_children = Some(vec![child]);

        registry.apply_session_update(
            "session-1",
            &SessionUpdate::ToolCall {
                tool_call: parent,
                session_id: Some("session-1".to_string()),
            },
        );

        let parent = registry
            .operation_for_tool_call("session-1", "task-parent")
            .expect("expected parent operation");
        let child = registry
            .operation_for_tool_call("session-1", "task-child")
            .expect("expected child operation");

        assert_eq!(parent.child_operation_ids, vec![child.id.clone()]);
        assert_eq!(
            child.parent_operation_id.as_deref(),
            Some(parent.id.as_str())
        );
        assert_eq!(child.command.as_deref(), Some("go test ./..."));
    }

    #[test]
    fn interaction_projection_registers_permission_question_and_plan_approval() {
        let registry = ProjectionRegistry::new();

        registry.apply_session_update(
            "session-1",
            &SessionUpdate::PermissionRequest {
                permission: PermissionData {
                    id: "permission-1".to_string(),
                    session_id: "session-1".to_string(),
                    json_rpc_request_id: Some(7),
                    reply_handler: Some(InteractionReplyHandler::json_rpc(7)),
                    permission: "Execute".to_string(),
                    patterns: vec![],
                    metadata: json!({ "command": "bun test" }),
                    always: vec!["allow_always".to_string()],
                    auto_accepted: false,
                    tool: Some(ToolReference {
                        message_id: String::new(),
                        call_id: "tool-1".to_string(),
                    }),
                },
                session_id: Some("session-1".to_string()),
            },
        );
        registry.apply_session_update(
            "session-1",
            &SessionUpdate::QuestionRequest {
                question: QuestionData {
                    id: "question-1".to_string(),
                    session_id: "session-1".to_string(),
                    json_rpc_request_id: Some(8),
                    reply_handler: Some(InteractionReplyHandler::json_rpc(8)),
                    questions: vec![],
                    tool: Some(ToolReference {
                        message_id: String::new(),
                        call_id: "tool-2".to_string(),
                    }),
                },
                session_id: Some("session-1".to_string()),
            },
        );

        let mut plan_tool_call =
            create_execute_tool_call("tool-3", "write plan", ToolCallStatus::Pending);
        plan_tool_call.kind = Some(ToolKind::CreatePlan);
        plan_tool_call.awaiting_plan_approval = true;
        plan_tool_call.plan_approval_request_id = Some(9);
        registry.apply_session_update(
            "session-1",
            &SessionUpdate::ToolCall {
                tool_call: plan_tool_call,
                session_id: Some("session-1".to_string()),
            },
        );

        let permission = registry
            .interaction("permission-1")
            .expect("expected permission interaction");
        assert_eq!(permission.kind, InteractionKind::Permission);
        assert_eq!(permission.state, InteractionState::Pending);
        assert_eq!(permission.json_rpc_request_id, Some(7));

        let question = registry
            .interaction("question-1")
            .expect("expected question interaction");
        assert_eq!(question.kind, InteractionKind::Question);
        assert_eq!(question.state, InteractionState::Pending);
        assert_eq!(question.json_rpc_request_id, Some(8));

        let plan_id = build_plan_approval_interaction_id("session-1", "tool-3", 9);
        let plan = registry
            .interaction(&plan_id)
            .expect("expected plan approval interaction");
        assert_eq!(plan.kind, InteractionKind::PlanApproval);
        assert_eq!(plan.state, InteractionState::Pending);
        assert_eq!(plan.json_rpc_request_id, Some(9));
        match plan.payload {
            InteractionPayload::PlanApproval { source } => {
                assert_eq!(source, PlanApprovalSource::CreatePlan);
            }
            other => panic!("expected plan approval payload, got {:?}", other),
        }

        assert_eq!(registry.session_interactions("session-1").len(), 3);
    }

    #[test]
    fn interaction_projection_marks_auto_accepted_permissions_approved() {
        let registry = ProjectionRegistry::new();
        registry.register_session("session-auto".to_string(), CanonicalAgentId::ClaudeCode);

        registry.apply_session_update(
            "session-auto",
            &SessionUpdate::PermissionRequest {
                permission: PermissionData {
                    id: "permission-auto".to_string(),
                    session_id: "session-auto".to_string(),
                    json_rpc_request_id: Some(7),
                    reply_handler: Some(InteractionReplyHandler::json_rpc(7)),
                    permission: "Execute".to_string(),
                    patterns: vec![],
                    metadata: json!({ "command": "bun test" }),
                    always: vec![],
                    auto_accepted: true,
                    tool: None,
                },
                session_id: Some("session-auto".to_string()),
            },
        );

        let permission = registry
            .interaction("permission-auto")
            .expect("expected permission interaction");
        assert_eq!(permission.state, InteractionState::Approved);
        assert_eq!(permission.responded_at_event_seq, Some(1));
        assert!(matches!(
            permission.response,
            Some(InteractionResponse::Permission {
                accepted: true,
                option_id: Some(ref option_id),
                reply: Some(ref reply),
            }) if option_id == "allow" && reply == "once"
        ));
    }

    #[test]
    fn interaction_projection_resolves_by_id_and_request_id() {
        let registry = ProjectionRegistry::new();
        registry.register_session("session-1".to_string(), CanonicalAgentId::ClaudeCode);

        registry.apply_session_update(
            "session-1",
            &SessionUpdate::PermissionRequest {
                permission: PermissionData {
                    id: "permission-1".to_string(),
                    session_id: "session-1".to_string(),
                    json_rpc_request_id: Some(7),
                    reply_handler: Some(InteractionReplyHandler::json_rpc(7)),
                    permission: "Execute".to_string(),
                    patterns: vec![],
                    metadata: json!({ "command": "bun test" }),
                    always: vec![],
                    auto_accepted: false,
                    tool: None,
                },
                session_id: Some("session-1".to_string()),
            },
        );
        registry.apply_session_update(
            "session-1",
            &SessionUpdate::QuestionRequest {
                question: QuestionData {
                    id: "question-1".to_string(),
                    session_id: "session-1".to_string(),
                    json_rpc_request_id: Some(8),
                    reply_handler: Some(InteractionReplyHandler::json_rpc(8)),
                    questions: vec![],
                    tool: None,
                },
                session_id: Some("session-1".to_string()),
            },
        );

        let permission = registry
            .resolve_interaction(
                "session-1",
                "permission-1",
                InteractionState::Approved,
                InteractionResponse::Permission {
                    accepted: true,
                    option_id: Some("allow".to_string()),
                    reply: Some("once".to_string()),
                },
            )
            .expect("expected permission transition");
        assert_eq!(permission.state, InteractionState::Approved);
        assert_eq!(permission.responded_at_event_seq, Some(3));

        let question = registry
            .resolve_interaction_by_request_id(
                "session-1",
                8,
                InteractionState::Answered,
                InteractionResponse::Question {
                    answers: json!({ "Question": ["Yes"] }),
                },
            )
            .expect("expected question transition");
        assert_eq!(question.state, InteractionState::Answered);
        assert_eq!(question.responded_at_event_seq, Some(4));

        let snapshot = registry
            .snapshot_for_session("session-1")
            .expect("expected session snapshot");
        assert_eq!(snapshot.last_event_seq, 4);
    }

    #[test]
    fn session_projection_returns_session_operation_and_interaction_state() {
        let registry = ProjectionRegistry::new();
        registry.register_session("session-1".to_string(), CanonicalAgentId::ClaudeCode);

        registry.apply_session_update(
            "session-1",
            &SessionUpdate::ToolCall {
                tool_call: create_execute_tool_call("tool-1", "bun test", ToolCallStatus::Pending),
                session_id: Some("session-1".to_string()),
            },
        );
        registry.apply_session_update(
            "session-1",
            &SessionUpdate::PermissionRequest {
                permission: PermissionData {
                    id: "permission-1".to_string(),
                    session_id: "session-1".to_string(),
                    json_rpc_request_id: Some(7),
                    reply_handler: Some(InteractionReplyHandler::json_rpc(7)),
                    permission: "Execute".to_string(),
                    patterns: vec![],
                    metadata: json!({ "command": "bun test" }),
                    always: vec![],
                    auto_accepted: false,
                    tool: None,
                },
                session_id: Some("session-1".to_string()),
            },
        );

        let projection = registry.session_projection("session-1");
        assert!(projection.session.is_some());
        assert_eq!(projection.operations.len(), 1);
        assert_eq!(projection.interactions.len(), 1);
        assert_eq!(projection.interactions[0].id, "permission-1");
    }

    #[test]
    fn restore_session_projection_rehydrates_indexes() {
        let registry = ProjectionRegistry::new();
        registry.restore_session_projection(SessionProjectionSnapshot {
            session: Some(SessionSnapshot {
                session_id: "session-1".to_string(),
                agent_id: Some(CanonicalAgentId::ClaudeCode),
                last_event_seq: 5,
                turn_state: SessionTurnState::Completed,
                message_count: 2,
                last_agent_message_id: Some("msg-2".to_string()),
                active_tool_call_ids: vec![],
                completed_tool_call_ids: vec!["tool-1".to_string()],
                active_turn_failure: None,
                last_terminal_turn_id: None,
            }),
            operations: vec![OperationSnapshot {
                id: "session-1:tool-1".to_string(),
                session_id: "session-1".to_string(),
                tool_call_id: "tool-1".to_string(),
                name: "bash".to_string(),
                kind: Some(ToolKind::Execute),
                status: ToolCallStatus::Completed,
                title: Some("Run command".to_string()),
                arguments: ToolArguments::Execute {
                    command: Some("bun test".to_string()),
                },
                progressive_arguments: None,
                result: Some(json!("done")),
                command: Some("bun test".to_string()),
                parent_tool_call_id: None,
                parent_operation_id: None,
                child_tool_call_ids: vec![],
                child_operation_ids: vec![],
            }],
            interactions: vec![InteractionSnapshot {
                id: "permission-1".to_string(),
                session_id: "session-1".to_string(),
                kind: InteractionKind::Permission,
                state: InteractionState::Approved,
                json_rpc_request_id: Some(7),
                reply_handler: Some(InteractionReplyHandler::json_rpc(7)),
                tool_reference: None,
                responded_at_event_seq: Some(5),
                response: Some(InteractionResponse::Permission {
                    accepted: true,
                    option_id: Some("allow".to_string()),
                    reply: Some("once".to_string()),
                }),
                payload: InteractionPayload::Permission(PermissionData {
                    id: "permission-1".to_string(),
                    session_id: "session-1".to_string(),
                    json_rpc_request_id: Some(7),
                    reply_handler: Some(InteractionReplyHandler::json_rpc(7)),
                    permission: "Execute".to_string(),
                    patterns: vec![],
                    metadata: json!({ "command": "bun test" }),
                    always: vec![],
                    auto_accepted: false,
                    tool: None,
                }),
            }],
        });

        assert!(registry.snapshot_for_session("session-1").is_some());
        assert!(registry
            .operation_for_tool_call("session-1", "tool-1")
            .is_some());
        assert!(registry.interaction("permission-1").is_some());
        assert!(registry
            .interaction_for_request_id("session-1", 7)
            .is_some());
    }

    #[test]
    fn project_thread_snapshot_imports_operations_and_answered_questions() {
        let mut answers = HashMap::new();
        answers.insert("Approve deploy?".to_string(), json!("yes"));

        let question_items = vec![crate::acp::session_update::QuestionItem {
            question: "Approve deploy?".to_string(),
            header: "Deploy".to_string(),
            options: vec![crate::acp::session_update::QuestionOption {
                label: "Yes".to_string(),
                description: "Ship".to_string(),
            }],
            multi_select: false,
        }];

        let thread_snapshot = SessionThreadSnapshot {
            entries: vec![
                StoredEntry::User {
                    id: "user-1".to_string(),
                    message: StoredUserMessage {
                        id: Some("user-1".to_string()),
                        content: StoredContentBlock {
                            block_type: "text".to_string(),
                            text: Some("ship it".to_string()),
                        },
                        chunks: vec![],
                        sent_at: Some("2026-04-08T00:00:00Z".to_string()),
                    },
                    timestamp: Some("2026-04-08T00:00:00Z".to_string()),
                },
                StoredEntry::Assistant {
                    id: "assistant-1".to_string(),
                    message: StoredAssistantMessage {
                        chunks: vec![StoredAssistantChunk {
                            chunk_type: "message".to_string(),
                            block: StoredContentBlock {
                                block_type: "text".to_string(),
                                text: Some("Need approval".to_string()),
                            },
                        }],
                        model: Some("claude-sonnet".to_string()),
                        display_model: Some("Claude Sonnet".to_string()),
                        received_at: Some("2026-04-08T00:00:01Z".to_string()),
                    },
                    timestamp: Some("2026-04-08T00:00:01Z".to_string()),
                },
                StoredEntry::ToolCall {
                    id: "tool-question-entry".to_string(),
                    message: ToolCallData {
                        id: "tool-question".to_string(),
                        name: "ask_user".to_string(),
                        arguments: ToolArguments::Other { raw: json!({}) },
                        raw_input: None,
                        status: ToolCallStatus::Completed,
                        result: None,
                        kind: Some(ToolKind::Question),
                        title: None,
                        locations: None,
                        skill_meta: None,
                        normalized_questions: Some(question_items.clone()),
                        normalized_todos: None,
                        parent_tool_use_id: None,
                        task_children: None,
                        question_answer: Some(QuestionAnswer {
                            questions: question_items,
                            answers,
                        }),
                        awaiting_plan_approval: false,
                        plan_approval_request_id: None,
                    },
                    timestamp: Some("2026-04-08T00:00:02Z".to_string()),
                },
                StoredEntry::ToolCall {
                    id: "tool-plan-entry".to_string(),
                    message: ToolCallData {
                        id: "tool-plan".to_string(),
                        name: "create_plan".to_string(),
                        arguments: ToolArguments::Other { raw: json!({}) },
                        raw_input: None,
                        status: ToolCallStatus::Pending,
                        result: None,
                        kind: Some(ToolKind::CreatePlan),
                        title: None,
                        locations: None,
                        skill_meta: None,
                        normalized_questions: None,
                        normalized_todos: None,
                        parent_tool_use_id: None,
                        task_children: None,
                        question_answer: None,
                        awaiting_plan_approval: true,
                        plan_approval_request_id: Some(42),
                    },
                    timestamp: Some("2026-04-08T00:00:03Z".to_string()),
                },
            ],
            title: "Imported".to_string(),
            created_at: "2026-04-08T00:00:00Z".to_string(),
            current_mode_id: None,
        };

        let projection = ProjectionRegistry::project_thread_snapshot(
            "session-1",
            Some(CanonicalAgentId::ClaudeCode),
            &thread_snapshot,
        );

        let session = projection
            .session
            .expect("expected imported session snapshot");
        assert_eq!(session.message_count, 2);
        assert_eq!(session.turn_state, SessionTurnState::Running);
        assert_eq!(projection.operations.len(), 2);

        let answered_question = projection
            .interactions
            .iter()
            .find(|interaction| interaction.id == "tool-question")
            .expect("expected imported question interaction");
        assert_eq!(answered_question.state, InteractionState::Answered);
        match answered_question.response.clone() {
            Some(InteractionResponse::Question { answers }) => {
                assert_eq!(answers, json!({ "Approve deploy?": "yes" }));
            }
            other => panic!("expected imported question response, got {:?}", other),
        }

        let plan_approval = projection
            .interactions
            .iter()
            .find(|interaction| interaction.kind == InteractionKind::PlanApproval)
            .expect("expected imported plan approval interaction");
        assert_eq!(plan_approval.state, InteractionState::Pending);
    }

    #[test]
    fn project_converted_session_preserves_stored_error_source() {
        let converted = ConvertedSession {
            entries: vec![StoredEntry::Error {
                id: "error-1".to_string(),
                message: crate::session_jsonl::types::StoredErrorMessage {
                    content: "Usage limit reached".to_string(),
                    code: Some("429".to_string()),
                    kind: crate::acp::session_update::TurnErrorKind::Recoverable,
                    source: Some(crate::acp::session_update::TurnErrorSource::Process),
                },
                timestamp: Some("2026-04-15T00:00:00Z".to_string()),
            }],
            stats: SessionStats::default(),
            title: "Imported error".to_string(),
            created_at: "2026-04-15T00:00:00Z".to_string(),
            current_mode_id: None,
        };

        let thread_snapshot =
            crate::acp::session_thread_snapshot::SessionThreadSnapshot::from(converted);
        let projection = ProjectionRegistry::project_thread_snapshot(
            "session-1",
            Some(CanonicalAgentId::Codex),
            &thread_snapshot,
        );

        let session = projection
            .session
            .expect("expected imported session snapshot");
        assert_eq!(session.turn_state, SessionTurnState::Failed);
        assert_eq!(
            session
                .active_turn_failure
                .as_ref()
                .map(|failure| failure.source),
            Some(crate::acp::session_update::TurnErrorSource::Process)
        );
    }

    #[test]
    fn project_converted_session_clears_historical_error_when_later_entries_continue() {
        let converted = ConvertedSession {
            entries: vec![
                StoredEntry::Error {
                    id: "error-1".to_string(),
                    message: crate::session_jsonl::types::StoredErrorMessage {
                        content: "Usage limit reached".to_string(),
                        code: Some("429".to_string()),
                        kind: crate::acp::session_update::TurnErrorKind::Recoverable,
                        source: Some(crate::acp::session_update::TurnErrorSource::Process),
                    },
                    timestamp: Some("2026-04-15T00:00:00Z".to_string()),
                },
                StoredEntry::User {
                    id: "user-1".to_string(),
                    message: StoredUserMessage {
                        id: Some("user-1".to_string()),
                        content: StoredContentBlock {
                            block_type: "text".to_string(),
                            text: Some("try again".to_string()),
                        },
                        chunks: vec![],
                        sent_at: Some("2026-04-15T00:00:01Z".to_string()),
                    },
                    timestamp: Some("2026-04-15T00:00:01Z".to_string()),
                },
                StoredEntry::Assistant {
                    id: "assistant-1".to_string(),
                    message: StoredAssistantMessage {
                        chunks: vec![StoredAssistantChunk {
                            chunk_type: "message".to_string(),
                            block: StoredContentBlock {
                                block_type: "text".to_string(),
                                text: Some("Recovered".to_string()),
                            },
                        }],
                        model: Some("gpt-5.4".to_string()),
                        display_model: Some("GPT-5.4".to_string()),
                        received_at: Some("2026-04-15T00:00:02Z".to_string()),
                    },
                    timestamp: Some("2026-04-15T00:00:02Z".to_string()),
                },
            ],
            stats: SessionStats::default(),
            title: "Recovered session".to_string(),
            created_at: "2026-04-15T00:00:00Z".to_string(),
            current_mode_id: None,
        };

        let thread_snapshot =
            crate::acp::session_thread_snapshot::SessionThreadSnapshot::from(converted);
        let projection = ProjectionRegistry::project_thread_snapshot(
            "session-1",
            Some(CanonicalAgentId::Codex),
            &thread_snapshot,
        );

        let session = projection
            .session
            .expect("expected imported session snapshot");
        assert_eq!(session.turn_state, SessionTurnState::Completed);
        assert!(session.active_turn_failure.is_none());
        assert!(session.last_terminal_turn_id.is_none());
    }

    #[test]
    fn project_converted_session_defaults_missing_stored_error_source_to_unknown() {
        let converted = ConvertedSession {
            entries: vec![StoredEntry::Error {
                id: "error-1".to_string(),
                message: crate::session_jsonl::types::StoredErrorMessage {
                    content: "Usage limit reached".to_string(),
                    code: Some("429".to_string()),
                    kind: crate::acp::session_update::TurnErrorKind::Recoverable,
                    source: None,
                },
                timestamp: Some("2026-04-15T00:00:00Z".to_string()),
            }],
            stats: SessionStats::default(),
            title: "Imported error".to_string(),
            created_at: "2026-04-15T00:00:00Z".to_string(),
            current_mode_id: None,
        };

        let thread_snapshot =
            crate::acp::session_thread_snapshot::SessionThreadSnapshot::from(converted);
        let projection = ProjectionRegistry::project_thread_snapshot(
            "session-1",
            Some(CanonicalAgentId::Codex),
            &thread_snapshot,
        );

        let session = projection
            .session
            .expect("expected imported session snapshot");
        assert_eq!(
            session
                .active_turn_failure
                .as_ref()
                .map(|failure| failure.source),
            Some(crate::acp::session_update::TurnErrorSource::Unknown)
        );
    }
}
