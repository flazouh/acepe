//! Claude Code-specific edit normalization.

use crate::acp::session_update::ToolArguments;

use super::shared_chat::parse_shared_chat_edit_arguments;

pub(crate) fn parse_edit_arguments(raw_arguments: &serde_json::Value) -> ToolArguments {
    parse_shared_chat_edit_arguments(raw_arguments)
}
