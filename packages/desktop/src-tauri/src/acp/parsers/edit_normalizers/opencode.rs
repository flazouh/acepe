//! OpenCode-specific edit normalization.
//!
//! Handles two edit formats from OpenCode:
//! 1. Standard fields (`filePath`, `new_string`, etc.) — delegated to generic parser.
//! 2. `patch_text` — OpenCode's custom multi-file diff format:
//!    ```
//!    *** Begin Patch
//!    *** Update File: src/foo.ts
//!    @@ context_line
//!    -old line
//!    +new line
//!    *** End Patch
//!    ```

use crate::acp::parsers::arguments::parse_generic_edit_arguments;
use crate::acp::parsers::edit_normalizers::parse_changes_map_edit;
use crate::acp::session_update::{EditEntry, ToolArguments};

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

/// Parse OpenCode's `patch_text` format into one `EditEntry` per modified file.
///
/// Format:
/// ```
/// *** Begin Patch
/// *** Update File: <path>
/// @@ <context_line>
/// -<old_line>
/// +<new_line>
///  <context_line>
/// *** End Patch
/// ```
///
/// Lines prefixed with ` ` (space) or `@@ ` are context (appear in both old & new).
/// Lines prefixed with `-` are old-only. Lines prefixed with `+` are new-only.
pub(crate) fn parse_patch_text(raw_arguments: &serde_json::Value) -> Option<ToolArguments> {
    let patch_text = raw_arguments
        .get("patch_text")
        .and_then(|v| v.as_str())
        .filter(|s| !s.trim().is_empty())?;

    let edits = parse_patch_text_str(patch_text);

    if edits.is_empty() {
        return None;
    }

    Some(ToolArguments::Edit { edits })
}

pub(crate) fn parse_patch_text_str(patch_text: &str) -> Vec<EditEntry> {
    let mut edits: Vec<EditEntry> = Vec::new();

    // Split on "*** Update File: " markers to get per-file sections.
    // The first segment (before any file marker) is the header/preamble — discard it.
    let file_marker = "*** Update File: ";
    let end_marker = "*** End Patch";

    // Find all "*** Update File:" positions
    let mut remaining = patch_text;

    loop {
        // Find the next file section
        let Some(file_start) = remaining.find(file_marker) else {
            break;
        };

        let after_marker = &remaining[file_start + file_marker.len()..];

        // Extract file path (the rest of that line)
        let path_end = after_marker.find('\n').unwrap_or(after_marker.len());
        let file_path = after_marker[..path_end].trim().to_string();
        if file_path.is_empty() {
            remaining = &after_marker[path_end..];
            continue;
        }

        // The diff lines start after the path line
        let diff_section = &after_marker[path_end..];

        // Find where this file's section ends (either next file marker or end patch)
        let section_end = diff_section
            .find(file_marker)
            .or_else(|| diff_section.find(end_marker))
            .unwrap_or(diff_section.len());

        let diff_lines = &diff_section[..section_end];

        let entry = parse_file_diff_section(&file_path, diff_lines);
        edits.push(entry);

        // Advance past this section
        remaining = &diff_section[section_end..];
    }

    edits
}

fn parse_file_diff_section(file_path: &str, diff_lines: &str) -> EditEntry {
    let mut old_lines: Vec<&str> = Vec::new();
    let mut new_lines: Vec<&str> = Vec::new();

    for line in diff_lines.lines() {
        if let Some(ctx) = line.strip_prefix("@@ ") {
            // Context header line — the content after "@@ " appears in both old and new
            old_lines.push(ctx);
            new_lines.push(ctx);
        } else if let Some(stripped) = line.strip_prefix('-') {
            old_lines.push(stripped);
        } else if let Some(stripped) = line.strip_prefix('+') {
            new_lines.push(stripped);
        } else if let Some(ctx) = line.strip_prefix(' ') {
            // Context line (space prefix) — appears in both
            old_lines.push(ctx);
            new_lines.push(ctx);
        }
        // Lines starting with "***" are section markers — skip them
    }

    let old_string = if old_lines.is_empty() {
        None
    } else {
        Some(old_lines.join("\n"))
    };

    let new_string = if new_lines.is_empty() {
        None
    } else {
        Some(new_lines.join("\n"))
    };

    EditEntry {
        file_path: Some(file_path.to_string()),
        old_string,
        new_string: new_string.clone(),
        content: new_string,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_patch_text_single_file() {
        let patch = r#"*** Begin Patch
*** Update File: src/foo.ts
@@ const value = 1;
-const value = 1;
+const value = 2;
*** End Patch"#;

        let raw = serde_json::json!({ "patch_text": patch });
        let result = parse_patch_text(&raw).expect("should parse patch_text");

        match result {
            ToolArguments::Edit { edits } => {
                assert_eq!(edits.len(), 1);
                assert_eq!(edits[0].file_path.as_deref(), Some("src/foo.ts"));
                let old = edits[0].old_string.as_deref().unwrap_or("");
                let new = edits[0].new_string.as_deref().unwrap_or("");
                assert!(old.contains("const value = 1;"), "old: {old}");
                assert!(new.contains("const value = 2;"), "new: {new}");
            }
            other => panic!("Expected Edit, got {other:?}"),
        }
    }

    #[test]
    fn parse_patch_text_multi_file() {
        let patch = r#"*** Begin Patch
*** Update File: src/a.ts
@@ export const A = 1;
-export const A = 1;
+export const A = 2;
*** Update File: src/b.ts
@@ export const B = "hello";
-export const B = "hello";
+export const B = "world";
*** End Patch"#;

        let raw = serde_json::json!({ "patch_text": patch });
        let result = parse_patch_text(&raw).expect("should parse patch_text");

        match result {
            ToolArguments::Edit { edits } => {
                assert_eq!(edits.len(), 2);
                assert_eq!(edits[0].file_path.as_deref(), Some("src/a.ts"));
                assert_eq!(edits[1].file_path.as_deref(), Some("src/b.ts"));
                assert!(edits[0]
                    .old_string
                    .as_deref()
                    .unwrap_or("")
                    .contains("A = 1"));
                assert!(edits[0]
                    .new_string
                    .as_deref()
                    .unwrap_or("")
                    .contains("A = 2"));
                assert!(edits[1]
                    .old_string
                    .as_deref()
                    .unwrap_or("")
                    .contains("B = \"hello\""));
                assert!(edits[1]
                    .new_string
                    .as_deref()
                    .unwrap_or("")
                    .contains("B = \"world\""));
            }
            other => panic!("Expected Edit, got {other:?}"),
        }
    }

    #[test]
    fn parse_patch_text_returns_none_when_key_absent() {
        let raw = serde_json::json!({ "file_path": "foo.ts", "new_string": "x" });
        assert!(parse_patch_text(&raw).is_none());
    }

    #[test]
    fn parse_patch_text_returns_none_when_no_file_markers() {
        let raw = serde_json::json!({ "patch_text": "*** Begin Patch\n*** End Patch\n" });
        assert!(parse_patch_text(&raw).is_none());
    }
}
