//! Canonical subagent projection tracer tests.

use crate::acp::parsers::AgentType;
use crate::acp::projections::OperationSourceLink;
use crate::acp::session::delivery::session_open_found_from_fold;
use crate::acp::session::engine::fold::{fold_full, fold_step, FoldContext};
use crate::acp::session::ingress::event::{ProviderEvent, ProviderEventKind};
use crate::acp::session::ingress::full_session_to_provider_events;
use crate::acp::session_state_engine::graph::SessionStateGraph;
use crate::acp::session_update::{
    ToolArguments, ToolCallData, ToolCallStatus, ToolKind, ToolSourceContext,
};
use crate::acp::transcript_projection::TranscriptScope;
use crate::acp::transcript_viewport::{
    project_transcript_viewport_rows, project_transcript_viewport_rows_for_scope,
    TranscriptViewportRow, TranscriptViewportRowContent,
};
use crate::acp::types::CanonicalAgentId;
use crate::session_jsonl::types::{ContentBlock, FullSession, OrderedMessage, SessionStats};
use serde_json::{json, Value};

const SESSION_ID: &str = "subagent-projection-session";
const PARENT_TASK_ID: &str = "toolu_parent_task";
const CHILD_READ_ID: &str = "toolu_child_read";
const NESTED_TASK_ID: &str = "toolu_nested_task";
const NESTED_READ_ID: &str = "toolu_nested_read";
const CHILD_PATH: &str = "/project/src/composer/input-editor.ts";
const CHILD_READ_TITLE: &str = "Read input editor";

fn tool_call_event(provider_seq: u64, tool_call: ToolCallData) -> ProviderEvent {
    ProviderEvent {
        source: CanonicalAgentId::ClaudeCode,
        provider_seq,
        provider_row_id: format!("provider-row-{provider_seq}"),
        timestamp_ms: Some(1_784_153_600_000 + provider_seq as i64),
        kind: ProviderEventKind::ToolCall(tool_call),
    }
}

fn task_tool_call() -> ToolCallData {
    ToolCallData {
        id: PARENT_TASK_ID.to_string(),
        name: "Task".to_string(),
        arguments: ToolArguments::Think {
            description: Some("Find composer mention chip key handling".to_string()),
            prompt: Some("Inspect the composer keyboard handlers".to_string()),
            subagent_type: Some("Explore".to_string()),
            skill: None,
            skill_args: None,
            raw: None,
        },
        diagnostic_input: None,
        status: ToolCallStatus::InProgress,
        result: None,
        kind: Some(ToolKind::Task),
        title: Some("Find composer mention chip key handling".to_string()),
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

fn child_read_tool_call() -> ToolCallData {
    ToolCallData {
        id: CHILD_READ_ID.to_string(),
        name: "Read".to_string(),
        arguments: ToolArguments::Read {
            file_path: Some(CHILD_PATH.to_string()),
            source_context: Some(ToolSourceContext {
                path: Some(CHILD_PATH.to_string()),
                view_range: None,
                excerpt: None,
            }),
        },
        diagnostic_input: None,
        status: ToolCallStatus::InProgress,
        result: None,
        kind: Some(ToolKind::Read),
        title: Some(CHILD_READ_TITLE.to_string()),
        locations: None,
        skill_meta: None,
        normalized_questions: None,
        normalized_todos: None,
        normalized_todo_update: None,
        parent_tool_use_id: Some(PARENT_TASK_ID.to_string()),
        task_children: None,
        question_answer: None,
        awaiting_plan_approval: false,
        plan_approval_request_id: None,
    }
}

fn nested_task_tool_call() -> ToolCallData {
    let mut tool_call = task_tool_call();
    tool_call.id = NESTED_TASK_ID.to_string();
    tool_call.title = Some("Inspect nested composer behavior".to_string());
    tool_call.parent_tool_use_id = Some(PARENT_TASK_ID.to_string());
    tool_call
}

fn nested_read_tool_call() -> ToolCallData {
    let mut tool_call = child_read_tool_call();
    tool_call.id = NESTED_READ_ID.to_string();
    tool_call.title = Some("Read nested input editor".to_string());
    tool_call.parent_tool_use_id = Some(NESTED_TASK_ID.to_string());
    tool_call
}

fn project_rows(graph: &SessionStateGraph) -> Vec<TranscriptViewportRow> {
    project_transcript_viewport_rows(
        &graph.transcript_snapshot,
        &graph.operations,
        &graph.interactions,
        None,
        None,
    )
}

fn row_for_tool_call<'a>(
    rows: &'a [TranscriptViewportRow],
    tool_call_id: &str,
) -> &'a TranscriptViewportRow {
    rows.iter()
        .find(|row| {
            row.operation_links
                .iter()
                .any(|link| link.tool_call_id == tool_call_id)
        })
        .unwrap_or_else(|| panic!("missing viewport row for tool call {tool_call_id}"))
}

