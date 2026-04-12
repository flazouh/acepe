//! Agent-specific edit argument normalizers.
//!
//! These modules are the single ownership boundary for agent-specific edit
//! payload normalization. They must always return canonical `ToolArguments::Edit`.

pub(crate) mod claude_code;
pub(crate) mod codex;
pub(crate) mod copilot;
pub(crate) mod cursor;
pub(crate) mod opencode;
pub(crate) mod patch_text;
pub(crate) mod shared_chat;

use crate::acp::parsers::arguments::extract_parser_string;
use crate::acp::session_update::{EditDelta, ToolArguments};

pub(crate) fn parse_changes_map_edit(raw_arguments: &serde_json::Value) -> Option<ToolArguments> {
    let changes = raw_arguments
        .get("changes")
        .and_then(|changes| changes.as_object())?;

    if changes.is_empty() {
        return None;
    }

    let edits: Vec<EditDelta> = changes
        .iter()
        .map(|(path, change_payload)| {
            let old_string =
                extract_parser_string(change_payload, &["oldText", "old_string", "old_content"]);
            let new_string =
                extract_parser_string(change_payload, &["newText", "new_string", "new_content"]);
            let content = extract_parser_string(
                change_payload,
                &["content", "new_content", "new_string", "newText"],
            );
            if content.is_some() && new_string.is_none() {
                EditDelta::WriteFile {
                    file_path: Some(path.clone()),
                    move_from: None,
                    previous_content: old_string,
                    content,
                }
            } else {
                EditDelta::ReplaceText {
                    file_path: Some(path.clone()),
                    move_from: None,
                    old_text: old_string,
                    new_text: new_string.or(content),
                }
            }
        })
        .collect();

    Some(ToolArguments::Edit { edits })
}
