//! Claude Code-specific edit normalization.

use crate::acp::parsers::arguments::parse_generic_edit_arguments;
use crate::acp::parsers::edit_normalizers::parse_changes_map_edit;
use crate::acp::session_update::ToolArguments;

pub(crate) fn parse_edit_arguments(raw_arguments: &serde_json::Value) -> ToolArguments {
    if let Some(arguments_from_changes) = parse_changes_map_edit(raw_arguments) {
        return arguments_from_changes;
    }
    parse_generic_edit_arguments(raw_arguments)
}
