use crate::acp::projections::ProjectionRegistry;
use crate::acp::session_state_engine::frontier::{
    decide_frontier_transition, SessionFrontierDecision,
};
use crate::acp::session_state_engine::revision::SessionGraphRevision;
use crate::acp::session_update::SessionUpdate;
use crate::acp::transcript_projection::{TranscriptDelta, TranscriptProjectionRegistry};
use sea_orm::DbConn;

/// Inputs for routing a live session-state envelope build.
#[derive(Clone, Copy)]
pub struct LiveSessionStateEnvelopeRequest<'a> {
    pub db: &'a DbConn,
    pub session_id: &'a str,
    pub update: &'a SessionUpdate,
    pub previous_revision: SessionGraphRevision,
    pub revision: SessionGraphRevision,
    pub projection_registry: &'a ProjectionRegistry,
    pub transcript_projection_registry: &'a TranscriptProjectionRegistry,
    pub transcript_delta: Option<&'a TranscriptDelta>,
}

/// Which builder arm should materialize the envelope.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EnvelopeBuilderKind {
    ConnectionCompleteCapabilities,
    SessionStateCapabilities,
    TurnStateDelta,
    SessionStateLifecycle,
    InteractionDelta,
    Snapshot,
    UsageTelemetry,
    Plan,
    ToolCallOperationPatch,
    TranscriptDelta,
}

/// Frontier decision computed once per routed arm.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BuildPlan {
    pub builder: EnvelopeBuilderKind,
    pub frontier_transition: Option<SessionFrontierDecision>,
    pub is_transcript_bearing: bool,
}

/// Route a live update to a builder arm and pre-compute its frontier plan.
#[must_use]
pub fn route_live_session_state_envelope(
    request: &LiveSessionStateEnvelopeRequest<'_>,
) -> Option<BuildPlan> {
    if should_emit_connection_complete(request.update) {
        return Some(BuildPlan {
            builder: EnvelopeBuilderKind::ConnectionCompleteCapabilities,
            frontier_transition: None,
            is_transcript_bearing: false,
        });
    }

    if should_emit_session_state_capabilities(request.update) {
        return Some(BuildPlan {
            builder: EnvelopeBuilderKind::SessionStateCapabilities,
            frontier_transition: None,
            is_transcript_bearing: false,
        });
    }

    if should_emit_turn_state_delta(request.update) {
        let transcript_operations = request
            .transcript_delta
            .map(|delta| delta.operations.clone())
            .unwrap_or_default();
        let is_transcript_bearing = !transcript_operations.is_empty();
        return Some(BuildPlan {
            builder: EnvelopeBuilderKind::TurnStateDelta,
            frontier_transition: Some(frontier_plan_for_request(
                request.previous_revision,
                request.revision,
                is_transcript_bearing,
            )),
            is_transcript_bearing,
        });
    }

    if should_emit_session_state_lifecycle(request.update) {
        return Some(BuildPlan {
            builder: EnvelopeBuilderKind::SessionStateLifecycle,
            frontier_transition: None,
            is_transcript_bearing: false,
        });
    }

    if interaction_id_for_patch(request.update).is_some() {
        return Some(BuildPlan {
            builder: EnvelopeBuilderKind::InteractionDelta,
            frontier_transition: Some(frontier_plan_for_request(
                request.previous_revision,
                request.revision,
                false,
            )),
            is_transcript_bearing: false,
        });
    }

    if should_emit_session_state_snapshot(request.update) {
        return Some(BuildPlan {
            builder: EnvelopeBuilderKind::Snapshot,
            frontier_transition: None,
            is_transcript_bearing: false,
        });
    }

    if matches!(request.update, SessionUpdate::UsageTelemetryUpdate { .. }) {
        return Some(BuildPlan {
            builder: EnvelopeBuilderKind::UsageTelemetry,
            frontier_transition: None,
            is_transcript_bearing: false,
        });
    }

    if matches!(request.update, SessionUpdate::Plan { .. }) {
        return Some(BuildPlan {
            builder: EnvelopeBuilderKind::Plan,
            frontier_transition: None,
            is_transcript_bearing: false,
        });
    }

    if tool_call_id_for_operation_patch(request.update).is_some() {
        let transcript_operations = request
            .transcript_delta
            .map(|delta| delta.operations.clone())
            .unwrap_or_default();
        let is_transcript_bearing = !transcript_operations.is_empty();
        return Some(BuildPlan {
            builder: EnvelopeBuilderKind::ToolCallOperationPatch,
            frontier_transition: Some(frontier_plan_for_request(
                request.previous_revision,
                request.revision,
                is_transcript_bearing,
            )),
            is_transcript_bearing,
        });
    }

    request.transcript_delta?;
    let is_transcript_bearing = !request
        .transcript_delta
        .expect("transcript_delta checked above")
        .operations
        .is_empty();
    Some(BuildPlan {
        builder: EnvelopeBuilderKind::TranscriptDelta,
        frontier_transition: Some(frontier_plan_for_request(
            request.previous_revision,
            request.revision,
            is_transcript_bearing,
        )),
        is_transcript_bearing,
    })
}

