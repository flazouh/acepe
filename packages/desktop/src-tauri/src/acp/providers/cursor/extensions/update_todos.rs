use crate::acp::provider_extensions::ProviderExtensionEvent;
use crate::acp::session_update::{SessionUpdate, TodoItem, ToolCallStatus, ToolCallUpdateData};
use serde::Deserialize;
use serde_json::Value;

use super::shared::{active_form_for_status, todo_status_from_str, CreatePlanTodo};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateTodosParams {
    tool_call_id: Option<String>,
    #[serde(default)]
    todos: Vec<CreatePlanTodo>,
    #[serde(default)]
    merge: bool,
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

    Ok(ProviderExtensionEvent {
        updates: vec![SessionUpdate::ToolCallUpdate {
            update: ToolCallUpdateData {
                tool_call_id,
                status: if parsed.merge {
                    Some(ToolCallStatus::InProgress)
                } else {
                    None
                },
                normalized_todos: Some(
                    parsed
                        .todos
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
                        .collect(),
                ),
                ..Default::default()
            },
            session_id: Some(session_id),
        }],
        response_adapter: None,
    })
}
