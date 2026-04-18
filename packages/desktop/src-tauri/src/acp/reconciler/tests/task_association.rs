//! Task reconciler consumes projected `ToolCallData` (Unit 4 target: associate on semantic records first).

use crate::acp::session_update::{ToolArguments, ToolCallData, ToolCallStatus, ToolKind};
use crate::acp::task_reconciler::{ReconcilerOutput, TaskReconciler, TaskReconciliationPolicy};

fn read_child(id: &str, parent: &str) -> ToolCallData {
    ToolCallData {
        id: id.to_string(),
        name: "Read".to_string(),
        arguments: ToolArguments::Read {
            file_path: Some("/x.rs".to_string()),
            source_context: None,
        },
        raw_input: None,
        status: ToolCallStatus::Pending,
        result: None,
        kind: Some(ToolKind::Read),
        title: None,
        locations: None,
        skill_meta: None,
        normalized_questions: None,
        normalized_todos: None,
        normalized_todo_update: None,
        parent_tool_use_id: Some(parent.to_string()),
        task_children: None,
        question_answer: None,
        awaiting_plan_approval: false,
        plan_approval_request_id: None,
    }
}

#[test]
fn task_reconciler_buffers_child_until_parent_with_projected_kinds() {
    let mut tr = TaskReconciler::new();
    let child = read_child("c1", "p1");
    let outs = tr.handle_tool_call_with_policy(child, TaskReconciliationPolicy::ExplicitParentIds);
    assert!(
        outs.iter().all(|o| matches!(o, ReconcilerOutput::Buffered)),
        "child should buffer until parent exists"
    );

    let parent = ToolCallData {
        id: "p1".to_string(),
        name: "Task".to_string(),
        arguments: ToolArguments::Think {
            description: Some("t".to_string()),
            prompt: None,
            subagent_type: None,
            skill: None,
            skill_args: None,
            raw: None,
        },
        raw_input: None,
        status: ToolCallStatus::Pending,
        result: None,
        kind: Some(ToolKind::Task),
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

    let outs = tr.handle_tool_call_with_policy(parent, TaskReconciliationPolicy::ExplicitParentIds);
    let emitted: Vec<&ToolCallData> = outs
        .iter()
        .filter_map(|o| match o {
            ReconcilerOutput::EmitToolCall(tc) => Some(tc),
            _ => None,
        })
        .collect();
    assert_eq!(emitted.len(), 1);
    assert_eq!(emitted[0].id, "p1");
    let children = emitted[0].task_children.as_ref().expect("child attached");
    assert_eq!(children.len(), 1);
    assert_eq!(children[0].id, "c1");
    assert_eq!(children[0].kind, Some(ToolKind::Read));
}
