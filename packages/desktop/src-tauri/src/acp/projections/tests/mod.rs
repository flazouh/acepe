use super::*;
use crate::acp::session_thread_snapshot::SessionThreadSnapshot;
use crate::acp::session_update::{
    ContentChunk, EditEntry, QuestionItem, ToolArguments, ToolCallData, ToolCallUpdateData,
    ToolKind,
};
use crate::acp::types::ContentBlock;
use crate::computer_use::permissions::ComputerPermissionKind;
use crate::session_jsonl::types::{
    QuestionAnswer, StoredAssistantChunk, StoredAssistantMessage, StoredContentBlock, StoredEntry,
    StoredUserMessage,
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
            parent_tool_use_id: None,
            session_id: Some("session-1".to_string()),
            produced_at_monotonic_ms: None,
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
    assert_eq!(snapshot.turn_state, SessionTurnState::Completed);
    assert_eq!(snapshot.last_event_seq, 2);
}

#[test]
fn no_message_id_agent_chunks_expose_stable_live_assistant_id() {
    let registry = ProjectionRegistry::new();
    registry.register_session("session-1".to_string(), CanonicalAgentId::ClaudeCode);

    registry.apply_session_update(
        "session-1",
        &SessionUpdate::UserMessageChunk {
            chunk: ContentChunk {
                content: ContentBlock::Text {
                    text: "reply shortly".to_string(),
                },
                aggregation_hint: None,
            },
            session_id: Some("session-1".to_string()),
            attempt_id: None,
        },
    );
    registry.apply_session_update(
        "session-1",
        &SessionUpdate::AgentMessageChunk {
            chunk: ContentChunk {
                content: ContentBlock::Text {
                    text: "Lanterns glow".to_string(),
                },
                aggregation_hint: None,
            },
            part_id: None,
            message_id: None,
            parent_tool_use_id: None,
            session_id: Some("session-1".to_string()),
            produced_at_monotonic_ms: None,
        },
    );
    registry.apply_session_update(
        "session-1",
        &SessionUpdate::AgentMessageChunk {
            chunk: ContentChunk {
                content: ContentBlock::Text {
                    text: " softly.".to_string(),
                },
                aggregation_hint: None,
            },
            part_id: None,
            message_id: None,
            parent_tool_use_id: None,
            session_id: Some("session-1".to_string()),
            produced_at_monotonic_ms: None,
        },
    );

    let snapshot = registry
        .snapshot_for_session("session-1")
        .expect("expected session snapshot");
    assert_eq!(snapshot.turn_state, SessionTurnState::Running);
    assert_eq!(snapshot.last_event_seq, 3);
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
            parent_tool_use_id: None,
            produced_at_monotonic_ms: None,
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
            attempt_id: None,
        },
    );

    let running_snapshot = registry
        .snapshot_for_session("session-1")
        .expect("expected running snapshot");
    assert_eq!(running_snapshot.turn_state, SessionTurnState::Running);
    assert!(running_snapshot.active_turn_failure.is_none());
    assert!(running_snapshot.last_terminal_turn_id.is_none());
}

#[test]
fn apply_session_update_cancels_active_operations_for_user_cancel() {
    let registry = ProjectionRegistry::new();
    registry.register_session("session-1".to_string(), CanonicalAgentId::Codex);

    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCall {
            tool_call: create_execute_tool_call(
                "tool-1",
                "bun run check",
                ToolCallStatus::InProgress,
            ),
            session_id: Some("session-1".to_string()),
        },
    );
    registry.apply_session_update(
        "session-1",
        &SessionUpdate::TurnCancelled {
            session_id: Some("session-1".to_string()),
            turn_id: Some("turn-1".to_string()),
        },
    );

    let snapshot = registry
        .snapshot_for_session("session-1")
        .expect("expected cancelled snapshot");
    assert_eq!(snapshot.turn_state, SessionTurnState::Cancelled);
    assert!(snapshot.active_tool_call_ids.is_empty());
    assert!(snapshot.active_turn_failure.is_none());
    assert_eq!(snapshot.last_terminal_turn_id.as_deref(), Some("turn-1"));
    let operation = registry
        .operation_for_tool_call("session-1", "tool-1")
        .expect("expected cancelled operation");
    assert_eq!(operation.operation_state, OperationState::Cancelled);
}

#[test]
fn apply_session_update_preserves_no_id_cancel_until_new_user_turn() {
    let registry = ProjectionRegistry::new();
    registry.register_session("session-1".to_string(), CanonicalAgentId::Codex);

    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCall {
            tool_call: create_execute_tool_call(
                "tool-1",
                "bun run check",
                ToolCallStatus::InProgress,
            ),
            session_id: Some("session-1".to_string()),
        },
    );
    registry.apply_session_update(
        "session-1",
        &SessionUpdate::TurnCancelled {
            session_id: Some("session-1".to_string()),
            turn_id: None,
        },
    );
    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCallUpdate {
            update: ToolCallUpdateData {
                tool_call_id: "tool-1".to_string(),
                status: Some(ToolCallStatus::InProgress),
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
        },
    );
    registry.apply_session_update(
        "session-1",
        &SessionUpdate::TurnError {
            error: crate::acp::session_update::TurnErrorData::Legacy(
                "Operation cancelled by user".to_string(),
            ),
            session_id: Some("session-1".to_string()),
            turn_id: Some("late-turn".to_string()),
        },
    );

    let cancelled_snapshot = registry
        .snapshot_for_session("session-1")
        .expect("expected cancelled snapshot after late events");
    assert_eq!(cancelled_snapshot.turn_state, SessionTurnState::Cancelled);
    assert!(cancelled_snapshot.active_turn_failure.is_none());
    assert!(cancelled_snapshot.last_terminal_turn_id.is_none());
    let cancelled_operation = registry
        .operation_for_tool_call("session-1", "tool-1")
        .expect("expected cancelled operation");
    assert_eq!(
        cancelled_operation.operation_state,
        OperationState::Cancelled
    );

    registry.apply_session_update(
        "session-1",
        &SessionUpdate::UserMessageChunk {
            chunk: ContentChunk {
                content: ContentBlock::Text {
                    text: "try again".to_string(),
                },
                aggregation_hint: None,
            },
            session_id: Some("session-1".to_string()),
            attempt_id: None,
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
        diagnostic_input: None,
        status,
        result: None,
        kind: Some(ToolKind::Execute),
        title: Some("Run command".to_string()),
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

fn create_computer_tool_call(id: &str, status: ToolCallStatus) -> ToolCallData {
    ToolCallData {
        id: id.to_string(),
        name: "mcp__acepe_computer__act".to_string(),
        arguments: ToolArguments::Computer {
            verb: Some("observe".to_string()),
            target_id: None,
            epoch: None,
            text: None,
            key: None,
            delta_x: None,
            delta_y: None,
            include_bounds: None,
            include_screenshot: None,
        },
        diagnostic_input: None,
        status,
        result: None,
        kind: Some(ToolKind::Computer),
        title: Some("Computer".to_string()),
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

#[test]
fn operation_projection_tracks_one_canonical_tool_lifecycle() {
    let registry = ProjectionRegistry::new();

    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCall {
            tool_call: create_execute_tool_call("tool-1", "mkdir demo", ToolCallStatus::Pending),
            session_id: Some("session-1".to_string()),
        },
    );

    let created = registry
        .operation_for_tool_call("session-1", "tool-1")
        .expect("expected created operation");
    assert_eq!(created.command.as_deref(), Some("mkdir demo"));
    assert_eq!(created.provider_status, ToolCallStatus::Pending);

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
    assert_eq!(completed.provider_status, ToolCallStatus::Completed);
    assert_eq!(completed.result, Some(json!("done")));
    assert!(completed.progressive_arguments.is_none());
}

#[test]
fn operation_projection_treats_claude_resumed_missing_result_as_completed() {
    let registry = ProjectionRegistry::new();

    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCall {
            tool_call: create_execute_tool_call(
                "tool-1",
                "head -30 file.txt",
                ToolCallStatus::Pending,
            ),
            session_id: Some("session-1".to_string()),
        },
    );

    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCallUpdate {
            update: ToolCallUpdateData {
                tool_call_id: "tool-1".to_string(),
                status: Some(ToolCallStatus::Failed),
                result: Some(json!({
                    "stderr": CLAUDE_RESUMED_MISSING_TOOL_RESULT_MESSAGE
                })),
                failure_reason: Some(CLAUDE_RESUMED_MISSING_TOOL_RESULT_MESSAGE.to_string()),
                ..ToolCallUpdateData::default()
            },
            session_id: Some("session-1".to_string()),
        },
    );

    let operation = registry
        .operation_for_tool_call("session-1", "tool-1")
        .expect("expected operation");
    assert_eq!(operation.provider_status, ToolCallStatus::Completed);
    assert_eq!(operation.operation_state, OperationState::Completed);
    assert_eq!(
        operation
            .result
            .as_ref()
            .and_then(|result| result.get("stderr"))
            .and_then(|value| value.as_str()),
        Some(CLAUDE_RESUMED_MISSING_TOOL_RESULT_MESSAGE)
    );
}

#[test]
fn live_tool_call_links_operation_to_transcript_entry() {
    let registry = ProjectionRegistry::new();

    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCall {
            tool_call: create_execute_tool_call("tool-1", "ls", ToolCallStatus::Pending),
            session_id: Some("session-1".to_string()),
        },
    );

    let operation = registry
        .operation_for_tool_call("session-1", "tool-1")
        .expect("expected live operation");
    assert_eq!(
        operation.source_link,
        OperationSourceLink::TranscriptLinked {
            entry_id: "acepe::entry::session-start::tool::tool-1".to_string()
        }
    );
}

#[test]
fn provider_tool_id_with_control_character_normalizes_to_transcript_linked_operation() {
    let registry = ProjectionRegistry::new();
    let tool_call_id =
        "call_MsKdahsWK4cuKJzzuOsgpjxG\nfc_008c04d42d7516f80169f23545d0fc819a8a3e522df8820405";
    let normalized_tool_call_id =
        "call_MsKdahsWK4cuKJzzuOsgpjxG%0Afc_008c04d42d7516f80169f23545d0fc819a8a3e522df8820405";

    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCall {
            tool_call: create_execute_tool_call(tool_call_id, "find .", ToolCallStatus::Completed),
            session_id: Some("session-1".to_string()),
        },
    );

    let operation = registry
        .operation_for_tool_call("session-1", tool_call_id)
        .expect("raw provider id should resolve to normalized canonical operation");
    assert_eq!(operation.tool_call_id, normalized_tool_call_id);
    assert_eq!(operation.operation_state, OperationState::Completed);
    assert!(operation.degradation_reason.is_none());
    assert_eq!(
            operation.source_link,
            OperationSourceLink::TranscriptLinked {
                entry_id: "acepe::entry::session-start::tool::call_MsKdahsWK4cuKJzzuOsgpjxG%0Afc_008c04d42d7516f80169f23545d0fc819a8a3e522df8820405".to_string(),
            }
        );
    assert_eq!(registry.session_operations("session-1").len(), 1);
}

