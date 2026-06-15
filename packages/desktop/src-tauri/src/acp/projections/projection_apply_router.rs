use crate::acp::projections::helpers::{
    normalize_tool_call_for_operation_ingress, should_skip_unanswered_question_tool_operation,
};
use crate::acp::projections::terminal_turn_guard::TerminalTurnGuard;
use crate::acp::session_update::SessionUpdate;

/// Which projection reducer arm should apply a live `SessionUpdate`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProjectionApplyArm {
    UserMessageChunk,
    AgentMessageChunk,
    AgentThoughtChunk,
    ToolCall,
    ToolCallAsConvertedQuestion,
    ToolCallUpdate,
    PermissionRequest,
    QuestionRequest,
    TurnComplete,
    TurnError,
    TurnCancelled,
}

/// Routing outcome for a live projection apply.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProjectionApplyRoute {
    Apply(ProjectionApplyArm),
    Skip,
}

/// Route a live `SessionUpdate` to a projection apply arm without mutating state.
#[must_use]
pub fn route_projection_apply(
    update: &SessionUpdate,
    guard: &TerminalTurnGuard,
) -> ProjectionApplyRoute {
    let decision = guard.route(update);
    if decision.ignore_late {
        return ProjectionApplyRoute::Skip;
    }

    match update {
        SessionUpdate::UserMessageChunk { .. } => {
            ProjectionApplyRoute::Apply(ProjectionApplyArm::UserMessageChunk)
        }
        SessionUpdate::AgentMessageChunk { .. } if !decision.suppress => {
            ProjectionApplyRoute::Apply(ProjectionApplyArm::AgentMessageChunk)
        }
        SessionUpdate::AgentMessageChunk { .. } => ProjectionApplyRoute::Skip,
        SessionUpdate::AgentThoughtChunk { .. } if !decision.suppress => {
            ProjectionApplyRoute::Apply(ProjectionApplyArm::AgentThoughtChunk)
        }
        SessionUpdate::AgentThoughtChunk { .. } => ProjectionApplyRoute::Skip,
        SessionUpdate::ToolCall { tool_call, .. } => {
            if decision.suppress {
                return ProjectionApplyRoute::Skip;
            }
            let normalized = normalize_tool_call_for_operation_ingress(tool_call);
            if should_skip_unanswered_question_tool_operation(&normalized) {
                return ProjectionApplyRoute::Apply(ProjectionApplyArm::ToolCallAsConvertedQuestion);
            }
            ProjectionApplyRoute::Apply(ProjectionApplyArm::ToolCall)
        }
        SessionUpdate::ToolCallUpdate { .. } => {
            if decision.suppress {
                ProjectionApplyRoute::Skip
            } else {
                ProjectionApplyRoute::Apply(ProjectionApplyArm::ToolCallUpdate)
            }
        }
        SessionUpdate::PermissionRequest { .. } => {
            ProjectionApplyRoute::Apply(ProjectionApplyArm::PermissionRequest)
        }
        SessionUpdate::QuestionRequest { .. } => {
            ProjectionApplyRoute::Apply(ProjectionApplyArm::QuestionRequest)
        }
        SessionUpdate::TurnComplete { .. } => {
            ProjectionApplyRoute::Apply(ProjectionApplyArm::TurnComplete)
        }
        SessionUpdate::TurnError { .. } => {
            ProjectionApplyRoute::Apply(ProjectionApplyArm::TurnError)
        }
        SessionUpdate::TurnCancelled { .. } => {
            ProjectionApplyRoute::Apply(ProjectionApplyArm::TurnCancelled)
        }
        _ => ProjectionApplyRoute::Skip,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        route_projection_apply, ProjectionApplyArm, ProjectionApplyRoute,
    };
    use crate::acp::projections::terminal_turn_guard::TerminalTurnGuard;
    use crate::acp::projections::types::{SessionTurnState, TurnFailureSnapshot};
    use crate::acp::session_update::{
        ContentChunk, PermissionData, PlanData, QuestionData, SessionUpdate, ToolArguments,
        ToolCallData, ToolCallStatus, ToolCallUpdateData, ToolKind, TurnErrorData,
    };
    use crate::acp::types::ContentBlock;

    fn guard_with_turn_state(turn_state: SessionTurnState) -> TerminalTurnGuard {
        TerminalTurnGuard::from_parts(turn_state, None, None)
    }

    fn failed_guard(turn_id: &str) -> TerminalTurnGuard {
        TerminalTurnGuard::from_parts(
            SessionTurnState::Failed,
            Some(TurnFailureSnapshot {
                turn_id: Some(turn_id.to_string()),
                message: "boom".to_string(),
                code: None,
                kind: crate::acp::session_update::TurnErrorKind::Recoverable,
                source: crate::acp::session_update::TurnErrorSource::Unknown,
            }),
            Some(turn_id.to_string()),
        )
    }

    fn agent_chunk_update() -> SessionUpdate {
        SessionUpdate::AgentMessageChunk {
            chunk: ContentChunk {
                content: ContentBlock::Text {
                    text: "hi".to_string(),
                },
                aggregation_hint: None,
            },
            part_id: None,
            message_id: Some("msg-1".to_string()),
            session_id: Some("session-1".to_string()),
            produced_at_monotonic_ms: None,
        }
    }

    fn tool_call_update() -> SessionUpdate {
        SessionUpdate::ToolCall {
            tool_call: ToolCallData {
                id: "tool-1".to_string(),
                name: "bash".to_string(),
                arguments: ToolArguments::Execute {
                    command: Some("pwd".to_string()),
                },
                diagnostic_input: None,
                status: ToolCallStatus::Pending,
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

    #[test]
    fn routes_message_chunks_to_transcript_arms() {
        let guard = guard_with_turn_state(SessionTurnState::Running);
        let user = SessionUpdate::UserMessageChunk {
            chunk: ContentChunk {
                content: ContentBlock::Text {
                    text: "hello".to_string(),
                },
                aggregation_hint: None,
            },
            session_id: Some("session-1".to_string()),
            attempt_id: None,
        };
        assert_eq!(
            route_projection_apply(&user, &guard),
            ProjectionApplyRoute::Apply(ProjectionApplyArm::UserMessageChunk)
        );
        assert_eq!(
            route_projection_apply(&agent_chunk_update(), &guard),
            ProjectionApplyRoute::Apply(ProjectionApplyArm::AgentMessageChunk)
        );
    }

    #[test]
    fn routes_agent_thought_only_when_turn_not_terminal() {
        let thought = SessionUpdate::AgentThoughtChunk {
            chunk: ContentChunk {
                content: ContentBlock::Text {
                    text: "thinking".to_string(),
                },
                aggregation_hint: None,
            },
            part_id: None,
            message_id: None,
            session_id: Some("session-1".to_string()),
        };
        let running = guard_with_turn_state(SessionTurnState::Running);
        assert_eq!(
            route_projection_apply(&thought, &running),
            ProjectionApplyRoute::Apply(ProjectionApplyArm::AgentThoughtChunk)
        );
        let failed = failed_guard("turn-1");
        assert_eq!(route_projection_apply(&thought, &failed), ProjectionApplyRoute::Skip);
    }

    #[test]
    fn routes_tool_call_and_skips_terminal_turn() {
        let running = guard_with_turn_state(SessionTurnState::Running);
        assert_eq!(
            route_projection_apply(&tool_call_update(), &running),
            ProjectionApplyRoute::Apply(ProjectionApplyArm::ToolCall)
        );
        let cancelled = guard_with_turn_state(SessionTurnState::Cancelled);
        assert_eq!(
            route_projection_apply(&tool_call_update(), &cancelled),
            ProjectionApplyRoute::Skip
        );
    }

    #[test]
    fn routes_unanswered_question_tool_to_converted_interaction_arm() {
        let guard = guard_with_turn_state(SessionTurnState::Running);
        let tool_call = ToolCallData {
            id: "q-1".to_string(),
            name: "AskUserQuestion".to_string(),
            arguments: ToolArguments::Execute {
                command: Some("ask".to_string()),
            },
            diagnostic_input: None,
            status: ToolCallStatus::Pending,
            result: None,
            kind: Some(ToolKind::Question),
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
        };
        let update = SessionUpdate::ToolCall {
            tool_call,
            session_id: Some("session-1".to_string()),
        };
        assert_eq!(
            route_projection_apply(&update, &guard),
            ProjectionApplyRoute::Apply(ProjectionApplyArm::ToolCallAsConvertedQuestion)
        );
    }

    #[test]
    fn routes_interaction_and_turn_terminal_arms() {
        let guard = guard_with_turn_state(SessionTurnState::Running);
        let permission = SessionUpdate::PermissionRequest {
            permission: PermissionData {
                id: "perm-1".to_string(),
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
        };
        assert_eq!(
            route_projection_apply(&permission, &guard),
            ProjectionApplyRoute::Apply(ProjectionApplyArm::PermissionRequest)
        );

        let question = SessionUpdate::QuestionRequest {
            question: QuestionData {
                id: "question-1".to_string(),
                session_id: "session-1".to_string(),
                json_rpc_request_id: None,
                reply_handler: None,
                questions: vec![],
                tool: None,
            },
            session_id: Some("session-1".to_string()),
        };
        assert_eq!(
            route_projection_apply(&question, &guard),
            ProjectionApplyRoute::Apply(ProjectionApplyArm::QuestionRequest)
        );

        let complete = SessionUpdate::TurnComplete {
            session_id: Some("session-1".to_string()),
            turn_id: Some("turn-1".to_string()),
        };
        assert_eq!(
            route_projection_apply(&complete, &guard),
            ProjectionApplyRoute::Apply(ProjectionApplyArm::TurnComplete)
        );

        let error = SessionUpdate::TurnError {
            error: TurnErrorData::Legacy("quota".to_string()),
            turn_id: Some("turn-1".to_string()),
            session_id: Some("session-1".to_string()),
        };
        assert_eq!(
            route_projection_apply(&error, &guard),
            ProjectionApplyRoute::Apply(ProjectionApplyArm::TurnError)
        );

        let cancelled = SessionUpdate::TurnCancelled {
            session_id: Some("session-1".to_string()),
            turn_id: Some("turn-1".to_string()),
        };
        assert_eq!(
            route_projection_apply(&cancelled, &guard),
            ProjectionApplyRoute::Apply(ProjectionApplyArm::TurnCancelled)
        );
    }

    #[test]
    fn skips_late_turn_complete_after_terminal_failure() {
        let failed = failed_guard("turn-1");
        let complete = SessionUpdate::TurnComplete {
            session_id: Some("session-1".to_string()),
            turn_id: Some("turn-1".to_string()),
        };
        assert_eq!(
            route_projection_apply(&complete, &failed),
            ProjectionApplyRoute::Skip
        );
    }

    #[test]
    fn routes_tool_call_update_and_skips_terminal_turn() {
        let running = guard_with_turn_state(SessionTurnState::Running);
        let update = SessionUpdate::ToolCallUpdate {
            update: ToolCallUpdateData {
                tool_call_id: "tool-1".to_string(),
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
            session_id: Some("session-1".to_string()),
        };
        assert_eq!(
            route_projection_apply(&update, &running),
            ProjectionApplyRoute::Apply(ProjectionApplyArm::ToolCallUpdate)
        );
        let cancelled = guard_with_turn_state(SessionTurnState::Cancelled);
        assert_eq!(
            route_projection_apply(&update, &cancelled),
            ProjectionApplyRoute::Skip
        );
    }

    #[test]
    fn skips_unhandled_update_kinds() {
        let guard = guard_with_turn_state(SessionTurnState::Running);
        let plan = SessionUpdate::Plan {
            plan: PlanData::from_steps(vec![]),
            session_id: Some("session-1".to_string()),
        };
        assert_eq!(route_projection_apply(&plan, &guard), ProjectionApplyRoute::Skip);
    }
}
