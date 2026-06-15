use std::path::Path;

use crate::acp::session_update::{PlanStep, PlanStepStatus, TodoStatus};

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreatePlanTodo {
    pub content: Option<String>,
    pub status: Option<String>,
}

pub(crate) fn strip_underscore_prefix(method: &str) -> &str {
    method.strip_prefix('_').unwrap_or(method)
}

pub(crate) fn todo_status_from_str(status: Option<&str>) -> TodoStatus {
    match status.unwrap_or("pending") {
        "completed" => TodoStatus::Completed,
        "in_progress" => TodoStatus::InProgress,
        "cancelled" => TodoStatus::Cancelled,
        _ => TodoStatus::Pending,
    }
}

pub(crate) fn plan_step_status_from_str(status: Option<&str>) -> PlanStepStatus {
    match status.unwrap_or("pending") {
        "completed" => PlanStepStatus::Completed,
        "in_progress" => PlanStepStatus::InProgress,
        "failed" => PlanStepStatus::Failed,
        _ => PlanStepStatus::Pending,
    }
}

pub(crate) fn active_form_for_status(content: &str, status: Option<&str>) -> String {
    match status.unwrap_or("pending") {
        "completed" => format!("Completed {content}"),
        "in_progress" => format!("Working on {content}"),
        "cancelled" => format!("Cancelled {content}"),
        _ => format!("Pending {content}"),
    }
}

pub(crate) fn mime_type_for_path(path: &str) -> &'static str {
    match Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .as_deref()
    {
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        _ => "image/png",
    }
}

pub(crate) fn create_plan_step(todo: &CreatePlanTodo, phase_name: Option<&str>) -> PlanStep {
    let content = todo.content.clone().unwrap_or_default();
    let description = match phase_name {
        Some(phase) if !phase.is_empty() => format!("{phase}: {content}"),
        _ => content,
    };

    PlanStep {
        description,
        status: plan_step_status_from_str(todo.status.as_deref()),
    }
}
