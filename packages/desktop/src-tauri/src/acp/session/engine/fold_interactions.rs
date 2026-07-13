//! Interaction fold — plan approval and question facts from tool calls.

use crate::acp::projections::helpers::{
    build_plan_approval_interaction_id, is_terminal_operation_state,
};
use crate::acp::projections::{
    build_canonical_operation_id, ComputerPermissionData, InteractionKind, InteractionPayload,
    InteractionSnapshot, InteractionState, OperationState, PlanApprovalSource,
};
use crate::acp::session_state_engine::graph::SessionStateGraph;
use crate::acp::session_update::{
    InteractionReplyHandler, QuestionData, ToolCallData, ToolKind, ToolReference,
};
use serde_json::Value;

pub fn register_plan_approval_interaction(graph: &mut SessionStateGraph, tool_call: &ToolCallData) {
    if !tool_call.awaiting_plan_approval {
        return;
    }
    let Some(plan_approval_request_id) = tool_call.plan_approval_request_id else {
        return;
    };

    let session_id = graph.canonical_session_id.clone();
    let interaction_id =
        build_plan_approval_interaction_id(&session_id, &tool_call.id, plan_approval_request_id);
    let source = if tool_call.kind == Some(ToolKind::ExitPlanMode) {
        PlanApprovalSource::ExitPlanMode
    } else {
        PlanApprovalSource::CreatePlan
    };

    upsert_interaction(
        graph,
        InteractionSnapshot {
            id: interaction_id,
            session_id,
            kind: InteractionKind::PlanApproval,
            state: InteractionState::Pending,
            json_rpc_request_id: Some(plan_approval_request_id),
            reply_handler: Some(InteractionReplyHandler::json_rpc(plan_approval_request_id)),
            tool_reference: Some(ToolReference {
                message_id: None,
                call_id: tool_call.id.clone(),
            }),
            responded_at_event_seq: None,
            response: None,
            payload: InteractionPayload::PlanApproval { source },
            canonical_operation_id: Some(build_canonical_operation_id(
                &graph.canonical_session_id,
                &tool_call.id,
            )),
        },
    );
}

pub fn register_question_interaction(
    graph: &mut SessionStateGraph,
    tool_call: &ToolCallData,
    event_seq: i64,
) {
    let question_items = if let Some(normalized_questions) = tool_call.normalized_questions.clone()
    {
        normalized_questions
    } else if let Some(question_answer) = tool_call.question_answer.clone() {
        question_answer.questions
    } else {
        return;
    };

    let session_id = graph.canonical_session_id.clone();
    let question = QuestionData {
        id: tool_call.id.clone(),
        session_id: session_id.clone(),
        json_rpc_request_id: None,
        reply_handler: Some(InteractionReplyHandler::http(tool_call.id.clone())),
        questions: question_items,
        tool: Some(ToolReference {
            message_id: None,
            call_id: tool_call.id.clone(),
        }),
    };

    let (state, responded_at_event_seq, response) =
        if let Some(question_answer) = tool_call.question_answer.as_ref() {
            let answers = serde_json::to_value(&question_answer.answers).unwrap_or(Value::Null);
            (
                InteractionState::Answered,
                Some(event_seq),
                Some(crate::acp::projections::InteractionResponse::Question { answers }),
            )
        } else {
            (InteractionState::Pending, None, None)
        };

    upsert_interaction(
        graph,
        InteractionSnapshot {
            id: question.id.clone(),
            session_id,
            kind: InteractionKind::Question,
            state,
            json_rpc_request_id: None,
            reply_handler: question.reply_handler.clone(),
            tool_reference: question.tool.clone(),
            responded_at_event_seq,
            response,
            payload: InteractionPayload::Question(question),
            canonical_operation_id: Some(build_canonical_operation_id(
                &graph.canonical_session_id,
                &tool_call.id,
            )),
        },
    );
}

pub fn register_computer_permission_interaction(
    graph: &mut SessionStateGraph,
    permission: &ComputerPermissionData,
) {
    if graph.interactions.iter().any(|interaction| {
        interaction.id == permission.id && interaction.state != InteractionState::Pending
    }) {
        return;
    }

    let canonical_operation_id = permission
        .tool
        .as_ref()
        .map(|tool| build_canonical_operation_id(&permission.session_id, &tool.call_id));
    if let Some(operation_id) = canonical_operation_id.as_deref() {
        if let Some(operation) = graph
            .operations
            .iter_mut()
            .find(|operation| operation.id == operation_id)
        {
            if !is_terminal_operation_state(&operation.operation_state) {
                operation.operation_state = OperationState::Blocked;
            }
        }
    }
    upsert_interaction(
        graph,
        InteractionSnapshot {
            id: permission.id.clone(),
            session_id: permission.session_id.clone(),
            kind: InteractionKind::ComputerPermission,
            state: InteractionState::Pending,
            json_rpc_request_id: None,
            reply_handler: None,
            tool_reference: permission.tool.clone(),
            responded_at_event_seq: None,
            response: None,
            payload: InteractionPayload::ComputerPermission(permission.clone()),
            canonical_operation_id,
        },
    );
}

fn upsert_interaction(graph: &mut SessionStateGraph, interaction: InteractionSnapshot) {
    if let Some(index) = graph
        .interactions
        .iter()
        .position(|existing| existing.id == interaction.id)
    {
        graph.interactions[index] = interaction;
    } else {
        graph.interactions.push(interaction);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::session::engine::fold::{fold_full, FoldContext};
    use crate::acp::session::ingress::event::{ProviderEvent, ProviderEventKind};
    use crate::acp::session_update::{ToolArguments, ToolCallStatus};
    use crate::acp::types::CanonicalAgentId;

    #[test]
    fn fold_full_registers_plan_approval_interaction_for_awaiting_tool_call() {
        let ctx = FoldContext::new("sess-1", CanonicalAgentId::Copilot, "/tmp");
        let events = vec![ProviderEvent {
            source: CanonicalAgentId::Copilot,
            provider_seq: 1,
            provider_row_id: "plan-1".to_string(),
            timestamp_ms: None,
            kind: ProviderEventKind::ToolCall(ToolCallData {
                id: "plan-1".to_string(),
                name: "create_plan".to_string(),
                arguments: ToolArguments::Other {
                    raw: serde_json::json!({}),
                    intent: None,
                },
                diagnostic_input: None,
                status: ToolCallStatus::Pending,
                result: None,
                kind: Some(ToolKind::CreatePlan),
                title: Some("Create plan".to_string()),
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
            }),
        }];

        let graph = fold_full(&events, &ctx);
        assert_eq!(graph.interactions.len(), 1);
        assert_eq!(graph.interactions[0].kind, InteractionKind::PlanApproval);
        assert_eq!(graph.interactions[0].state, InteractionState::Unresolved);
        assert_eq!(
            graph.operations[0].operation_state,
            crate::acp::projections::OperationState::Cancelled
        );
    }
}
