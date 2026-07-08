use crate::acp::provider_extensions::ProviderExtensionEvent;
use crate::acp::session_update::{
    SessionUpdate, TodoItem, ToolArguments, ToolCallData, ToolCallStatus, ToolCallUpdateData,
    ToolKind,
};
use serde::Deserialize;
use serde_json::Value;

use super::shared::{active_form_for_status, todo_status_from_str, CreatePlanTodo};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateTodosParams {
    tool_call_id: Option<String>,
    #[serde(default)]
    todos: Vec<CreatePlanTodo>,
}

pub(crate) fn normalize(
    params: &Value,
    session_id: String,
) -> Result<ProviderExtensionEvent, String> {
    let parsed: UpdateTodosParams =
        serde_json::from_value(params.clone()).map_err(|error| error.to_string())?;
    let tool_call_id = parsed
        .tool_call_id
        .ok_or_else(|| "cursor/update_todos missing toolCallId".to_string())?;
    let normalized_todos = normalize_todos(parsed.todos);

    Ok(ProviderExtensionEvent {
        updates: vec![
            SessionUpdate::ToolCall {
                tool_call: ToolCallData {
                    id: tool_call_id.clone(),
                    name: "TodoWrite".to_string(),
                    arguments: ToolArguments::Other {
                        raw: params.clone(),
                        intent: None,
                    },
                    diagnostic_input: Some(params.clone()),
                    status: ToolCallStatus::Completed,
                    result: None,
                    kind: Some(ToolKind::Todo),
                    title: Some("TodoWrite".to_string()),
                    locations: None,
                    skill_meta: None,
                    normalized_questions: None,
                    normalized_todos: Some(normalized_todos.clone()),
                    normalized_todo_update: None,
                    parent_tool_use_id: None,
                    task_children: None,
                    question_answer: None,
                    awaiting_plan_approval: false,
                    plan_approval_request_id: None,
                },
                session_id: Some(session_id.clone()),
            },
            SessionUpdate::ToolCallUpdate {
                update: ToolCallUpdateData {
                    tool_call_id,
                    status: Some(ToolCallStatus::Completed),
                    normalized_todos: Some(normalized_todos),
                    ..Default::default()
                },
                session_id: Some(session_id),
            },
        ],
        response_adapter: None,
    })
}

fn normalize_todos(todos: Vec<CreatePlanTodo>) -> Vec<TodoItem> {
    todos
        .into_iter()
        .map(|todo| {
            let content = todo.content.unwrap_or_default();
            let status = todo.status;
            TodoItem {
                active_form: active_form_for_status(&content, status.as_deref()),
                content,
                status: todo_status_from_str(status.as_deref()),
                started_at: None,
                completed_at: None,
                duration: None,
            }
        })
        .collect()
}
