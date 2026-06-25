use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ComputerPermissionKind {
    Accessibility,
    ScreenRecording,
    AppWindowScope,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ComputerPermissionApprovalScope {
    #[default]
    Once,
    Always,
}

pub fn build_computer_permission_interaction_id(
    session_id: &str,
    tool_call_id: &str,
    permission_kind: ComputerPermissionKind,
) -> String {
    let permission_key = match permission_kind {
        ComputerPermissionKind::Accessibility => "accessibility",
        ComputerPermissionKind::ScreenRecording => "screen_recording",
        ComputerPermissionKind::AppWindowScope => "app_window_scope",
    };

    format!(
        "computer-permission:{}:{}:{}:{}:{}",
        session_id.len(),
        session_id,
        tool_call_id.len(),
        tool_call_id,
        permission_key
    )
}