fn display_facts_json(row: &TranscriptViewportRow, tool_call_id: &str) -> Value {
    let serialized = serde_json::to_value(row).expect("serialize viewport row");
    serialized["operationLinks"]
        .as_array()
        .and_then(|links| {
            links.iter().find(|link| {
                link["toolCallId"]
                    .as_str()
                    .is_some_and(|id| id == tool_call_id)
            })
        })
        .and_then(|link| link.get("displayFacts"))
        .cloned()
        .unwrap_or(Value::Null)
}

fn viewport_row_structure(rows: &[TranscriptViewportRow]) -> Vec<Value> {
    rows.iter()
        .map(|row| {
            json!({
                "sourceEntryId": row.source_entry_id,
                "kind": row.kind,
                "toolCallIds": row
                    .operation_links
                    .iter()
                    .map(|link| link.tool_call_id.as_str())
                    .collect::<Vec<_>>(),
                "content": row.content,
            })
        })
        .collect()
}

#[test]
fn parent_task_row_exposes_latest_child_action() {
    let context = FoldContext::new(SESSION_ID, CanonicalAgentId::ClaudeCode, "/project");
    let history_graph = fold_full(&[tool_call_event(1, task_tool_call())], &context);
    let live_graph = fold_step(&history_graph, &tool_call_event(2, child_read_tool_call())).0;
    let rows = project_rows(&live_graph);

    let child_operation = live_graph
        .operations
        .iter()
        .find(|operation| operation.tool_call_id == CHILD_READ_ID)
        .expect("child Read operation");
    let parent_operation = live_graph
        .operations
        .iter()
        .find(|operation| operation.tool_call_id == PARENT_TASK_ID)
        .expect("parent Task operation");
    let OperationSourceLink::TranscriptLinked { entry_id } = &child_operation.source_link else {
        panic!("child Read must link to its scoped transcript entry");
    };
    let child_source_entry = live_graph
        .transcript_snapshot
        .entries
        .iter()
        .find(|entry| &entry.entry_id == entry_id)
        .expect("child Read source entry");
    assert_eq!(
        child_source_entry.scope,
        TranscriptScope::Operation(parent_operation.id.clone()),
        "the scoped source entry must own canonical child lineage"
    );
    assert_eq!(child_operation.parent_tool_call_id, None);
    assert_eq!(child_operation.parent_operation_id, None);

    let parent_row = row_for_tool_call(&rows, PARENT_TASK_ID);
    let parent_facts = display_facts_json(parent_row, PARENT_TASK_ID);
    let actual_parent_projection = json!({
        "childToolCallIds": parent_facts["childToolCallIds"].clone(),
        "childTranscriptScope": parent_facts["childTranscriptScope"].clone(),
        "latestChildAction": parent_facts["latestChildAction"].clone(),
    });
    let expected_parent_projection = json!({
        "childToolCallIds": [CHILD_READ_ID],
        "childTranscriptScope": {
            "kind": "operation",
            "operationId": parent_operation.id,
        },
        "latestChildAction": {
            "operationId": child_operation.id,
            "toolCallId": CHILD_READ_ID,
            "kind": "read",
            "state": "running",
            "title": CHILD_READ_TITLE,
            "targetPathSummary": CHILD_PATH,
        },
    });

    assert_eq!(
        actual_parent_projection, expected_parent_projection,
        "the serialized parent Task row must expose graph-derived scope plus directly usable latest-child Read facts"
    );
}

