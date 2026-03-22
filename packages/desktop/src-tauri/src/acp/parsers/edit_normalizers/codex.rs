//! Codex-specific edit normalization.
//!
//! Codex may emit edits in either:
//! - direct fields (`file_path`, `old_string`, `new_string`, `content`), or
//! - changes map (`changes[path] = { old_content/new_content/... }`).

use crate::acp::parsers::arguments::{parse_generic_edit_arguments, parse_parser_parsed_cmd_path};
use crate::acp::parsers::edit_normalizers::parse_changes_map_edit;
use crate::acp::session_update::ToolArguments;

pub(crate) fn parse_edit_arguments(raw_arguments: &serde_json::Value) -> ToolArguments {
    if let Some(arguments_from_changes) = parse_changes_map_edit(raw_arguments) {
        return arguments_from_changes;
    }

    let generic = parse_generic_edit_arguments(raw_arguments);
    let ToolArguments::Edit {
        file_path,
        old_string,
        new_string,
        content,
    } = generic
    else {
        return generic;
    };

    let parsed_cmd_path = parse_parser_parsed_cmd_path(
        raw_arguments,
        &["edit", "write", "multi_edit", "multiedit", "apply_patch"],
    );

    ToolArguments::Edit {
        file_path: file_path.or(parsed_cmd_path),
        old_string,
        new_string,
        content,
    }
}