#[test]
fn operation_projection_preserves_parent_child_relationships() {
    let registry = ProjectionRegistry::new();
    let mut parent = ToolCallData {
        id: "task-parent".to_string(),
        name: "task".to_string(),
        arguments: ToolArguments::Other {
            raw: json!({}),
            intent: None,
        },
        diagnostic_input: None,
        status: ToolCallStatus::Pending,
        result: None,
        kind: Some(ToolKind::Task),
        title: Some("Task".to_string()),
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
                    message_id: None,
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
                    message_id: None,
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
fn live_unanswered_question_tool_projects_as_interaction_not_running_operation() {
    use crate::acp::session_update::{QuestionItem, QuestionOption};

    let registry = ProjectionRegistry::new();
    let mut tool_call =
        create_execute_tool_call("tool-question", "ask user", ToolCallStatus::InProgress);
    tool_call.name = "AskUserQuestion".to_string();
    tool_call.kind = Some(ToolKind::Question);
    tool_call.title = Some("Question".to_string());
    tool_call.normalized_questions = Some(vec![QuestionItem {
        question: "Which archive button should get the confirm step?".to_string(),
        header: "Archive confirm".to_string(),
        options: vec![QuestionOption {
            label: "Sidebar session list".to_string(),
            description: "Use the archive button in the session list".to_string(),
        }],
        multi_select: false,
    }]);

    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCall {
            tool_call,
            session_id: Some("session-1".to_string()),
        },
    );

    let projection = registry.session_projection("session-1");

    assert!(
        projection.operations.is_empty(),
        "live AskUserQuestion tools should not appear as running operations"
    );
    assert_eq!(projection.interactions.len(), 1);
    assert_eq!(projection.interactions[0].kind, InteractionKind::Question);
    assert_eq!(projection.interactions[0].state, InteractionState::Pending);
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
            active_tool_call_ids: vec![],
            completed_tool_call_ids: vec!["tool-1".to_string()],
            active_turn_failure: None,
            last_terminal_turn_id: None,
            assistant_boundary_entry_count: 0,
            transcript_entry_count: 0,
        }),
        operations: vec![OperationSnapshot {
            id: "session-1:tool-1".to_string(),
            session_id: "session-1".to_string(),
            tool_call_id: "tool-1".to_string(),
            name: "bash".to_string(),
            kind: Some(ToolKind::Execute),
            provider_status: ToolCallStatus::Completed,
            title: Some("Run command".to_string()),
            arguments: ToolArguments::Execute {
                command: Some("bun test".to_string()),
            },
            progressive_arguments: None,
            result: Some(json!("done")),
            computer_payload: None,
            command: Some("bun test".to_string()),
            normalized_todos: None,
            parent_tool_call_id: None,
            parent_operation_id: None,
            child_tool_call_ids: vec![],
            child_operation_ids: vec![],
            operation_provenance_key: None,
            operation_state: OperationState::Completed,
            locations: None,
            skill_meta: None,
            normalized_questions: None,
            question_answer: None,
            awaiting_plan_approval: false,
            plan_approval_request_id: None,
            started_at_ms: None,
            completed_at_ms: None,
            source_link: OperationSourceLink::transcript_linked("tool-1".to_string()),
            degradation_reason: None,
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
            canonical_operation_id: None,
        }],
        runtime: None,
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
                    arguments: ToolArguments::Other {
                        raw: json!({}),
                        intent: None,
                    },
                    diagnostic_input: None,
                    status: ToolCallStatus::Completed,
                    result: None,
                    kind: Some(ToolKind::Question),
                    title: None,
                    locations: None,
                    skill_meta: None,
                    normalized_questions: Some(question_items.clone()),
                    normalized_todos: None,
                    normalized_todo_update: None,
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
                    arguments: ToolArguments::Other {
                        raw: json!({}),
                        intent: None,
                    },
                    diagnostic_input: None,
                    status: ToolCallStatus::Pending,
                    result: None,
                    kind: Some(ToolKind::CreatePlan),
                    title: None,
                    locations: None,
                    skill_meta: None,
                    normalized_questions: None,
                    normalized_todos: None,
                    normalized_todo_update: None,
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

    let question_operation = projection
        .operations
        .iter()
        .find(|operation| operation.tool_call_id == "tool-question")
        .expect("expected imported question operation");
    assert_eq!(
        question_operation.source_link,
        OperationSourceLink::TranscriptLinked {
            entry_id: "acepe::entry::assistant-boundary:1::tool::tool-question".to_string()
        }
    );

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
fn project_thread_snapshot_skips_unanswered_question_tools() {
    let question_items = vec![crate::acp::session_update::QuestionItem {
        question: "Pick an archive target?".to_string(),
        header: "Archive".to_string(),
        options: vec![crate::acp::session_update::QuestionOption {
            label: "Sidebar".to_string(),
            description: "Archive from the sidebar".to_string(),
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
                        text: Some("add confirm".to_string()),
                    },
                    chunks: vec![],
                    sent_at: Some("2026-04-08T00:00:00Z".to_string()),
                },
                timestamp: Some("2026-04-08T00:00:00Z".to_string()),
            },
            StoredEntry::ToolCall {
                id: "tool-question-entry".to_string(),
                message: ToolCallData {
                    id: "tool-question".to_string(),
                    name: "AskUserQuestion".to_string(),
                    arguments: ToolArguments::Other {
                        raw: json!({
                            "questions": [{
                                "question": "Pick an archive target?",
                                "header": "Archive",
                                "options": [{
                                    "label": "Sidebar",
                                    "description": "Archive from the sidebar"
                                }],
                                "multiSelect": false
                            }]
                        }),
                        intent: None,
                    },
                    diagnostic_input: None,
                    status: ToolCallStatus::Pending,
                    result: None,
                    kind: Some(ToolKind::Question),
                    title: Some("Question".to_string()),
                    locations: None,
                    skill_meta: None,
                    normalized_questions: Some(question_items),
                    normalized_todos: None,
                    normalized_todo_update: None,
                    parent_tool_use_id: None,
                    task_children: None,
                    question_answer: None,
                    awaiting_plan_approval: false,
                    plan_approval_request_id: None,
                },
                timestamp: Some("2026-04-08T00:00:01Z".to_string()),
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

    assert!(
        projection.operations.is_empty(),
        "unanswered historical questions should not reappear as pending operations"
    );
    assert!(
        projection.interactions.is_empty(),
        "unanswered historical questions should not reappear as pending interactions"
    );
    assert_eq!(
        projection.session.expect("expected session").turn_state,
        SessionTurnState::Completed
    );
}

#[test]
fn project_converted_session_does_not_restore_stored_error_as_live_failure() {
    let thread_snapshot = SessionThreadSnapshot {
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
        title: "Imported error".to_string(),
        created_at: "2026-04-15T00:00:00Z".to_string(),
        current_mode_id: None,
    };

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
    let transcript = crate::acp::transcript_projection::TranscriptSnapshot::from_stored_entries(
        session.last_event_seq,
        &thread_snapshot.entries,
    );
    assert!(
        transcript.entries.is_empty(),
        "stored errors must not materialize as transcript rows"
    );
}

#[test]
fn project_converted_session_clears_historical_error_when_later_entries_continue() {
    let thread_snapshot = SessionThreadSnapshot {
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
        title: "Recovered session".to_string(),
        created_at: "2026-04-15T00:00:00Z".to_string(),
        current_mode_id: None,
    };

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
fn project_thread_snapshot_cancels_active_tool_when_transcript_continues() {
    let thread_snapshot = SessionThreadSnapshot {
        entries: vec![
            StoredEntry::User {
                id: "user-1".to_string(),
                message: StoredUserMessage {
                    id: Some("user-1".to_string()),
                    content: StoredContentBlock {
                        block_type: "text".to_string(),
                        text: Some("run the scaffold".to_string()),
                    },
                    chunks: vec![],
                    sent_at: Some("2026-04-15T00:00:00Z".to_string()),
                },
                timestamp: Some("2026-04-15T00:00:00Z".to_string()),
            },
            StoredEntry::ToolCall {
                id: "tool-stale-entry".to_string(),
                message: create_execute_tool_call(
                    "tool-stale",
                    "bun create @tanstack/start",
                    ToolCallStatus::InProgress,
                ),
                timestamp: Some("2026-04-15T00:00:01Z".to_string()),
            },
            StoredEntry::User {
                id: "user-2".to_string(),
                message: StoredUserMessage {
                    id: Some("user-2".to_string()),
                    content: StoredContentBlock {
                        block_type: "text".to_string(),
                        text: Some("i ran it myself, proceed".to_string()),
                    },
                    chunks: vec![],
                    sent_at: Some("2026-04-15T00:00:02Z".to_string()),
                },
                timestamp: Some("2026-04-15T00:00:02Z".to_string()),
            },
            StoredEntry::Assistant {
                id: "assistant-1".to_string(),
                message: StoredAssistantMessage {
                    chunks: vec![StoredAssistantChunk {
                        chunk_type: "message".to_string(),
                        block: StoredContentBlock {
                            block_type: "text".to_string(),
                            text: Some("Proceeding.".to_string()),
                        },
                    }],
                    model: Some("gpt-5.4".to_string()),
                    display_model: Some("GPT-5.4".to_string()),
                    received_at: Some("2026-04-15T00:00:03Z".to_string()),
                },
                timestamp: Some("2026-04-15T00:00:03Z".to_string()),
            },
        ],
        title: "Recovered session".to_string(),
        created_at: "2026-04-15T00:00:00Z".to_string(),
        current_mode_id: None,
    };

    let projection = ProjectionRegistry::project_thread_snapshot(
        "session-1",
        Some(CanonicalAgentId::Copilot),
        &thread_snapshot,
    );

    let session = projection
        .session
        .expect("expected imported session snapshot");
    assert_eq!(session.turn_state, SessionTurnState::Completed);
    assert!(session.active_tool_call_ids.is_empty());
    let stale_operation = projection
        .operations
        .iter()
        .find(|operation| operation.tool_call_id == "tool-stale")
        .expect("expected stale tool operation");
    assert_eq!(stale_operation.provider_status, ToolCallStatus::InProgress);
    assert_eq!(stale_operation.operation_state, OperationState::Cancelled);
}

#[test]
fn project_thread_snapshot_does_not_reopen_pending_interaction_after_user_boundary() {
    let thread_snapshot = SessionThreadSnapshot {
        entries: vec![
            StoredEntry::ToolCall {
                id: "plan-tool-entry".to_string(),
                message: ToolCallData {
                    id: "plan-tool".to_string(),
                    name: "create_plan".to_string(),
                    arguments: ToolArguments::Other {
                        raw: json!({}),
                        intent: None,
                    },
                    diagnostic_input: None,
                    status: ToolCallStatus::Pending,
                    result: None,
                    kind: Some(ToolKind::CreatePlan),
                    title: None,
                    locations: None,
                    skill_meta: None,
                    normalized_questions: None,
                    normalized_todos: None,
                    normalized_todo_update: None,
                    parent_tool_use_id: None,
                    task_children: None,
                    question_answer: None,
                    awaiting_plan_approval: true,
                    plan_approval_request_id: Some(42),
                },
                timestamp: Some("2026-04-15T00:00:01Z".to_string()),
            },
            StoredEntry::User {
                id: "user-1".to_string(),
                message: StoredUserMessage {
                    id: Some("user-1".to_string()),
                    content: StoredContentBlock {
                        block_type: "text".to_string(),
                        text: Some("continue without that approval".to_string()),
                    },
                    chunks: vec![],
                    sent_at: Some("2026-04-15T00:00:02Z".to_string()),
                },
                timestamp: Some("2026-04-15T00:00:02Z".to_string()),
            },
        ],
        title: "Recovered session".to_string(),
        created_at: "2026-04-15T00:00:00Z".to_string(),
        current_mode_id: None,
    };

    let projection = ProjectionRegistry::project_thread_snapshot(
        "session-1",
        Some(CanonicalAgentId::Copilot),
        &thread_snapshot,
    );

    let session = projection
        .session
        .expect("expected imported session snapshot");
    assert_eq!(session.turn_state, SessionTurnState::Completed);
    let operation = projection
        .operations
        .iter()
        .find(|operation| operation.tool_call_id == "plan-tool")
        .expect("expected plan operation");
    assert_eq!(operation.operation_state, OperationState::Cancelled);
    let interaction = projection
        .interactions
        .iter()
        .find(|interaction| interaction.kind == InteractionKind::PlanApproval)
        .expect("expected plan interaction");
    assert_eq!(interaction.state, InteractionState::Unresolved);
    assert!(interaction.reply_handler.is_none());
}

#[test]
fn project_converted_session_ignores_stored_error_without_source_metadata() {
    let thread_snapshot = SessionThreadSnapshot {
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
        title: "Imported error".to_string(),
        created_at: "2026-04-15T00:00:00Z".to_string(),
        current_mode_id: None,
    };

    let projection = ProjectionRegistry::project_thread_snapshot(
        "session-1",
        Some(CanonicalAgentId::Codex),
        &thread_snapshot,
    );

    let session = projection
        .session
        .expect("expected imported session snapshot");
    assert!(session.active_turn_failure.is_none());
    assert_eq!(session.turn_state, SessionTurnState::Completed);
}

// --- Unit 3: canonical entrypoint idempotency and ordering ---

fn make_domain_event(seq: i64, session_id: &str) -> crate::acp::domain_events::SessionDomainEvent {
    use crate::acp::domain_events::{SessionDomainEvent, SessionDomainEventKind};
    SessionDomainEvent {
        event_id: format!("evt-{seq}"),
        seq,
        session_id: session_id.to_string(),
        provider_session_id: None,
        occurred_at_ms: 0,
        causation_id: None,
        kind: SessionDomainEventKind::AssistantMessageSegmentAppended,
        payload: None,
    }
}

fn agent_chunk_update(message_id: &str) -> SessionUpdate {
    use crate::acp::types::ContentBlock;
    SessionUpdate::AgentMessageChunk {
        chunk: ContentChunk {
            content: ContentBlock::Text {
                text: "hi".to_string(),
            },
            aggregation_hint: None,
        },
        part_id: None,
        message_id: Some(message_id.to_string()),
        parent_tool_use_id: None,
        session_id: None,
        produced_at_monotonic_ms: None,
    }
}

/// Happy path: applying canonical events in order advances last_event_seq and state.
#[test]
fn apply_canonical_event_advances_seq_and_projection() {
    let registry = ProjectionRegistry::new();
    registry.register_session("s1".to_string(), CanonicalAgentId::ClaudeCode);

    let event1 = make_domain_event(1, "s1");
    let event2 = make_domain_event(2, "s1");
    registry.apply_canonical_event("s1", &event1, &agent_chunk_update("msg-1"));
    registry.apply_canonical_event("s1", &event2, &agent_chunk_update("msg-2"));

    let snapshot = registry.snapshots.get("s1").unwrap();
    assert_eq!(
        snapshot.last_event_seq, 2,
        "seq must advance to canonical event seq"
    );
    assert_eq!(
        snapshot.message_count, 2,
        "two message chunks must be projected"
    );
}

#[test]
fn apply_canonical_event_uses_display_id_authority_for_live_tool_source_link() {
    let registry = ProjectionRegistry::new();
    registry.register_session("s1".to_string(), CanonicalAgentId::ClaudeCode);

    let event = make_domain_event(425, "s1");
    registry.apply_canonical_event(
        "s1",
        &event,
        &SessionUpdate::ToolCall {
            tool_call: create_execute_tool_call("tool-1", "pwd", ToolCallStatus::Pending),
            session_id: Some("s1".to_string()),
        },
    );

    let operation = registry
        .operation_for_tool_call("s1", "tool-1")
        .expect("expected operation");
    assert_eq!(
        operation.source_link,
        OperationSourceLink::TranscriptLinked {
            entry_id: "acepe::entry::session-start::tool::tool-1".to_string()
        }
    );
}

#[test]
fn event_seq_projection_keeps_display_id_authority_for_live_tool_source_link() {
    let registry = ProjectionRegistry::new();
    registry.register_session("s1".to_string(), CanonicalAgentId::ClaudeCode);
    let update = SessionUpdate::ToolCall {
        tool_call: create_execute_tool_call("tool-1", "pwd", ToolCallStatus::Pending),
        session_id: Some("s1".to_string()),
    };

    registry.apply_session_update("s1", &update);
    registry.apply_session_update_at_event_seq("s1", 425, &update);

    let operation = registry
        .operation_for_tool_call("s1", "tool-1")
        .expect("expected operation");
    assert_eq!(
        operation.source_link,
        OperationSourceLink::TranscriptLinked {
            entry_id: "acepe::entry::session-start::tool::tool-1".to_string()
        }
    );
}

/// Edge case: replaying the same canonical event is idempotent — applying it twice
/// produces exactly the same projection state as applying it once.
#[test]
fn apply_canonical_event_is_idempotent_for_duplicate_delivery() {
    let registry = ProjectionRegistry::new();
    registry.register_session("s1".to_string(), CanonicalAgentId::ClaudeCode);

    let event = make_domain_event(5, "s1");
    registry.apply_canonical_event("s1", &event, &agent_chunk_update("msg-1"));
    // Second delivery of the same canonical seq must be a no-op.
    registry.apply_canonical_event("s1", &event, &agent_chunk_update("msg-2"));

    let snapshot = registry.snapshots.get("s1").unwrap();
    assert_eq!(
        snapshot.message_count, 1,
        "duplicate delivery must be dropped"
    );
    assert_eq!(
        snapshot.last_event_seq, 5,
        "seq must remain at first-applied value"
    );
}

/// Edge case: a stale (out-of-order) canonical event with a seq below the current
/// frontier is rejected without corrupting projection state.
#[test]
fn apply_canonical_event_rejects_stale_out_of_order_delivery() {
    let registry = ProjectionRegistry::new();
    registry.register_session("s1".to_string(), CanonicalAgentId::ClaudeCode);

    // Apply seq=10 first (simulates a later event arriving or state restored from snapshot).
    let current = make_domain_event(10, "s1");
    registry.apply_canonical_event("s1", &current, &agent_chunk_update("msg-latest"));

    // Now attempt to apply seq=3 (stale / out-of-order) — must be dropped.
    let stale = make_domain_event(3, "s1");
    registry.apply_canonical_event("s1", &stale, &agent_chunk_update("msg-stale"));

    let snapshot = registry.snapshots.get("s1").unwrap();
    assert_eq!(
        snapshot.message_count, 1,
        "stale event must not add to projection"
    );
    assert_eq!(snapshot.last_event_seq, 10, "frontier must stay at seq=10");
}

// --- U5: three entry-point idempotency characterization ---

/// `apply_session_update` auto-increments `last_event_seq` and has no duplicate gate.
#[test]
fn apply_session_update_is_not_idempotent_for_duplicate_delivery() {
    let registry = ProjectionRegistry::new();
    registry.register_session("s1".to_string(), CanonicalAgentId::ClaudeCode);

    let update = agent_chunk_update("msg-1");
    registry.apply_session_update("s1", &update);
    registry.apply_session_update("s1", &update);

    let snapshot = registry.snapshots.get("s1").unwrap();
    assert_eq!(
        snapshot.message_count, 2,
        "raw apply path must project every delivery"
    );
    assert_eq!(
        snapshot.last_event_seq, 2,
        "raw apply path auto-increments without dedupe"
    );
}

/// `apply_session_update_at_event_seq` rejects replay when `event_seq <= last_event_seq`.
#[test]
fn apply_session_update_at_event_seq_skips_duplicate_event_seq() {
    let registry = ProjectionRegistry::new();
    registry.register_session("s1".to_string(), CanonicalAgentId::ClaudeCode);

    let first = agent_chunk_update("msg-1");
    let second = agent_chunk_update("msg-2");
    registry.apply_session_update_at_event_seq("s1", 5, &first);
    registry.apply_session_update_at_event_seq("s1", 5, &second);

    let snapshot = registry.snapshots.get("s1").unwrap();
    assert_eq!(
        snapshot.message_count, 1,
        "duplicate event_seq must be dropped"
    );
    assert_eq!(snapshot.last_event_seq, 5);
}

/// Non-positive `event_seq` delegates to raw apply without an idempotency gate.
#[test]
fn apply_session_update_at_event_seq_non_positive_seq_delegates_without_idempotency_gate() {
    let registry = ProjectionRegistry::new();
    registry.register_session("s1".to_string(), CanonicalAgentId::ClaudeCode);
    registry.set_last_event_seq_for_test("s1", 10);

    let update = agent_chunk_update("msg-1");
    registry.apply_session_update_at_event_seq("s1", 0, &update);
    registry.apply_session_update_at_event_seq("s1", 0, &update);

    let snapshot = registry.snapshots.get("s1").unwrap();
    assert_eq!(
        snapshot.message_count, 2,
        "event_seq <= 0 must not consult last_event_seq gate"
    );
    assert_eq!(
        snapshot.last_event_seq, 12,
        "delegated raw apply auto-increments from restored frontier"
    );
}

/// `apply_canonical_event` with `seq <= 0` applies without the canonical idempotency gate.
#[test]
fn apply_canonical_event_zero_seq_applies_without_idempotency_gate() {
    use crate::acp::domain_events::{SessionDomainEvent, SessionDomainEventKind};

    let registry = ProjectionRegistry::new();
    registry.register_session("s1".to_string(), CanonicalAgentId::ClaudeCode);
    registry.set_last_event_seq_for_test("s1", 10);

    let event = SessionDomainEvent {
        event_id: "evt-0".to_string(),
        seq: 0,
        session_id: "s1".to_string(),
        provider_session_id: None,
        occurred_at_ms: 0,
        causation_id: None,
        kind: SessionDomainEventKind::AssistantMessageSegmentAppended,
        payload: None,
    };
    registry.apply_canonical_event("s1", &event, &agent_chunk_update("msg-1"));
    registry.apply_canonical_event("s1", &event, &agent_chunk_update("msg-2"));

    let snapshot = registry.snapshots.get("s1").unwrap();
    assert_eq!(
        snapshot.message_count, 2,
        "canonical seq <= 0 must not short-circuit on last_event_seq"
    );
}

/// Error path: applying a turn-error canonical event leaves the session in a deterministic
/// failure state with the active failure preserved for subsequent reads.
#[test]
fn apply_canonical_event_preserves_turn_failure_state() {
    use crate::acp::domain_events::{SessionDomainEvent, SessionDomainEventKind};
    use crate::acp::session_update::TurnErrorData;

    let registry = ProjectionRegistry::new();
    registry.register_session("s1".to_string(), CanonicalAgentId::ClaudeCode);

    let error_event = SessionDomainEvent {
        event_id: "evt-err".to_string(),
        seq: 7,
        session_id: "s1".to_string(),
        provider_session_id: None,
        occurred_at_ms: 0,
        causation_id: None,
        kind: SessionDomainEventKind::TurnFailed,
        payload: None,
    };
    let error_update = SessionUpdate::TurnError {
        error: TurnErrorData::Legacy("quota exceeded".to_string()),
        turn_id: Some("turn-1".to_string()),
        session_id: Some("s1".to_string()),
    };

    registry.apply_canonical_event("s1", &error_event, &error_update);

    let snapshot = registry.snapshots.get("s1").unwrap();
    assert_eq!(snapshot.turn_state, SessionTurnState::Failed);
    assert!(snapshot.active_turn_failure.is_some());
    assert_eq!(snapshot.last_event_seq, 7);
}

#[test]
fn canonical_operation_id_stable_across_live_and_history_replay() {
    let registry = ProjectionRegistry::new();
    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCall {
            tool_call: create_execute_tool_call("tool-1", "echo hi", ToolCallStatus::Pending),
            session_id: Some("session-1".to_string()),
        },
    );
    let live_op = registry
        .operation_for_tool_call("session-1", "tool-1")
        .unwrap();
    let projection = registry.session_projection("session-1");
    let registry2 = ProjectionRegistry::new();
    registry2.restore_session_projection(projection);
    let restored_op = registry2
        .operation_for_tool_call("session-1", "tool-1")
        .unwrap();
    assert_eq!(live_op.id, restored_op.id);
    assert_eq!(live_op.operation_provenance_key, Some("tool-1".to_string()));
}

#[test]
fn operation_snapshot_preserves_extended_evidence() {
    use crate::acp::session_update::{QuestionItem, QuestionOption, SkillMeta, ToolCallLocation};
    let registry = ProjectionRegistry::new();
    let mut tool_call = create_execute_tool_call("tool-evidence", "ls", ToolCallStatus::Pending);
    tool_call.locations = Some(vec![ToolCallLocation {
        path: "/some/file.rs".to_string(),
    }]);
    tool_call.skill_meta = Some(SkillMeta {
        file_path: Some("read-file.ts".to_string()),
        description: None,
    });
    tool_call.normalized_questions = Some(vec![QuestionItem {
        question: "Approve?".to_string(),
        header: "Header".to_string(),
        options: vec![QuestionOption {
            label: "Yes".to_string(),
            description: "Yes".to_string(),
        }],
        multi_select: false,
    }]);
    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCall {
            tool_call,
            session_id: Some("session-1".to_string()),
        },
    );
    let op = registry
        .operation_for_tool_call("session-1", "tool-evidence")
        .unwrap();
    assert!(op.locations.is_some());
    assert!(op.skill_meta.is_some());
    assert!(op.normalized_questions.is_some());
}

#[test]
fn sparse_later_update_does_not_erase_richer_prior_evidence() {
    use crate::acp::session_update::ToolCallLocation;
    let registry = ProjectionRegistry::new();
    let mut tool_call =
        create_execute_tool_call("tool-sparse", "cat file.txt", ToolCallStatus::Pending);
    tool_call.locations = Some(vec![ToolCallLocation {
        path: "/some/file.txt".to_string(),
    }]);
    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCall {
            tool_call,
            session_id: Some("session-1".to_string()),
        },
    );
    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCallUpdate {
            update: ToolCallUpdateData {
                tool_call_id: "tool-sparse".to_string(),
                status: Some(ToolCallStatus::InProgress),
                ..ToolCallUpdateData::default()
            },
            session_id: Some("session-1".to_string()),
        },
    );
    let op = registry
        .operation_for_tool_call("session-1", "tool-sparse")
        .unwrap();
    assert!(
        op.locations.is_some(),
        "locations should be preserved from initial tool call"
    );
}

