//! Shared edit normalization for chat-style ACP agents.

use crate::acp::parsers::arguments::parse_generic_edit_arguments;
use crate::acp::parsers::edit_normalizers::parse_changes_map_edit;
use crate::acp::session_update::ToolArguments;

use super::patch_text::{parse_patch_text, parse_patch_text_str};

fn parse_inline_patch_string(raw_arguments: &serde_json::Value) -> Option<ToolArguments> {
    let patch_text = raw_arguments
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())?;
    let edits = parse_patch_text_str(patch_text);
    if edits.is_empty() {
        return None;
    }
    Some(ToolArguments::Edit { edits })
}

pub(crate) fn parse_shared_chat_edit_arguments(raw_arguments: &serde_json::Value) -> ToolArguments {
    if let Some(arguments_from_patch) =
        parse_patch_text(raw_arguments).or_else(|| parse_inline_patch_string(raw_arguments))
    {
        return arguments_from_patch;
    }
    if let Some(arguments_from_changes) = parse_changes_map_edit(raw_arguments) {
        return arguments_from_changes;
    }
    parse_generic_edit_arguments(raw_arguments)
}
