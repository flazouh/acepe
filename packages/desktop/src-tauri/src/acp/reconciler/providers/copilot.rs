//! GitHub Copilot adapter for tool name normalization.

use crate::acp::session_update::ToolKind;

use super::shared_chat::normalize_shared_chat_tool_name;

pub struct CopilotAdapter;

impl CopilotAdapter {
    pub fn normalize(name: &str) -> ToolKind {
        normalize_shared_chat_tool_name(name)
    }
}