#[test]
fn completed_read_update_content_becomes_read_source_excerpt() {
    let registry = ProjectionRegistry::new();
    let read_tool_call = ToolCallData {
        id: "tool-read".to_string(),
        name: "Read".to_string(),
        arguments: ToolArguments::Read {
            file_path: Some("/repo/src/lib.rs".to_string()),
            source_context: None,
        },
        diagnostic_input: None,
        status: ToolCallStatus::Pending,
        result: None,
        kind: Some(ToolKind::Read),
        title: Some("Read /repo/src/lib.rs".to_string()),
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
    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCall {
            tool_call: read_tool_call,
            session_id: Some("session-1".to_string()),
        },
    );
    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCallUpdate {
            update: ToolCallUpdateData {
                tool_call_id: "tool-read".to_string(),
                status: Some(ToolCallStatus::Completed),
                content: Some(vec![ContentBlock::Text {
                    text: "pub fn answer() -> i32 {\n    42\n}".to_string(),
                }]),
                ..ToolCallUpdateData::default()
            },
            session_id: Some("session-1".to_string()),
        },
    );

    let op = registry
        .operation_for_tool_call("session-1", "tool-read")
        .unwrap();
    match &op.arguments {
        ToolArguments::Read { source_context, .. } => {
            let source_context = source_context
                .as_ref()
                .expect("completed read should expose source context");
            assert_eq!(
                source_context.excerpt.as_deref(),
                Some("pub fn answer() -> i32 {\n    42\n}")
            );
            assert_eq!(source_context.path.as_deref(), Some("/repo/src/lib.rs"));
        }
        other => panic!("expected read arguments, got {:?}", other),
    }
}