#[must_use]
pub fn frontier_plan_for_request(
    previous_revision: SessionGraphRevision,
    revision: SessionGraphRevision,
    is_transcript_bearing: bool,
) -> SessionFrontierDecision {
    let current_frontier = current_frontier_from_previous_revision(previous_revision);
    decide_frontier_transition(current_frontier, revision, 0, is_transcript_bearing)
}

#[must_use]
pub fn current_frontier_from_previous_revision(
    previous_revision: SessionGraphRevision,
) -> Option<SessionGraphRevision> {
    if previous_revision.graph_revision == 0
        && previous_revision.transcript_revision == 0
        && previous_revision.last_event_seq == 0
    {
        None
    } else {
        Some(previous_revision)
    }
}

#[must_use]
pub fn tool_call_id_for_operation_patch(update: &SessionUpdate) -> Option<&str> {
    match update {
        SessionUpdate::ToolCall { tool_call, .. } => Some(tool_call.id.as_str()),
        SessionUpdate::ToolCallUpdate { update, .. } => Some(update.tool_call_id.as_str()),
        _ => None,
    }
}

#[must_use]
pub fn interaction_id_for_patch(update: &SessionUpdate) -> Option<&str> {
    match update {
        SessionUpdate::PermissionRequest { permission, .. } => Some(permission.id.as_str()),
        SessionUpdate::QuestionRequest { question, .. } => Some(question.id.as_str()),
        _ => None,
    }
}

#[must_use]
pub fn should_emit_session_state_capabilities(update: &SessionUpdate) -> bool {
    matches!(
        update,
        SessionUpdate::AvailableCommandsUpdate { .. }
            | SessionUpdate::CurrentModeUpdate { .. }
            | SessionUpdate::ConfigOptionUpdate { .. }
    )
}

#[must_use]
pub fn should_emit_connection_complete(update: &SessionUpdate) -> bool {
    matches!(update, SessionUpdate::ConnectionComplete { .. })
}

#[must_use]
pub fn should_emit_session_state_snapshot(_update: &SessionUpdate) -> bool {
    false
}

#[must_use]
pub fn should_emit_session_state_lifecycle(update: &SessionUpdate) -> bool {
    matches!(
        update,
        SessionUpdate::ConnectionFailed { .. } | SessionUpdate::SessionDetached { .. }
    )
}

#[must_use]
pub fn should_emit_turn_state_delta(update: &SessionUpdate) -> bool {
    matches!(
        update,
        SessionUpdate::TurnComplete { .. }
            | SessionUpdate::TurnError { .. }
            | SessionUpdate::TurnCancelled { .. }
    )
}