#[test]
fn latest_child_action_change_updates_parent_task_row_version() {
    let context = FoldContext::new(SESSION_ID, CanonicalAgentId::ClaudeCode, "/project");
    let parent_graph = fold_full(&[tool_call_event(1, task_tool_call())], &context);
    let running_graph = fold_step(&parent_graph, &tool_call_event(2, child_read_tool_call())).0;
    let mut completed_child = child_read_tool_call();
    completed_child.status = ToolCallStatus::Completed;
    completed_child.result = Some(json!({ "content": "input editor source" }));
    let completed_graph = fold_step(&running_graph, &tool_call_event(3, completed_child)).0;

    let running_rows = project_rows(&running_graph);
    let completed_rows = project_rows(&completed_graph);
    let running_parent = row_for_tool_call(&running_rows, PARENT_TASK_ID);
    let completed_parent = row_for_tool_call(&completed_rows, PARENT_TASK_ID);

    assert_eq!(running_parent.row_id, completed_parent.row_id);
    assert_ne!(
        running_parent.version, completed_parent.version,
        "a child-scope action change must invalidate the parent Task row"
    );
}

#[test]
fn nested_child_action_change_invalidates_nested_task_row_in_parent_scope() {
    let context = FoldContext::new(SESSION_ID, CanonicalAgentId::ClaudeCode, "/project");
    let root_graph = fold_full(&[tool_call_event(1, task_tool_call())], &context);
    let nested_task_graph = fold_step(&root_graph, &tool_call_event(2, nested_task_tool_call())).0;
    let running_graph = fold_step(
        &nested_task_graph,
        &tool_call_event(3, nested_read_tool_call()),
    )
    .0;
    let mut completed_read = nested_read_tool_call();
    completed_read.status = ToolCallStatus::Completed;
    completed_read.result = Some(json!({ "content": "nested input editor source" }));
    let completed_graph = fold_step(&running_graph, &tool_call_event(4, completed_read)).0;

    let parent_operation = running_graph
        .operations
        .iter()
        .find(|operation| operation.tool_call_id == PARENT_TASK_ID)
        .expect("root parent Task operation");
    let nested_task_operation = running_graph
        .operations
        .iter()
        .find(|operation| operation.tool_call_id == NESTED_TASK_ID)
        .expect("nested Task operation");
    let parent_scope = TranscriptScope::Operation(parent_operation.id.clone());
    let nested_scope = TranscriptScope::Operation(nested_task_operation.id.clone());
    let running_parent_scope_rows = project_transcript_viewport_rows_for_scope(
        &running_graph.transcript_snapshot,
        &running_graph.operations,
        &running_graph.interactions,
        None,
        None,
        &parent_scope,
    );
    let completed_parent_scope_rows = project_transcript_viewport_rows_for_scope(
        &completed_graph.transcript_snapshot,
        &completed_graph.operations,
        &completed_graph.interactions,
        None,
        None,
        &parent_scope,
    );
    let running_nested_task = row_for_tool_call(&running_parent_scope_rows, NESTED_TASK_ID);
    let completed_nested_task = row_for_tool_call(&completed_parent_scope_rows, NESTED_TASK_ID);
    assert_eq!(running_nested_task.row_id, completed_nested_task.row_id);
    assert_ne!(
        running_nested_task.version, completed_nested_task.version,
        "the nested Read lifecycle must invalidate its direct nested Task row"
    );

    let running_nested_rows = project_transcript_viewport_rows_for_scope(
        &running_graph.transcript_snapshot,
        &running_graph.operations,
        &running_graph.interactions,
        None,
        None,
        &nested_scope,
    );
    let completed_nested_rows = project_transcript_viewport_rows_for_scope(
        &completed_graph.transcript_snapshot,
        &completed_graph.operations,
        &completed_graph.interactions,
        None,
        None,
        &nested_scope,
    );
    let running_read = row_for_tool_call(&running_nested_rows, NESTED_READ_ID);
    let completed_read = row_for_tool_call(&completed_nested_rows, NESTED_READ_ID);
    assert_eq!(running_read.row_id, completed_read.row_id);
    assert_ne!(running_read.version, completed_read.version);
}