#[test]
fn completed_read_update_raw_output_content_becomes_read_source_excerpt() {
    let registry = ProjectionRegistry::new();
    let read_tool_call = ToolCallData {
        id: "tool-read".to_string(),
        name: "Read".to_string(),
        arguments: ToolArguments::Read {
            file_path: Some("/repo/src/lib.rs".to_string()),
            source_context: None,
        },
        diagnostic_input: None,
        status: ToolCallStatus::Pending,
        result: None,
        kind: Some(ToolKind::Read),
        title: Some("Read /repo/src/lib.rs".to_string()),
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
    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCall {
            tool_call: read_tool_call,
            session_id: Some("session-1".to_string()),
        },
    );
    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCallUpdate {
            update: ToolCallUpdateData {
                tool_call_id: "tool-read".to_string(),
                status: Some(ToolCallStatus::Completed),
                raw_output: Some(json!({
                    "content": "     1\tpub fn answer() -> i32 {\n     2\t    42\n     3\t}"
                })),
                ..ToolCallUpdateData::default()
            },
            session_id: Some("session-1".to_string()),
        },
    );

    let op = registry
        .operation_for_tool_call("session-1", "tool-read")
        .unwrap();
    match &op.arguments {
        ToolArguments::Read { source_context, .. } => {
            let source_context = source_context
                .as_ref()
                .expect("completed read should expose source context");
            assert_eq!(
                source_context.excerpt.as_deref(),
                Some("     1\tpub fn answer() -> i32 {\n     2\t    42\n     3\t}")
            );
            assert_eq!(source_context.path.as_deref(), Some("/repo/src/lib.rs"));
        }
        other => panic!("expected read arguments, got {:?}", other),
    }
}

#[test]
fn read_tool_call_with_local_path_gets_filesystem_source_excerpt() {
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let file_path = temp_dir.path().join("source.ts");
    std::fs::write(&file_path, "export const answer = 42;\n").expect("write source file");
    let registry = ProjectionRegistry::new();
    let read_tool_call = ToolCallData {
        id: "tool-read".to_string(),
        name: "Read".to_string(),
        arguments: ToolArguments::Read {
            file_path: Some(file_path.to_string_lossy().to_string()),
            source_context: None,
        },
        diagnostic_input: None,
        status: ToolCallStatus::Pending,
        result: None,
        kind: Some(ToolKind::Read),
        title: Some("Read source.ts".to_string()),
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

    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCall {
            tool_call: read_tool_call,
            session_id: Some("session-1".to_string()),
        },
    );

    let op = registry
        .operation_for_tool_call("session-1", "tool-read")
        .unwrap();
    match &op.arguments {
        ToolArguments::Read { source_context, .. } => {
            let source_context = source_context
                .as_ref()
                .expect("read should expose local source context");
            assert_eq!(
                source_context.excerpt.as_deref(),
                Some("export const answer = 42;\n")
            );
            assert_eq!(
                source_context.path.as_deref(),
                Some(file_path.to_string_lossy().as_ref())
            );
        }
        other => panic!("expected read arguments, got {:?}", other),
    }
}

#[test]
fn sparse_full_tool_replay_does_not_erase_richer_prior_evidence() {
    let registry = ProjectionRegistry::new();
    let mut rich_tool_call =
        create_execute_tool_call("tool-rich", "cat file.txt", ToolCallStatus::Completed);
    rich_tool_call.title = Some("Read full file".to_string());
    rich_tool_call.result = Some(json!("full file contents"));
    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCall {
            tool_call: rich_tool_call,
            session_id: Some("session-1".to_string()),
        },
    );

    let mut sparse_tool_call =
        create_execute_tool_call("tool-rich", "cat file.txt", ToolCallStatus::Completed);
    sparse_tool_call.title = None;
    sparse_tool_call.result = None;
    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCall {
            tool_call: sparse_tool_call,
            session_id: Some("session-1".to_string()),
        },
    );

    let op = registry
        .operation_for_tool_call("session-1", "tool-rich")
        .unwrap();
    assert_eq!(op.title.as_deref(), Some("Read full file"));
    assert_eq!(op.result, Some(json!("full file contents")));
    assert_eq!(registry.session_operations("session-1").len(), 1);
}