#[cfg(test)]
mod tests {
    use super::{
        frontier_plan_for_request, interaction_id_for_patch, route_live_session_state_envelope,
        tool_call_id_for_operation_patch, EnvelopeBuilderKind, LiveSessionStateEnvelopeRequest,
    };
    use crate::acp::projections::ProjectionRegistry;
    use crate::acp::session_state_engine::frontier::{
        FrontierFallbackReason, SessionFrontierDecision,
    };
    use crate::acp::session_state_engine::revision::SessionGraphRevision;
    use crate::acp::session_update::{
        PermissionData, SessionUpdate, ToolArguments, ToolCallData, ToolCallStatus, ToolKind,
    };
    use crate::acp::transcript_projection::{
        TranscriptDelta, TranscriptProjectionRegistry, TranscriptSnapshot,
    };
    use sea_orm::Database;

    struct RoutingTestContext {
        db: sea_orm::DbConn,
        projection_registry: ProjectionRegistry,
        transcript_projection_registry: TranscriptProjectionRegistry,
    }

    impl RoutingTestContext {
        async fn new() -> Self {
            Self {
                db: Database::connect("sqlite::memory:")
                    .await
                    .expect("connect test database"),
                projection_registry: ProjectionRegistry::new(),
                transcript_projection_registry: TranscriptProjectionRegistry::new(),
            }
        }