fn ordered_message(
    uuid: &str,
    role: &str,
    request_id: &str,
    parent_tool_use_id: Option<&str>,
    content_blocks: Vec<ContentBlock>,
) -> OrderedMessage {
    OrderedMessage {
        uuid: uuid.to_string(),
        parent_uuid: None,
        role: role.to_string(),
        provider_message_id: Some(format!("provider-{uuid}")),
        timestamp: "2026-07-15T21:00:00Z".to_string(),
        content_blocks,
        model: None,
        usage: None,
        error: None,
        request_id: Some(request_id.to_string()),
        is_meta: false,
        source_tool_use_id: None,
        parent_tool_use_id: parent_tool_use_id.map(str::to_string),
        tool_use_result: None,
        source_tool_assistant_uuid: None,
    }
}

fn claude_subagent_history() -> FullSession {
    FullSession {
        session_id: SESSION_ID.to_string(),
        project_path: "/project".to_string(),
        title: "Subagent projection".to_string(),
        created_at: "2026-07-15T21:00:00Z".to_string(),
        messages: vec![
            ordered_message(
                "user-1",
                "user",
                "request-user",
                None,
                vec![ContentBlock::Text {
                    text: "Inspect the composer".to_string(),
                }],
            ),
            ordered_message(
                "assistant-parent",
                "assistant",
                "request-parent",
                None,
                vec![ContentBlock::ToolUse {
                    id: PARENT_TASK_ID.to_string(),
                    name: "Task".to_string(),
                    input: json!({
                        "description": "Find composer mention chip key handling",
                        "prompt": "Inspect the composer keyboard handlers",
                        "subagent_type": "Explore",
                    }),
                }],
            ),
            ordered_message(
                "assistant-child-thought",
                "assistant",
                "request-child-thought",
                Some(PARENT_TASK_ID),
                vec![ContentBlock::Thinking {
                    thinking: "I found the mention editor and will inspect its keys.".to_string(),
                    signature: None,
                    redacted_provider_data: None,
                }],
            ),
            ordered_message(
                "assistant-child-read",
                "assistant",
                "request-child-read",
                Some(PARENT_TASK_ID),
                vec![ContentBlock::ToolUse {
                    id: CHILD_READ_ID.to_string(),
                    name: "Read".to_string(),
                    input: json!({ "file_path": CHILD_PATH }),
                }],
            ),
            ordered_message(
                "assistant-child-final",
                "assistant",
                "request-child-final",
                Some(PARENT_TASK_ID),
                vec![ContentBlock::Text {
                    text: "ArrowRight is handled by the mention suggestion controller.".to_string(),
                }],
            ),
        ],
        stats: SessionStats::default(),
    }
}