#[test]
fn conflicting_full_tool_replay_degrades_existing_operation_instead_of_duplicating() {
    let registry = ProjectionRegistry::new();
    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCall {
            tool_call: create_execute_tool_call(
                "tool-conflict",
                "cargo test",
                ToolCallStatus::Completed,
            ),
            session_id: Some("session-1".to_string()),
        },
    );

    let conflicting_tool_call = ToolCallData {
        id: "tool-conflict".to_string(),
        name: "Read".to_string(),
        arguments: ToolArguments::Read {
            file_path: Some("/repo/README.md".to_string()),
            source_context: None,
        },
        diagnostic_input: None,
        status: ToolCallStatus::Completed,
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
    };
    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCall {
            tool_call: conflicting_tool_call,
            session_id: Some("session-1".to_string()),
        },
    );

    let op = registry
        .operation_for_tool_call("session-1", "tool-conflict")
        .unwrap();
    assert_eq!(registry.session_operations("session-1").len(), 1);
    assert_eq!(op.operation_state, OperationState::Degraded);
    assert_eq!(
        op.degradation_reason.as_ref().map(|reason| &reason.code),
        Some(&OperationDegradationCode::ImpossibleTransition)
    );
}

#[test]
fn path_access_permission_placeholder_adopts_later_edit_tool_evidence() {
    let registry = ProjectionRegistry::new();
    let placeholder_tool_call = ToolCallData {
        id: "tool-edit".to_string(),
        name: "Read".to_string(),
        arguments: ToolArguments::Read {
            file_path: Some("/repo/src/dialog-frame.svelte".to_string()),
            source_context: None,
        },
        diagnostic_input: None,
        status: ToolCallStatus::InProgress,
        result: None,
        kind: Some(ToolKind::Read),
        title: Some("Access paths outside trusted directories".to_string()),
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
    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCall {
            tool_call: placeholder_tool_call,
            session_id: Some("session-1".to_string()),
        },
    );
    registry.apply_session_update(
        "session-1",
        &SessionUpdate::PermissionRequest {
            permission: PermissionData {
                id: "permission-edit".to_string(),
                session_id: "session-1".to_string(),
                json_rpc_request_id: Some(42),
                reply_handler: Some(InteractionReplyHandler::json_rpc(42)),
                permission: "Access paths outside trusted directories".to_string(),
                patterns: vec![],
                metadata: json!({
                    "parsedArguments": {
                        "kind": "read",
                        "file_path": "/repo/src/dialog-frame.svelte"
                    },
                    "options": []
                }),
                always: vec![],
                auto_accepted: false,
                tool: Some(ToolReference {
                    message_id: None,
                    call_id: "tool-edit".to_string(),
                }),
            },
            session_id: Some("session-1".to_string()),
        },
    );

    let edit_tool_call = ToolCallData {
        id: "tool-edit".to_string(),
        name: "Edit".to_string(),
        arguments: ToolArguments::Edit {
            edits: vec![EditEntry {
                file_path: Some("/repo/src/dialog-frame.svelte".to_string()),
                move_from: None,
                old_string: Some("topLeft?: Snippet;".to_string()),
                new_string: Some("topLeft?: Snippet;\ntopRight?: Snippet;".to_string()),
                content: None,
            }],
        },
        diagnostic_input: None,
        status: ToolCallStatus::InProgress,
        result: None,
        kind: Some(ToolKind::Edit),
        title: Some("dialog-frame.svelte".to_string()),
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
    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCall {
            tool_call: edit_tool_call,
            session_id: Some("session-1".to_string()),
        },
    );

    let operation = registry
        .operation_for_tool_call("session-1", "tool-edit")
        .expect("expected operation");
    assert_eq!(operation.kind, Some(ToolKind::Edit));
    assert_eq!(operation.operation_state, OperationState::Blocked);
    assert_eq!(operation.degradation_reason, None);
    assert!(matches!(operation.arguments, ToolArguments::Edit { .. }));
}

#[test]
fn unclassified_tool_kind_preserves_provider_lifecycle_state() {
    use crate::acp::session_update::ToolArguments;
    let registry = ProjectionRegistry::new();
    let tool_call = ToolCallData {
        id: "tool-unclassified".to_string(),
        name: "unknown_tool".to_string(),
        arguments: ToolArguments::Other {
            raw: serde_json::json!({}),
            intent: None,
        },
        diagnostic_input: None,
        status: ToolCallStatus::Pending,
        result: None,
        kind: Some(ToolKind::Unclassified),
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
    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCall {
            tool_call,
            session_id: Some("session-1".to_string()),
        },
    );
    let op = registry
        .operation_for_tool_call("session-1", "tool-unclassified")
        .unwrap();
    assert_eq!(op.operation_state, OperationState::Pending);
    assert!(op.degradation_reason.is_none());
}

#[test]
fn validate_provenance_key_rejects_invalid_input() {
    assert!(validate_provenance_key("valid-key-123").is_ok());
    assert!(validate_provenance_key("key\x00with-nul").is_err());
    assert!(validate_provenance_key("key\x1f-control").is_err());
    assert!(validate_provenance_key(&"x".repeat(513)).is_err());
    assert!(validate_provenance_key("").is_err());
}

#[test]
fn canonical_operation_id_includes_session_identity_without_delimiter_collision() {
    assert_eq!(
        build_canonical_operation_id("session-1", "tool-1"),
        "op:9:session-1:6:tool-1"
    );
    assert_ne!(
        build_canonical_operation_id("a:b", "c"),
        build_canonical_operation_id("a", "b:c")
    );
    assert!(build_validated_canonical_operation_id("session-1", "tool-1").is_ok());
    assert!(build_validated_canonical_operation_id("session-1", "bad\x00tool").is_err());
}

#[test]
fn invalid_provenance_key_uses_safe_degraded_operation_id() {
    let registry = ProjectionRegistry::new();
    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCall {
            tool_call: create_execute_tool_call("", "cargo test", ToolCallStatus::Pending),
            session_id: Some("session-1".to_string()),
        },
    );

    let operation = registry
        .operation_for_tool_call("session-1", "")
        .expect("invalid provider id should still be represented");
    assert_ne!(operation.id, build_canonical_operation_id("session-1", ""));
    assert!(validate_provenance_key(&operation.id).is_ok());
    assert_eq!(operation.operation_state, OperationState::Degraded);
    assert_eq!(
        operation
            .degradation_reason
            .as_ref()
            .map(|reason| reason.code.clone()),
        Some(OperationDegradationCode::InvalidProvenanceKey)
    );
    assert_eq!(
        operation.source_link,
        OperationSourceLink::TranscriptLinked {
            entry_id: "acepe::entry::session-start::tool::.".to_string(),
        }
    );
    assert_eq!(registry.session_operations("session-1").len(), 1);
}

#[test]
fn operation_ingress_normalizes_control_character_tool_ids() {
    let registry = ProjectionRegistry::new();
    let raw_id = "tool\ncursor";
    let normalized_id = "tool%0Acursor";

    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCall {
            tool_call: create_execute_tool_call(raw_id, "cargo test", ToolCallStatus::Completed),
            session_id: Some("session-1".to_string()),
        },
    );

    let operation = registry
        .operation_for_tool_call("session-1", raw_id)
        .expect("raw lookup should resolve through ingress normalization");
    assert_eq!(operation.tool_call_id, normalized_id);
    assert_eq!(
        operation.operation_provenance_key.as_deref(),
        Some(normalized_id)
    );
    assert_eq!(operation.operation_state, OperationState::Completed);
    assert!(operation.degradation_reason.is_none());
    assert!(!operation.id.contains('\n'));

    let normalized_lookup = registry
        .operation_for_tool_call("session-1", normalized_id)
        .expect("normalized lookup should resolve directly");
    assert_eq!(normalized_lookup.id, operation.id);
}

#[test]
fn operation_ingress_normalizes_control_character_update_ids() {
    let registry = ProjectionRegistry::new();
    let raw_id = "tool\ncursor";

    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCall {
            tool_call: create_execute_tool_call(raw_id, "cargo test", ToolCallStatus::Pending),
            session_id: Some("session-1".to_string()),
        },
    );
    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCallUpdate {
            update: ToolCallUpdateData {
                tool_call_id: raw_id.to_string(),
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
        },
    );

    let operation = registry
        .operation_for_tool_call("session-1", "tool%0Acursor")
        .expect("operation should exist");
    assert_eq!(operation.operation_state, OperationState::Completed);
    assert_eq!(operation.provider_status, ToolCallStatus::Completed);
    assert!(operation.degradation_reason.is_none());
}

#[test]
fn operation_ingress_normalizes_nested_task_relationship_ids() {
    let registry = ProjectionRegistry::new();
    let mut parent = ToolCallData {
        id: "task\nparent".to_string(),
        name: "task".to_string(),
        arguments: ToolArguments::Other {
            raw: json!({}),
            intent: None,
        },
        diagnostic_input: None,
        status: ToolCallStatus::Pending,
        result: None,
        kind: Some(ToolKind::Task),
        title: Some("Task".to_string()),
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
    let mut child =
        create_execute_tool_call("task\nchild", "go test ./...", ToolCallStatus::Pending);
    child.parent_tool_use_id = Some("task\nparent".to_string());
    parent.task_children = Some(vec![child]);

    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCall {
            tool_call: parent,
            session_id: Some("session-1".to_string()),
        },
    );

    let parent = registry
        .operation_for_tool_call("session-1", "task%0Aparent")
        .expect("expected parent operation");
    let child = registry
        .operation_for_tool_call("session-1", "task%0Achild")
        .expect("expected child operation");

    assert_eq!(parent.tool_call_id, "task%0Aparent");
    assert_eq!(parent.child_tool_call_ids, vec!["task%0Achild"]);
    assert_eq!(child.tool_call_id, "task%0Achild");
    assert_eq!(child.parent_tool_call_id.as_deref(), Some("task%0Aparent"));
    assert_eq!(
        child.parent_operation_id.as_deref(),
        Some(parent.id.as_str())
    );
    assert!(parent.degradation_reason.is_none());
    assert!(child.degradation_reason.is_none());
}

