//! Cursor ACP extension adapters — one module home per extension method.
//!
//! Normalizes Cursor-specific JSON-RPC extension requests/notifications into
//! canonical `ProviderExtensionEvent` updates.

mod ask_question;
mod create_plan;
mod generate_image;
mod response;
mod shared;
mod task;
mod update_todos;

pub use response::adapt_cursor_response;

pub(crate) const CURSOR_ASK_QUESTION: &str = "cursor/ask_question";
pub(crate) const CURSOR_CREATE_PLAN: &str = "cursor/create_plan";
pub(crate) const CURSOR_UPDATE_TODOS: &str = "cursor/update_todos";
pub(crate) const CURSOR_TASK: &str = "cursor/task";
pub(crate) const CURSOR_GENERATE_IMAGE: &str = "cursor/generate_image";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CursorExtensionKind {
    Request,
    Notification,
}

fn tool_name_to_extension_method(tool_name: &str) -> Option<&'static str> {
    match tool_name {
        "askQuestion" => Some(CURSOR_ASK_QUESTION),
        "createPlan" => Some(CURSOR_CREATE_PLAN),
        "updateTodos" => Some(CURSOR_UPDATE_TODOS),
        "task" => Some(CURSOR_TASK),
        "generateImage" => Some(CURSOR_GENERATE_IMAGE),
        _ => None,
    }
}

/// Check if a session/update notification is a Cursor pre-tool signal for a
/// known extension method (askQuestion, createPlan, generateImage, etc.).
pub fn is_cursor_extension_pre_tool(json: &serde_json::Value) -> bool {
    let update = match json.pointer("/params/update") {
        Some(u) => u,
        None => return false,
    };
    if update.get("sessionUpdate").and_then(|v| v.as_str()) != Some("tool_call") {
        return false;
    }
    let tool_name = match update
        .get("rawInput")
        .and_then(|ri| ri.get("_toolName"))
        .and_then(|v| v.as_str())
    {
        Some(name) => name,
        None => return false,
    };
    tool_name_to_extension_method(tool_name).is_some()
}

pub fn cursor_extension_kind(method: &str) -> Option<CursorExtensionKind> {
    match shared::strip_underscore_prefix(method) {
        CURSOR_ASK_QUESTION | CURSOR_CREATE_PLAN => Some(CursorExtensionKind::Request),
        CURSOR_UPDATE_TODOS | CURSOR_TASK | CURSOR_GENERATE_IMAGE => {
            Some(CursorExtensionKind::Notification)
        }
        _ => None,
    }
}

pub fn normalize_cursor_extension(
    method: &str,
    params: &serde_json::Value,
    request_id: Option<u64>,
    current_session_id: Option<&str>,
) -> Result<crate::acp::provider_extensions::ProviderExtensionEvent, String> {
    let session_id = current_session_id
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("Cursor extension method {method} requires an active session id"))?
        .to_string();

    match shared::strip_underscore_prefix(method) {
        CURSOR_ASK_QUESTION => ask_question::normalize(params, request_id, session_id),
        CURSOR_CREATE_PLAN => create_plan::normalize(params, request_id, session_id),
        CURSOR_UPDATE_TODOS => update_todos::normalize(params, session_id),
        CURSOR_TASK => task::normalize(params, session_id),
        CURSOR_GENERATE_IMAGE => generate_image::normalize(params, session_id),
        _ => Err(format!("Unsupported Cursor extension method: {method}")),
    }
}

#[cfg(test)]
mod tests;