#[test]
fn session_open_preserves_subagent_transcript_in_task_scope() {
    const CHILD_THOUGHT: &str = "I found the mention editor and will inspect its keys.";
    const CHILD_FINAL: &str = "ArrowRight is handled by the mention suggestion controller.";

    let session = claude_subagent_history();
    let events = full_session_to_provider_events(
        &session,
        CanonicalAgentId::ClaudeCode,
        AgentType::ClaudeCode,
    );
    let context = FoldContext::new(SESSION_ID, CanonicalAgentId::ClaudeCode, "/project");
    let graph = fold_full(&events, &context);
    let found = session_open_found_from_fold(graph, "subagent-open-token");
    let root_rows = project_transcript_viewport_rows(
        &found.transcript_snapshot,
        &found.operations,
        &found.interactions,
        found.active_streaming_tail.as_ref(),
        None,
    );

    let root_rows_json = serde_json::to_string(&root_rows).expect("serialize root rows");
    let root_tool_call_ids: Vec<&str> = root_rows
        .iter()
        .flat_map(|row| row.operation_links.iter())
        .map(|link| link.tool_call_id.as_str())
        .collect();
    assert!(!root_tool_call_ids.contains(&CHILD_READ_ID));
    assert!(!root_rows_json.contains(CHILD_THOUGHT));
    assert!(!root_rows_json.contains(CHILD_FINAL));

    let task_operation = found
        .operations
        .iter()
        .find(|operation| operation.tool_call_id == PARENT_TASK_ID)
        .expect("parent Task operation");
    let task_scope = TranscriptScope::Operation(task_operation.id.clone());
    let task_rows = project_transcript_viewport_rows_for_scope(
        &found.transcript_snapshot,
        &found.operations,
        &found.interactions,
        found.active_streaming_tail.as_ref(),
        None,
        &task_scope,
    );
    let task_order: Vec<Value> = task_rows
        .iter()
        .map(|row| {
            let text = match &row.content {
                TranscriptViewportRowContent::Transcript { segments, .. } => segments
                    .iter()
                    .filter_map(|segment| match segment {
                        crate::acp::transcript_projection::TranscriptSegment::Text {
                            text, ..
                        }
                        | crate::acp::transcript_projection::TranscriptSegment::Thought {
                            text,
                            ..
                        } => Some(text.as_str()),
                        _ => None,
                    })
                    .collect::<Vec<_>>()
                    .join(""),
                TranscriptViewportRowContent::Compaction { .. } => String::new(),
            };
            json!({
                "kind": row.kind,
                "text": text,
                "toolCallIds": row
                    .operation_links
                    .iter()
                    .map(|link| link.tool_call_id.as_str())
                    .collect::<Vec<_>>(),
            })
        })
        .collect();
    assert_eq!(
        task_order,
        vec![
            json!({
                "kind": "assistantThought",
                "text": CHILD_THOUGHT,
                "toolCallIds": [],
            }),
            json!({
                "kind": "tool",
                "text": "Read",
                "toolCallIds": [CHILD_READ_ID],
            }),
            json!({
                "kind": "assistantText",
                "text": CHILD_FINAL,
                "toolCallIds": [],
            }),
        ],
        "Task-scoped viewport rows must preserve canonical thought → Read → final text order"
    );

    let child_operation = found
        .operations
        .iter()
        .find(|operation| operation.tool_call_id == CHILD_READ_ID)
        .expect("child Read operation");
    let OperationSourceLink::TranscriptLinked { entry_id } = &child_operation.source_link else {
        panic!("child Read must link to its scoped transcript entry");
    };
    assert_eq!(entry_id, &task_rows[1].source_entry_id);
    assert_eq!(child_operation.parent_tool_call_id, None);
    assert_eq!(child_operation.parent_operation_id, None);
}

#[test]
fn subagent_scopes_match_between_fold_full_and_fold_step() {
    let session = claude_subagent_history();
    let events = full_session_to_provider_events(
        &session,
        CanonicalAgentId::ClaudeCode,
        AgentType::ClaudeCode,
    );
    let context = FoldContext::new(SESSION_ID, CanonicalAgentId::ClaudeCode, "/project");
    let full_graph = fold_full(&events, &context);
    let mut step_graph = fold_full(&[], &context);
    for event in &events {
        step_graph = fold_step(&step_graph, event).0;
    }

    assert_eq!(
        full_graph.transcript_snapshot, step_graph.transcript_snapshot,
        "history fold and sequential live fold must build the same scoped transcript graph"
    );

    let full_task_operation = full_graph
        .operations
        .iter()
        .find(|operation| operation.tool_call_id == PARENT_TASK_ID)
        .expect("full-fold Task operation");
    let step_task_operation = step_graph
        .operations
        .iter()
        .find(|operation| operation.tool_call_id == PARENT_TASK_ID)
        .expect("step-fold Task operation");
    assert_eq!(full_task_operation.id, step_task_operation.id);
    let task_scope = TranscriptScope::Operation(full_task_operation.id.clone());

    assert_eq!(
        viewport_row_structure(&project_rows(&full_graph)),
        viewport_row_structure(&project_rows(&step_graph))
    );
    let full_task_rows = project_transcript_viewport_rows_for_scope(
        &full_graph.transcript_snapshot,
        &full_graph.operations,
        &full_graph.interactions,
        None,
        None,
        &task_scope,
    );
    let step_task_rows = project_transcript_viewport_rows_for_scope(
        &step_graph.transcript_snapshot,
        &step_graph.operations,
        &step_graph.interactions,
        None,
        None,
        &task_scope,
    );
    assert_eq!(
        viewport_row_structure(&full_task_rows),
        viewport_row_structure(&step_task_rows)
    );

    let full_child_source = full_graph
        .operations
        .iter()
        .find(|operation| operation.tool_call_id == CHILD_READ_ID)
        .map(|operation| operation.source_link.clone());
    let step_child_source = step_graph
        .operations
        .iter()
        .find(|operation| operation.tool_call_id == CHILD_READ_ID)
        .map(|operation| operation.source_link.clone());
    assert_eq!(full_child_source, step_child_source);
}