#[test]
fn thread_snapshot_ingress_normalizes_control_character_tool_ids() {
    let raw_id = "restored\ncursor";
    let thread_snapshot = SessionThreadSnapshot {
        entries: vec![StoredEntry::ToolCall {
            id: raw_id.to_string(),
            message: create_execute_tool_call(raw_id, "cargo test", ToolCallStatus::Completed),
            timestamp: Some("2026-04-30T00:00:00Z".to_string()),
        }],
        title: "Restored Cursor".to_string(),
        created_at: "2026-04-30T00:00:00Z".to_string(),
        current_mode_id: None,
    };

    let projection = ProjectionRegistry::project_thread_snapshot(
        "session-1",
        Some(CanonicalAgentId::Cursor),
        &thread_snapshot,
    );

    assert_eq!(projection.operations.len(), 1);
    let operation = &projection.operations[0];
    assert_eq!(operation.tool_call_id, "restored%0Acursor");
    assert_eq!(operation.operation_state, OperationState::Completed);
    assert!(operation.degradation_reason.is_none());
    assert_eq!(
        operation.operation_provenance_key.as_deref(),
        Some("restored%0Acursor")
    );
    assert_eq!(
        operation.source_link,
        OperationSourceLink::TranscriptLinked {
            entry_id: "acepe::entry::session-start::tool::restored%0Acursor".to_string(),
        }
    );
    assert_eq!(
        projection.session.as_ref().map(|session| {
            (
                session.active_tool_call_ids.clone(),
                session.completed_tool_call_ids.clone(),
            )
        }),
        Some((Vec::new(), vec!["restored%0Acursor".to_string()]))
    );
}

#[test]
fn max_session_operations_is_enforced_before_graph_insertion() {
    let registry = ProjectionRegistry::new();
    for index in 0..MAX_SESSION_OPERATIONS {
        let tool_call_id = format!("tool-{index}");
        registry.apply_session_update(
            "session-1",
            &SessionUpdate::ToolCall {
                tool_call: create_execute_tool_call(
                    &tool_call_id,
                    "cargo test",
                    ToolCallStatus::Pending,
                ),
                session_id: Some("session-1".to_string()),
            },
        );
    }

    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCall {
            tool_call: create_execute_tool_call(
                "tool-overflow",
                "cargo test",
                ToolCallStatus::Pending,
            ),
            session_id: Some("session-1".to_string()),
        },
    );

    assert_eq!(
        registry.session_operations("session-1").len(),
        MAX_SESSION_OPERATIONS
    );
    assert!(registry
        .operation_for_tool_call("session-1", "tool-overflow")
        .is_none());
}

#[test]
fn interaction_gets_canonical_operation_id_from_tool_reference() {
    let registry = ProjectionRegistry::new();
    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCall {
            tool_call: create_execute_tool_call("tool-1", "cargo test", ToolCallStatus::Pending),
            session_id: Some("session-1".to_string()),
        },
    );
    registry.apply_session_update(
        "session-1",
        &SessionUpdate::PermissionRequest {
            permission: PermissionData {
                id: "perm-1".to_string(),
                session_id: "session-1".to_string(),
                json_rpc_request_id: Some(42),
                reply_handler: Some(InteractionReplyHandler::json_rpc(42)),
                permission: "Execute".to_string(),
                patterns: vec![],
                metadata: json!({"command": "cargo test"}),
                always: vec![],
                auto_accepted: false,
                tool: Some(ToolReference {
                    message_id: None,
                    call_id: "tool-1".to_string(),
                }),
            },
            session_id: Some("session-1".to_string()),
        },
    );
    let interaction = registry.interaction("perm-1").unwrap();
    let expected_id = build_canonical_operation_id("session-1", "tool-1");
    assert_eq!(interaction.canonical_operation_id, Some(expected_id));
}

#[test]
fn exit_plan_permission_enriches_linked_operation_arguments_with_plan_payload() {
    let registry = ProjectionRegistry::new();
    let plan = "# Fix Plan Card\n\n- Render plan body\n- Show build action";
    let mut plan_tool_call = create_execute_tool_call(
        "exit-plan-tool",
        "exit plan mode",
        ToolCallStatus::InProgress,
    );
    plan_tool_call.name = "ExitPlanMode".to_string();
    plan_tool_call.kind = Some(ToolKind::ExitPlanMode);
    plan_tool_call.title = Some("Plan ready".to_string());
    plan_tool_call.arguments = ToolArguments::Other {
        raw: json!({}),
        intent: None,
    };
    plan_tool_call.diagnostic_input = Some(json!({}));

    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCall {
            tool_call: plan_tool_call,
            session_id: Some("session-1".to_string()),
        },
    );
    registry.apply_session_update(
        "session-1",
        &SessionUpdate::PermissionRequest {
            permission: PermissionData {
                id: "permission-exit-plan".to_string(),
                session_id: "session-1".to_string(),
                json_rpc_request_id: Some(42),
                reply_handler: Some(InteractionReplyHandler::json_rpc(42)),
                permission: "ExitPlanMode".to_string(),
                patterns: vec![],
                metadata: json!({
                    "diagnosticRawInput": {
                        "plan": "# Raw Plan\n\nThis should not be used.",
                        "planFilePath": "/repo/docs/plans/fix-plan-card.md"
                    },
                    "parsedArguments": {
                        "kind": "planMode",
                        "plan": plan,
                        "plan_file_path": "/repo/docs/plans/fix-plan-card.md",
                        "title": "Fix Plan Card"
                    },
                    "options": []
                }),
                always: vec![],
                auto_accepted: false,
                tool: Some(ToolReference {
                    message_id: None,
                    call_id: "exit-plan-tool".to_string(),
                }),
            },
            session_id: Some("session-1".to_string()),
        },
    );

    let operation = registry
        .operation_for_tool_call("session-1", "exit-plan-tool")
        .expect("expected exit-plan operation");

    assert_eq!(operation.operation_state, OperationState::Blocked);
    assert!(operation.awaiting_plan_approval);
    assert_eq!(operation.plan_approval_request_id, Some(42));
    assert_eq!(
        operation.arguments,
        ToolArguments::PlanMode {
            mode: None,
            plan: Some(plan.to_string()),
            plan_file_path: Some("/repo/docs/plans/fix-plan-card.md".to_string()),
            title: Some("Fix Plan Card".to_string())
        }
    );
}

#[test]
fn exit_plan_permission_does_not_enrich_operation_from_diagnostic_raw_input() {
    let registry = ProjectionRegistry::new();
    let mut plan_tool_call = create_execute_tool_call(
        "exit-plan-tool",
        "exit plan mode",
        ToolCallStatus::InProgress,
    );
    plan_tool_call.name = "ExitPlanMode".to_string();
    plan_tool_call.kind = Some(ToolKind::ExitPlanMode);
    plan_tool_call.title = Some("Plan ready".to_string());
    plan_tool_call.arguments = ToolArguments::Other {
        raw: json!({}),
        intent: None,
    };
    plan_tool_call.diagnostic_input = Some(json!({}));

    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCall {
            tool_call: plan_tool_call,
            session_id: Some("session-1".to_string()),
        },
    );
    registry.apply_session_update(
        "session-1",
        &SessionUpdate::PermissionRequest {
            permission: PermissionData {
                id: "permission-exit-plan".to_string(),
                session_id: "session-1".to_string(),
                json_rpc_request_id: Some(42),
                reply_handler: Some(InteractionReplyHandler::json_rpc(42)),
                permission: "ExitPlanMode".to_string(),
                patterns: vec![],
                metadata: json!({
                    "diagnosticRawInput": {
                        "plan": "# Raw Plan\n\nThis must stay diagnostic.",
                        "planFilePath": "/repo/docs/plans/raw-plan.md"
                    },
                    "options": []
                }),
                always: vec![],
                auto_accepted: false,
                tool: Some(ToolReference {
                    message_id: None,
                    call_id: "exit-plan-tool".to_string(),
                }),
            },
            session_id: Some("session-1".to_string()),
        },
    );

    let operation = registry
        .operation_for_tool_call("session-1", "exit-plan-tool")
        .expect("expected exit-plan operation");

    assert_eq!(operation.operation_state, OperationState::Blocked);
    assert!(!operation.awaiting_plan_approval);
    assert_eq!(operation.plan_approval_request_id, None);
    assert_eq!(
        operation.arguments,
        ToolArguments::Other {
            raw: json!({}),
            intent: None
        }
    );
}

#[test]
fn terminal_operation_state_set_excludes_resumable_blocked_state() {
    assert!(!is_terminal_operation_state(&OperationState::Pending));
    assert!(!is_terminal_operation_state(&OperationState::Running));
    assert!(!is_terminal_operation_state(&OperationState::Blocked));
    assert!(is_terminal_operation_state(&OperationState::Completed));
    assert!(is_terminal_operation_state(&OperationState::Failed));
    assert!(is_terminal_operation_state(&OperationState::Cancelled));
    assert!(is_terminal_operation_state(&OperationState::Degraded));
}

#[test]
fn pending_permission_blocks_linked_operation_and_approval_resumes_it() {
    let registry = ProjectionRegistry::new();
    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCall {
            tool_call: create_execute_tool_call("tool-1", "cargo test", ToolCallStatus::InProgress),
            session_id: Some("session-1".to_string()),
        },
    );

    let running = registry
        .operation_for_tool_call("session-1", "tool-1")
        .expect("expected running operation");
    assert_eq!(running.operation_state, OperationState::Running);

    registry.apply_session_update(
        "session-1",
        &SessionUpdate::PermissionRequest {
            permission: PermissionData {
                id: "permission-1".to_string(),
                session_id: "session-1".to_string(),
                json_rpc_request_id: Some(42),
                reply_handler: Some(InteractionReplyHandler::json_rpc(42)),
                permission: "Execute".to_string(),
                patterns: vec![],
                metadata: json!({"command": "cargo test"}),
                always: vec![],
                auto_accepted: false,
                tool: Some(ToolReference {
                    message_id: None,
                    call_id: "tool-1".to_string(),
                }),
            },
            session_id: Some("session-1".to_string()),
        },
    );

    let blocked = registry
        .operation_for_tool_call("session-1", "tool-1")
        .expect("expected blocked operation");
    assert_eq!(blocked.operation_state, OperationState::Blocked);

    registry
        .resolve_interaction(
            "session-1",
            "permission-1",
            InteractionState::Approved,
            InteractionResponse::Permission {
                accepted: true,
                option_id: Some("allow_once".to_string()),
                reply: Some("once".to_string()),
            },
        )
        .expect("expected permission resolution");

    let resumed = registry
        .operation_for_tool_call("session-1", "tool-1")
        .expect("expected resumed operation");
    assert_eq!(resumed.operation_state, OperationState::Running);
}