        fn request<'a>(
            &'a self,
            update: &'a SessionUpdate,
            transcript_delta: Option<&'a TranscriptDelta>,
        ) -> LiveSessionStateEnvelopeRequest<'a> {
            LiveSessionStateEnvelopeRequest {
                db: &self.db,
                session_id: "session-1",
                update,
                previous_revision: SessionGraphRevision::new(10, 10, 10),
                revision: SessionGraphRevision::new(11, 10, 11),
                projection_registry: &self.projection_registry,
                transcript_projection_registry: &self.transcript_projection_registry,
                transcript_delta,
            }
        }
    }

    fn create_tool_call_update() -> SessionUpdate {
        SessionUpdate::ToolCall {
            tool_call: ToolCallData {
                id: "tool-1".to_string(),
                name: "bash".to_string(),
                arguments: ToolArguments::Execute {
                    command: Some("bun test".to_string()),
                },
                diagnostic_input: None,
                status: ToolCallStatus::InProgress,
                result: None,
                kind: Some(ToolKind::Execute),
                title: None,
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
            },
            session_id: Some("session-1".to_string()),
        }
    }

    fn create_permission_update() -> SessionUpdate {
        SessionUpdate::PermissionRequest {
            permission: PermissionData {
                id: "permission-1".to_string(),
                session_id: "session-1".to_string(),
                json_rpc_request_id: None,
                reply_handler: None,
                permission: "Read".to_string(),
                patterns: vec![],
                metadata: serde_json::json!({}),
                always: Vec::new(),
                auto_accepted: false,
                tool: None,
            },
            session_id: Some("session-1".to_string()),
        }
    }

    #[tokio::test]
    async fn routes_tool_call_to_operation_patch_builder() {
        let update = create_tool_call_update();
        let ctx = RoutingTestContext::new().await;
        let request = ctx.request(&update, None);
        let plan = route_live_session_state_envelope(&request).expect("tool call route");
        assert_eq!(plan.builder, EnvelopeBuilderKind::ToolCallOperationPatch);
        assert!(!plan.is_transcript_bearing);
        assert!(plan.frontier_transition.is_some());
    }

    #[tokio::test]
    async fn routes_interaction_with_is_transcript_bearing_false_even_with_transcript_delta() {
        let update = create_permission_update();
        let transcript_delta = TranscriptDelta {
            event_seq: 11,
            session_id: "session-1".to_string(),
            snapshot_revision: 11,
            operations: vec![
                crate::acp::transcript_projection::TranscriptDeltaOperation::ReplaceSnapshot {
                    snapshot: TranscriptSnapshot {
                        revision: 11,
                        entries: Vec::new(),
                    },
                },
            ],
        };
        let ctx = RoutingTestContext::new().await;
        let request = ctx.request(&update, Some(&transcript_delta));
        let plan = route_live_session_state_envelope(&request).expect("interaction route");
        assert_eq!(plan.builder, EnvelopeBuilderKind::InteractionDelta);
        assert!(!plan.is_transcript_bearing);
        assert_eq!(
            plan.frontier_transition,
            Some(frontier_plan_for_request(
                SessionGraphRevision::new(10, 10, 10),
                SessionGraphRevision::new(11, 10, 11),
                false,
            ))
        );
    }

    #[tokio::test]
    async fn routes_transcript_delta_with_bearing_flag_from_operations() {
        let update = SessionUpdate::AgentMessageChunk {
            chunk: crate::acp::session_update::ContentChunk {
                content: crate::acp::types::ContentBlock::Text {
                    text: "hello".to_string(),
                },
                aggregation_hint: None,
            },
            part_id: None,
            message_id: Some("assistant-1".to_string()),
            parent_tool_use_id: None,
            session_id: Some("session-1".to_string()),
            produced_at_monotonic_ms: Some(5),
        };
        let empty_delta = TranscriptDelta {
            event_seq: 11,
            session_id: "session-1".to_string(),
            snapshot_revision: 11,
            operations: Vec::new(),
        };
        let ctx = RoutingTestContext::new().await;
        let request = ctx.request(&update, Some(&empty_delta));
        let plan = route_live_session_state_envelope(&request).expect("transcript route");
        assert_eq!(plan.builder, EnvelopeBuilderKind::TranscriptDelta);
        assert!(!plan.is_transcript_bearing);
    }

    #[tokio::test]
    async fn routes_missing_transcript_delta_to_none() {
        let update = SessionUpdate::AgentMessageChunk {
            chunk: crate::acp::session_update::ContentChunk {
                content: crate::acp::types::ContentBlock::Text {
                    text: "hello".to_string(),
                },
                aggregation_hint: None,
            },
            part_id: None,
            message_id: Some("assistant-1".to_string()),
            parent_tool_use_id: None,
            session_id: Some("session-1".to_string()),
            produced_at_monotonic_ms: Some(5),
        };
        let ctx = RoutingTestContext::new().await;
        let request = ctx.request(&update, None);
        assert!(route_live_session_state_envelope(&request).is_none());
    }

    #[test]
    fn frontier_plan_requires_snapshot_when_frontier_missing() {
        let decision = frontier_plan_for_request(
            SessionGraphRevision::new(0, 0, 0),
            SessionGraphRevision::new(7, 6, 7),
            false,
        );
        assert_eq!(
            decision,
            SessionFrontierDecision::RequireSnapshot {
                reason: FrontierFallbackReason::MissingFrontier,
                frontier: None,
                candidate: SessionGraphRevision::new(7, 6, 7),
            }
        );
    }

    #[tokio::test]
    async fn routes_turn_complete_to_turn_state_delta_builder() {
        let update = SessionUpdate::TurnComplete {
            session_id: Some("session-1".to_string()),
            turn_id: Some("turn-1".to_string()),
        };
        let ctx = RoutingTestContext::new().await;
        let request = ctx.request(&update, None);
        let plan = route_live_session_state_envelope(&request).expect("turn complete route");
        assert_eq!(plan.builder, EnvelopeBuilderKind::TurnStateDelta);
        assert!(!plan.is_transcript_bearing);
        assert!(plan.frontier_transition.is_some());
    }

    #[tokio::test]
    async fn routes_connection_failed_to_session_state_lifecycle_builder() {
        let update = SessionUpdate::ConnectionFailed {
            session_id: "session-1".to_string(),
            attempt_id: 1,
            error: "auth expired".to_string(),
            failure_reason: crate::acp::lifecycle::FailureReason::ResumeFailed,
        };
        let ctx = RoutingTestContext::new().await;
        let request = ctx.request(&update, None);
        let plan = route_live_session_state_envelope(&request).expect("connection failed route");
        assert_eq!(plan.builder, EnvelopeBuilderKind::SessionStateLifecycle);
        assert!(!plan.is_transcript_bearing);
        assert!(plan.frontier_transition.is_none());
    }

    #[tokio::test]
    async fn routes_connection_complete_to_capabilities_builder() {
        let update = SessionUpdate::ConnectionComplete {
            session_id: "session-1".to_string(),
            attempt_id: 1,
            models: crate::acp::client_session::default_session_model_state(),
            modes: crate::acp::client_session::default_modes(),
            available_commands: None,
            config_options: None,
            autonomous_enabled: None,
        };
        let ctx = RoutingTestContext::new().await;
        let request = ctx.request(&update, None);
        let plan = route_live_session_state_envelope(&request).expect("connection complete route");
        assert_eq!(
            plan.builder,
            EnvelopeBuilderKind::ConnectionCompleteCapabilities
        );
        assert!(!plan.is_transcript_bearing);
    }

    #[tokio::test]
    async fn routes_available_commands_update_to_session_state_capabilities_builder() {
        let update = SessionUpdate::AvailableCommandsUpdate {
            update: crate::acp::session_update::AvailableCommandsData {
                available_commands: Vec::new(),
            },
            session_id: Some("session-1".to_string()),
        };
        let ctx = RoutingTestContext::new().await;
        let request = ctx.request(&update, None);
        let plan = route_live_session_state_envelope(&request).expect("capabilities route");
        assert_eq!(plan.builder, EnvelopeBuilderKind::SessionStateCapabilities);
        assert!(!plan.is_transcript_bearing);
    }

    #[tokio::test]
    async fn routes_usage_telemetry_to_usage_telemetry_builder() {
        use crate::acp::session_update::{UsageTelemetryData, UsageTelemetryTokens};
        let update = SessionUpdate::UsageTelemetryUpdate {
            data: UsageTelemetryData {
                session_id: "session-1".to_string(),
                event_id: None,
                scope: "step".to_string(),
                cost_usd: Some(0.01),
                tokens: UsageTelemetryTokens {
                    input: Some(1),
                    output: Some(2),
                    ..UsageTelemetryTokens::default()
                },
                source_model_id: None,
                timestamp_ms: None,
                context_window_size: None,
                context_window_source: None,
                parent_tool_use_id: None,
            },
        };
        let ctx = RoutingTestContext::new().await;
        let request = ctx.request(&update, None);
        let plan = route_live_session_state_envelope(&request).expect("usage telemetry route");
        assert_eq!(plan.builder, EnvelopeBuilderKind::UsageTelemetry);
        assert!(!plan.is_transcript_bearing);
    }

    #[tokio::test]
    async fn routes_plan_update_to_plan_builder() {
        let update = SessionUpdate::Plan {
            plan: crate::acp::session_update::PlanData {
                steps: Vec::new(),
                current_step: None,
                has_plan: true,
                streaming: false,
                content: None,
                content_markdown: None,
                file_path: None,
                title: Some("Plan".to_string()),
                source: None,
                confidence: None,
                agent_id: None,
                updated_at: None,
            },
            session_id: Some("session-1".to_string()),
        };
        let ctx = RoutingTestContext::new().await;
        let request = ctx.request(&update, None);
        let plan = route_live_session_state_envelope(&request).expect("plan route");
        assert_eq!(plan.builder, EnvelopeBuilderKind::Plan);
        assert!(!plan.is_transcript_bearing);
    }

    #[test]
    fn patch_id_extractors_match_update_shape() {
        let tool_update = create_tool_call_update();
        assert_eq!(
            tool_call_id_for_operation_patch(&tool_update),
            Some("tool-1")
        );
        let permission_update = create_permission_update();
        assert_eq!(
            interaction_id_for_patch(&permission_update),
            Some("permission-1")
        );
    }
}
