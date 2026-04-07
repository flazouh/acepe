//! OpenCode-specific edit normalization.
//!
//! Handles two edit formats from OpenCode:
//! 1. Standard fields (`filePath`, `new_string`, etc.) — delegated to generic parser.
//! 2. `patch_text` — OpenCode's custom multi-file diff format:
//!    ```text
//!    *** Begin Patch
//!    *** Update File: src/foo.ts
//!    @@ context_line
//!    -old line
//!    +new line
//!    *** End Patch
//!    ```

use crate::acp::parsers::arguments::parse_generic_edit_arguments;
use crate::acp::parsers::edit_normalizers::parse_changes_map_edit;
use crate::acp::session_update::ToolArguments;

use super::patch_text::parse_patch_text;

pub(crate) fn parse_edit_arguments(raw_arguments: &serde_json::Value) -> ToolArguments {
    // Try patch_text format first (OpenCode-specific)
    if let Some(patch) = parse_patch_text(raw_arguments) {
        return patch;
    }

    if let Some(arguments_from_changes) = parse_changes_map_edit(raw_arguments) {
        return arguments_from_changes;
    }

    parse_generic_edit_arguments(raw_arguments)
}