#[test]
fn computer_permission_interaction_blocks_linked_operation_and_approval_resumes_it() {
    let registry = ProjectionRegistry::new();
    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCall {
            tool_call: create_computer_tool_call("computer-tool", ToolCallStatus::InProgress),
            session_id: Some("session-1".to_string()),
        },
    );

    let interaction_id = build_computer_permission_interaction_id(
        "session-1",
        "computer-tool",
        ComputerPermissionKind::Accessibility,
    );
    registry.register_computer_permission_interaction(ComputerPermissionData {
        id: interaction_id.clone(),
        session_id: "session-1".to_string(),
        permission_kind: ComputerPermissionKind::Accessibility,
        reason: "Acepe needs Accessibility permission to click UI controls.".to_string(),
        app: None,
        window: None,
        tool: Some(ToolReference {
            message_id: None,
            call_id: "computer-tool".to_string(),
        }),
    });

    let projection = registry.session_projection("session-1");
    let interaction = projection
        .interactions
        .iter()
        .find(|interaction| interaction.id == interaction_id)
        .expect("expected computer permission interaction");
    assert_eq!(interaction.kind, InteractionKind::ComputerPermission);
    assert_eq!(interaction.state, InteractionState::Pending);
    assert_eq!(interaction.json_rpc_request_id, None);
    assert_eq!(interaction.reply_handler, None);
    assert_eq!(
        interaction.canonical_operation_id,
        Some(build_canonical_operation_id("session-1", "computer-tool"))
    );

    let blocked = registry
        .operation_for_tool_call("session-1", "computer-tool")
        .expect("expected blocked operation");
    assert_eq!(blocked.operation_state, OperationState::Blocked);

    registry
        .resolve_interaction(
            "session-1",
            &interaction_id,
            InteractionState::Approved,
            InteractionResponse::ComputerPermission { accepted: true },
        )
        .expect("expected computer permission resolution");

    let resumed = registry
        .operation_for_tool_call("session-1", "computer-tool")
        .expect("expected resumed operation");
    assert_eq!(resumed.operation_state, OperationState::Running);
}

#[test]
fn restored_pending_computer_permission_reblocks_and_resumes_linked_operation() {
    let source = ProjectionRegistry::new();
    source.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCall {
            tool_call: create_computer_tool_call("computer-tool", ToolCallStatus::InProgress),
            session_id: Some("session-1".to_string()),
        },
    );

    let interaction_id = build_computer_permission_interaction_id(
        "session-1",
        "computer-tool",
        ComputerPermissionKind::Accessibility,
    );
    source.register_computer_permission_interaction(ComputerPermissionData {
        id: interaction_id.clone(),
        session_id: "session-1".to_string(),
        permission_kind: ComputerPermissionKind::Accessibility,
        reason: "Acepe needs Accessibility permission to click UI controls.".to_string(),
        app: None,
        window: None,
        tool: Some(ToolReference {
            message_id: None,
            call_id: "computer-tool".to_string(),
        }),
    });

    let mut projection = source.session_projection("session-1");
    projection
        .operations
        .get_mut(0)
        .expect("expected restored operation seed")
        .operation_state = OperationState::Running;

    let restored = ProjectionRegistry::new();
    restored.restore_session_projection(projection);

    let blocked = restored
        .operation_for_tool_call("session-1", "computer-tool")
        .expect("expected restored computer operation");
    assert_eq!(blocked.operation_state, OperationState::Blocked);

    restored
        .resolve_interaction(
            "session-1",
            &interaction_id,
            InteractionState::Approved,
            InteractionResponse::ComputerPermission { accepted: true },
        )
        .expect("expected restored computer permission resolution");

    let resumed = restored
        .operation_for_tool_call("session-1", "computer-tool")
        .expect("expected restored resumed operation");
    assert_eq!(resumed.operation_state, OperationState::Running);
}

#[test]
fn computer_permission_interaction_denial_cancels_linked_operation() {
    let registry = ProjectionRegistry::new();
    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCall {
            tool_call: create_computer_tool_call("computer-tool", ToolCallStatus::InProgress),
            session_id: Some("session-1".to_string()),
        },
    );

    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCallUpdate {
            update: ToolCallUpdateData {
                tool_call_id: "computer-tool".to_string(),
                status: Some(ToolCallStatus::Failed),
                result: Some(json!({
                    "ok": false,
                    "error": {
                        "code": "computer_permission_required",
                        "message": "Acepe needs Screen Recording permission to capture the window.",
                        "permission_kind": "screen_recording"
                    }
                })),
                ..ToolCallUpdateData::default()
            },
            session_id: Some("session-1".to_string()),
        },
    );

    let interaction_id = build_computer_permission_interaction_id(
        "session-1",
        "computer-tool",
        ComputerPermissionKind::ScreenRecording,
    );
    let blocked = registry
        .operation_for_tool_call("session-1", "computer-tool")
        .expect("expected blocked operation");
    assert_eq!(blocked.operation_state, OperationState::Blocked);
    assert!(blocked.computer_payload.is_some());

    registry
        .resolve_interaction(
            "session-1",
            &interaction_id,
            InteractionState::Rejected,
            InteractionResponse::ComputerPermission { accepted: false },
        )
        .expect("expected computer permission rejection");

    let cancelled = registry
        .operation_for_tool_call("session-1", "computer-tool")
        .expect("expected cancelled operation");
    assert_eq!(cancelled.operation_state, OperationState::Cancelled);
    assert!(cancelled.computer_payload.is_some());
}

#[test]
fn computer_permission_error_update_materializes_local_interaction() {
    let registry = ProjectionRegistry::new();
    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCall {
            tool_call: create_computer_tool_call("computer-tool", ToolCallStatus::InProgress),
            session_id: Some("session-1".to_string()),
        },
    );

    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCallUpdate {
            update: ToolCallUpdateData {
                tool_call_id: "computer-tool".to_string(),
                status: Some(ToolCallStatus::Failed),
                result: Some(json!({
                    "ok": false,
                    "error": {
                        "code": "computer_permission_required",
                        "message": "Acepe needs Accessibility permission to click UI controls.",
                        "permission_kind": "accessibility"
                    }
                })),
                ..ToolCallUpdateData::default()
            },
            session_id: Some("session-1".to_string()),
        },
    );

    let operation = registry
        .operation_for_tool_call("session-1", "computer-tool")
        .expect("expected computer operation");
    assert_eq!(operation.operation_state, OperationState::Blocked);

    let interaction_id = build_computer_permission_interaction_id(
        "session-1",
        "computer-tool",
        ComputerPermissionKind::Accessibility,
    );
    let interaction = registry
        .interaction(&interaction_id)
        .expect("expected computer permission interaction");
    assert_eq!(interaction.kind, InteractionKind::ComputerPermission);
    assert_eq!(interaction.state, InteractionState::Pending);
    assert_eq!(
        interaction.canonical_operation_id,
        Some(build_canonical_operation_id("session-1", "computer-tool"))
    );
    match interaction.payload {
        InteractionPayload::ComputerPermission(payload) => {
            assert_eq!(
                payload.reason,
                "Acepe needs Accessibility permission to click UI controls."
            );
            assert_eq!(
                payload.permission_kind,
                ComputerPermissionKind::Accessibility
            );
        }
        other => panic!("expected computer permission payload, got {other:?}"),
    }
}

#[test]
fn computer_app_window_scope_error_materializes_scoped_interaction() {
    let registry = ProjectionRegistry::new();
    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCall {
            tool_call: create_computer_tool_call("computer-tool", ToolCallStatus::InProgress),
            session_id: Some("session-1".to_string()),
        },
    );

    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCallUpdate {
            update: ToolCallUpdateData {
                tool_call_id: "computer-tool".to_string(),
                status: Some(ToolCallStatus::Failed),
                result: Some(json!({
                    "err": {
                        "c": "computer_permission_required",
                        "m": "Allow computer use for Safari / GitHub?",
                        "pk": "app_window_scope",
                        "a": "Safari",
                        "w": "GitHub"
                    }
                })),
                ..ToolCallUpdateData::default()
            },
            session_id: Some("session-1".to_string()),
        },
    );

    let operation = registry
        .operation_for_tool_call("session-1", "computer-tool")
        .expect("expected computer operation");
    assert_eq!(operation.operation_state, OperationState::Blocked);
    let error = operation
        .computer_payload
        .and_then(|payload| payload.error)
        .expect("expected computer operation error");
    assert_eq!(
        error.permission_kind,
        Some(ComputerPermissionKind::AppWindowScope)
    );
    assert_eq!(error.app.as_deref(), Some("Safari"));
    assert_eq!(error.window.as_deref(), Some("GitHub"));

    let interaction_id = build_computer_permission_interaction_id(
        "session-1",
        "computer-tool",
        ComputerPermissionKind::AppWindowScope,
    );
    let interaction = registry
        .interaction(&interaction_id)
        .expect("expected scoped computer permission interaction");
    assert_eq!(interaction.kind, InteractionKind::ComputerPermission);
    assert_eq!(interaction.state, InteractionState::Pending);
    assert_eq!(
        interaction.canonical_operation_id,
        Some(build_canonical_operation_id("session-1", "computer-tool"))
    );
    match interaction.payload {
        InteractionPayload::ComputerPermission(payload) => {
            assert_eq!(
                payload.permission_kind,
                ComputerPermissionKind::AppWindowScope
            );
            assert_eq!(payload.reason, "Allow computer use for Safari / GitHub?");
            assert_eq!(payload.app.as_deref(), Some("Safari"));
            assert_eq!(payload.window.as_deref(), Some("GitHub"));
        }
        other => panic!("expected computer permission payload, got {other:?}"),
    }
}

#[test]
fn computer_scope_changed_error_requires_reobserve_without_permission_interaction() {
    let registry = ProjectionRegistry::new();
    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCall {
            tool_call: create_computer_tool_call("computer-tool", ToolCallStatus::InProgress),
            session_id: Some("session-1".to_string()),
        },
    );

    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCallUpdate {
            update: ToolCallUpdateData {
                tool_call_id: "computer-tool".to_string(),
                status: Some(ToolCallStatus::Failed),
                result: Some(json!({
                    "err": {
                        "c": "computer_scope_changed",
                        "m": "Focused app or window changed after observation; observe again before acting.",
                        "a": "Safari",
                        "w": "GitHub",
                        "r": true
                    }
                })),
                ..ToolCallUpdateData::default()
            },
            session_id: Some("session-1".to_string()),
        },
    );

    let operation = registry
        .operation_for_tool_call("session-1", "computer-tool")
        .expect("expected computer operation");
    assert_eq!(operation.operation_state, OperationState::Failed);
    let error = operation
        .computer_payload
        .and_then(|payload| payload.error)
        .expect("expected computer operation error");
    assert_eq!(error.code, "computer_scope_changed");
    assert_eq!(error.permission_kind, None);
    assert_eq!(error.app.as_deref(), Some("Safari"));
    assert_eq!(error.window.as_deref(), Some("GitHub"));
    assert_eq!(error.reobserve, Some(true));

    let interaction_id = build_computer_permission_interaction_id(
        "session-1",
        "computer-tool",
        ComputerPermissionKind::AppWindowScope,
    );
    assert!(registry.interaction(&interaction_id).is_none());
}

#[test]
fn computer_operation_payload_summarizes_input_and_result() {
    let registry = ProjectionRegistry::new();
    let mut tool_call = create_computer_tool_call("computer-tool", ToolCallStatus::InProgress);
    tool_call.arguments = ToolArguments::Computer {
        verb: Some("scroll".to_string()),
        target_id: Some("e_target".to_string()),
        epoch: Some("s_1".to_string()),
        text: None,
        key: None,
        delta_x: Some(0),
        delta_y: Some(-240),
        include_bounds: Some(false),
        include_screenshot: Some(false),
    };
    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCall {
            tool_call,
            session_id: Some("session-1".to_string()),
        },
    );

    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCallUpdate {
            update: ToolCallUpdateData {
                tool_call_id: "computer-tool".to_string(),
                status: Some(ToolCallStatus::Completed),
                result: Some(json!({
                    "e": "s_2",
                    "ms": 128,
                    "env": {
                        "a": "Acepe",
                        "w": "Main",
                        "f": "e_target",
                        "b": false
                    },
                    "els": [],
                    "c": ["e_target"],
                    "sr": "file:///tmp/acepe-computer.png"
                })),
                ..ToolCallUpdateData::default()
            },
            session_id: Some("session-1".to_string()),
        },
    );

    let operation = registry
        .operation_for_tool_call("session-1", "computer-tool")
        .expect("expected computer operation");
    let payload = operation
        .computer_payload
        .expect("expected computer payload");

    assert_eq!(payload.input.verb.as_deref(), Some("scroll"));
    assert_eq!(payload.input.delta_y, Some(-240));
    let output = payload.output.expect("expected computer output");
    assert_eq!(output.epoch.as_deref(), Some("s_2"));
    assert_eq!(output.settled_ms, Some(128));
    assert_eq!(output.app.as_deref(), Some("Acepe"));
    assert_eq!(output.window.as_deref(), Some("Main"));
    assert_eq!(output.focused_target_id.as_deref(), Some("e_target"));
    assert_eq!(output.busy, Some(false));
    assert_eq!(output.changed_target_ids, vec!["e_target".to_string()]);
    assert_eq!(output.element_count, Some(0));
    assert_eq!(
        output.screenshot_ref.as_deref(),
        Some("file:///tmp/acepe-computer.png")
    );
}

#[test]
fn pending_question_blocks_linked_operation_and_answer_resumes_it() {
    let registry = ProjectionRegistry::new();
    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCall {
            tool_call: create_execute_tool_call(
                "question-tool",
                "ask user",
                ToolCallStatus::InProgress,
            ),
            session_id: Some("session-1".to_string()),
        },
    );
    registry.apply_session_update(
        "session-1",
        &SessionUpdate::QuestionRequest {
            question: QuestionData {
                id: "question-1".to_string(),
                session_id: "session-1".to_string(),
                json_rpc_request_id: Some(43),
                reply_handler: Some(InteractionReplyHandler::json_rpc(43)),
                questions: vec![QuestionItem {
                    question: "Proceed?".to_string(),
                    header: "Approval".to_string(),
                    options: vec![],
                    multi_select: false,
                }],
                tool: Some(ToolReference {
                    message_id: None,
                    call_id: "question-tool".to_string(),
                }),
            },
            session_id: Some("session-1".to_string()),
        },
    );

    let blocked = registry
        .operation_for_tool_call("session-1", "question-tool")
        .expect("expected blocked operation");
    assert_eq!(blocked.operation_state, OperationState::Blocked);

    registry
        .resolve_interaction(
            "session-1",
            "question-1",
            InteractionState::Answered,
            InteractionResponse::Question {
                answers: json!({ "Proceed?": ["Yes"] }),
            },
        )
        .expect("expected question resolution");

    let resumed = registry
        .operation_for_tool_call("session-1", "question-tool")
        .expect("expected resumed operation");
    assert_eq!(resumed.operation_state, OperationState::Running);
}

#[test]
fn plan_approval_blocks_linked_operation_and_approval_resumes_it() {
    let registry = ProjectionRegistry::new();
    let mut plan_tool_call =
        create_execute_tool_call("plan-tool", "write plan", ToolCallStatus::InProgress);
    plan_tool_call.kind = Some(ToolKind::CreatePlan);
    plan_tool_call.awaiting_plan_approval = true;
    plan_tool_call.plan_approval_request_id = Some(44);
    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCall {
            tool_call: plan_tool_call,
            session_id: Some("session-1".to_string()),
        },
    );

    let blocked = registry
        .operation_for_tool_call("session-1", "plan-tool")
        .expect("expected blocked operation");
    assert_eq!(blocked.operation_state, OperationState::Blocked);

    let plan_id = build_plan_approval_interaction_id("session-1", "plan-tool", 44);
    registry
        .resolve_interaction(
            "session-1",
            &plan_id,
            InteractionState::Approved,
            InteractionResponse::PlanApproval { approved: true },
        )
        .expect("expected plan approval resolution");

    let resumed = registry
        .operation_for_tool_call("session-1", "plan-tool")
        .expect("expected resumed operation");
    assert_eq!(resumed.operation_state, OperationState::Running);
}

#[test]
fn unlinked_interaction_does_not_invent_blocked_operation() {
    let registry = ProjectionRegistry::new();
    registry.apply_session_update(
        "session-1",
        &SessionUpdate::PermissionRequest {
            permission: PermissionData {
                id: "permission-unlinked".to_string(),
                session_id: "session-1".to_string(),
                json_rpc_request_id: Some(45),
                reply_handler: Some(InteractionReplyHandler::json_rpc(45)),
                permission: "Execute".to_string(),
                patterns: vec![],
                metadata: json!({}),
                always: vec![],
                auto_accepted: false,
                tool: None,
            },
            session_id: Some("session-1".to_string()),
        },
    );

    let projection = registry.session_projection("session-1");
    assert!(projection.operations.is_empty());
    assert_eq!(projection.interactions.len(), 1);
    assert_eq!(projection.interactions[0].state, InteractionState::Pending);
}

#[test]
fn pending_interaction_blocks_operation_when_operation_materializes_later() {
    let registry = ProjectionRegistry::new();
    registry.apply_session_update(
        "session-1",
        &SessionUpdate::PermissionRequest {
            permission: PermissionData {
                id: "permission-late".to_string(),
                session_id: "session-1".to_string(),
                json_rpc_request_id: Some(46),
                reply_handler: Some(InteractionReplyHandler::json_rpc(46)),
                permission: "Execute".to_string(),
                patterns: vec![],
                metadata: json!({}),
                always: vec![],
                auto_accepted: false,
                tool: Some(ToolReference {
                    message_id: None,
                    call_id: "late-tool".to_string(),
                }),
            },
            session_id: Some("session-1".to_string()),
        },
    );

    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCall {
            tool_call: create_execute_tool_call(
                "late-tool",
                "cargo test",
                ToolCallStatus::InProgress,
            ),
            session_id: Some("session-1".to_string()),
        },
    );

    let blocked = registry
        .operation_for_tool_call("session-1", "late-tool")
        .expect("expected late materialized operation");
    assert_eq!(blocked.operation_state, OperationState::Blocked);
}

#[test]
fn terminal_operation_not_regressed_by_stale_update() {
    let registry = ProjectionRegistry::new();
    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCall {
            tool_call: create_execute_tool_call("tool-terminal", "rm -rf", ToolCallStatus::Pending),
            session_id: Some("session-1".to_string()),
        },
    );
    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCallUpdate {
            update: ToolCallUpdateData {
                tool_call_id: "tool-terminal".to_string(),
                status: Some(ToolCallStatus::Completed),
                ..ToolCallUpdateData::default()
            },
            session_id: Some("session-1".to_string()),
        },
    );
    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCallUpdate {
            update: ToolCallUpdateData {
                tool_call_id: "tool-terminal".to_string(),
                status: Some(ToolCallStatus::InProgress),
                ..ToolCallUpdateData::default()
            },
            session_id: Some("session-1".to_string()),
        },
    );
    let op = registry
        .operation_for_tool_call("session-1", "tool-terminal")
        .unwrap();
    assert_eq!(
        op.operation_state,
        OperationState::Completed,
        "terminal state must not regress"
    );
}

#[test]
fn terminal_operation_not_regressed_by_stale_full_tool_call() {
    let registry = ProjectionRegistry::new();
    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCall {
            tool_call: create_execute_tool_call(
                "tool-terminal",
                "cargo test",
                ToolCallStatus::Completed,
            ),
            session_id: Some("session-1".to_string()),
        },
    );
    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCall {
            tool_call: create_execute_tool_call(
                "tool-terminal",
                "cargo test",
                ToolCallStatus::Pending,
            ),
            session_id: Some("session-1".to_string()),
        },
    );

    let op = registry
        .operation_for_tool_call("session-1", "tool-terminal")
        .unwrap();
    assert_eq!(
        op.operation_state,
        OperationState::Completed,
        "terminal state must not regress from a stale full tool-call projection"
    );
}

#[test]
fn live_tool_call_patch_preserves_restored_transcript_source_link() {
    let registry = ProjectionRegistry::new();
    let operation_id = build_canonical_operation_id("session-1", "tool-restored");
    registry.restore_session_projection(SessionProjectionSnapshot {
        session: Some(SessionSnapshot::new(
            "session-1".to_string(),
            Some(CanonicalAgentId::ClaudeCode),
        )),
        operations: vec![OperationSnapshot {
            id: operation_id,
            session_id: "session-1".to_string(),
            tool_call_id: "tool-restored".to_string(),
            name: "bash".to_string(),
            kind: Some(ToolKind::Execute),
            provider_status: ToolCallStatus::Completed,
            title: Some("Run command".to_string()),
            arguments: ToolArguments::Execute {
                command: Some("pwd".to_string()),
            },
            progressive_arguments: None,
            result: Some(json!("done")),
            computer_payload: None,
            command: Some("pwd".to_string()),
            normalized_todos: None,
            parent_tool_call_id: None,
            parent_operation_id: None,
            child_tool_call_ids: vec![],
            child_operation_ids: vec![],
            operation_provenance_key: Some("tool-restored".to_string()),
            operation_state: OperationState::Completed,
            locations: None,
            skill_meta: None,
            normalized_questions: None,
            question_answer: None,
            awaiting_plan_approval: false,
            plan_approval_request_id: None,
            started_at_ms: None,
            completed_at_ms: None,
            source_link: OperationSourceLink::TranscriptLinked {
                entry_id: "transcript-tool-entry".to_string(),
            },
            degradation_reason: None,
        }],
        interactions: vec![],
        runtime: None,
    });

    registry.apply_session_update(
        "session-1",
        &SessionUpdate::ToolCall {
            tool_call: create_execute_tool_call("tool-restored", "pwd", ToolCallStatus::Completed),
            session_id: Some("session-1".to_string()),
        },
    );

    let operation = registry
        .operation_for_tool_call("session-1", "tool-restored")
        .expect("expected restored operation");
    assert_eq!(
        operation.source_link,
        OperationSourceLink::TranscriptLinked {
            entry_id: "transcript-tool-entry".to_string()
        }
    );
}
