use crate::acp::session_update::{EditEntry, ToolArguments};

#[derive(Clone, Copy, Eq, PartialEq)]
enum PatchSectionKind {
    Update,
    Add,
    Delete,
}

struct PatchSection {
    kind: PatchSectionKind,
    file_path: String,
    move_to: Option<String>,
    diff_lines: Vec<String>,
}

/// Parse shared `patch_text`/`patchText` edit payloads into one `EditEntry` per
/// modified file.
pub(crate) fn parse_patch_text(raw_arguments: &serde_json::Value) -> Option<ToolArguments> {
    let patch_text = raw_arguments
        .get("patch_text")
        .or_else(|| raw_arguments.get("patchText"))
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())?;

    let edits = parse_patch_text_str(patch_text);

    if edits.is_empty() {
        return None;
    }

    Some(ToolArguments::Edit { edits })
}

pub(crate) fn parse_patch_text_str(patch_text: &str) -> Vec<EditEntry> {
    let mut sections: Vec<PatchSection> = Vec::new();
    let mut current_section: Option<PatchSection> = None;

    for line in patch_text.lines() {
        if let Some(section_kind) = parse_section_header(line) {
            if let Some(section) = current_section.take() {
                sections.push(section);
            }

            let file_path = line[section_header_prefix(section_kind).len()..].trim();
            if file_path.is_empty() {
                continue;
            }

            current_section = Some(PatchSection {
                kind: section_kind,
                file_path: file_path.to_string(),
                move_to: None,
                diff_lines: Vec::new(),
            });
            continue;
        }

        if line == "*** End Patch" {
            break;
        }

        if let Some(destination_path) = line.strip_prefix("*** Move to: ") {
            if let Some(section) = current_section.as_mut() {
                let trimmed_destination = destination_path.trim();
                if !trimmed_destination.is_empty() {
                    section.move_to = Some(trimmed_destination.to_string());
                }
            }
            continue;
        }

        if let Some(section) = current_section.as_mut() {
            section.diff_lines.push(line.to_string());
        }
    }

    if let Some(section) = current_section {
        sections.push(section);
    }

    sections
        .into_iter()
        .map(parse_patch_section)
        .collect()
}

fn parse_section_header(line: &str) -> Option<PatchSectionKind> {
    if line.starts_with(section_header_prefix(PatchSectionKind::Update)) {
        return Some(PatchSectionKind::Update);
    }
    if line.starts_with(section_header_prefix(PatchSectionKind::Add)) {
        return Some(PatchSectionKind::Add);
    }
    if line.starts_with(section_header_prefix(PatchSectionKind::Delete)) {
        return Some(PatchSectionKind::Delete);
    }
    None
}

fn section_header_prefix(section_kind: PatchSectionKind) -> &'static str {
    match section_kind {
        PatchSectionKind::Update => "*** Update File: ",
        PatchSectionKind::Add => "*** Add File: ",
        PatchSectionKind::Delete => "*** Delete File: ",
    }
}

fn parse_patch_section(section: PatchSection) -> EditEntry {
    let rendered_path = section.move_to.as_deref().unwrap_or(&section.file_path);
    let diff_lines = section.diff_lines.join("\n");

    if section.kind == PatchSectionKind::Delete {
        let mut deleted_entry = parse_file_diff_section(rendered_path, &diff_lines);
        deleted_entry.new_string = None;
        deleted_entry.content = None;
        return deleted_entry;
    }

    parse_file_diff_section(rendered_path, &diff_lines)
}

fn parse_file_diff_section(file_path: &str, diff_lines: &str) -> EditEntry {
    let mut old_lines: Vec<&str> = Vec::new();
    let mut new_lines: Vec<&str> = Vec::new();

    for line in diff_lines.lines() {
        if let Some(context) = line.strip_prefix("@@ ") {
            old_lines.push(context);
            new_lines.push(context);
        } else if let Some(stripped) = line.strip_prefix('-') {
            old_lines.push(stripped);
        } else if let Some(stripped) = line.strip_prefix('+') {
            new_lines.push(stripped);
        } else if let Some(context) = line.strip_prefix(' ') {
            old_lines.push(context);
            new_lines.push(context);
        }
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

    #[test]
    fn parse_patch_text_accepts_camel_case_key() {
        let patch = r#"*** Begin Patch
*** Add File: src/foo.ts
+export const value = 1;
*** End Patch"#;

        let raw = serde_json::json!({ "patchText": patch });
        let result = parse_patch_text(&raw).expect("should parse patchText");

        match result {
            ToolArguments::Edit { edits } => {
                assert_eq!(edits.len(), 1);
                assert_eq!(edits[0].file_path.as_deref(), Some("src/foo.ts"));
            }
            other => panic!("Expected Edit, got {other:?}"),
        }
    }

    #[test]
    fn parse_patch_text_supports_delete_file_sections() {
        let patch = r#"*** Begin Patch
*** Delete File: src/old.ts
 export const value = 1;
*** End Patch"#;

        let raw = serde_json::json!({ "patch_text": patch });
        let result = parse_patch_text(&raw).expect("should parse delete patch_text");

        match result {
            ToolArguments::Edit { edits } => {
                assert_eq!(edits.len(), 1);
                assert_eq!(edits[0].file_path.as_deref(), Some("src/old.ts"));
                assert_eq!(edits[0].new_string, None);
                assert_eq!(edits[0].content, None);
                assert_eq!(
                    edits[0].old_string.as_deref(),
                    Some("export const value = 1;")
                );
            }
            other => panic!("Expected Edit, got {other:?}"),
        }
    }

    #[test]
    fn parse_patch_text_preserves_move_destination_path() {
        let patch = r#"*** Begin Patch
*** Update File: src/old.ts
*** Move to: src/new.ts
@@
-old
+new
*** End Patch"#;

        let raw = serde_json::json!({ "patch_text": patch });
        let result = parse_patch_text(&raw).expect("should parse move patch_text");

        match result {
            ToolArguments::Edit { edits } => {
                assert_eq!(edits.len(), 1);
                assert_eq!(edits[0].file_path.as_deref(), Some("src/new.ts"));
                assert_eq!(edits[0].old_string.as_deref(), Some("old"));
                assert_eq!(edits[0].new_string.as_deref(), Some("new"));
            }
            other => panic!("Expected Edit, got {other:?}"),
        }
    }

    #[test]
    fn parse_patch_text_treats_control_markers_as_line_syntax_only() {
        let patch = r#"*** Begin Patch
*** Add File: docs/example.txt
+Literal text: *** End Patch should appear in file
*** End Patch"#;

        let raw = serde_json::json!({ "patch_text": patch });
        let result = parse_patch_text(&raw).expect("should parse literal control marker text");

        match result {
            ToolArguments::Edit { edits } => {
                assert_eq!(edits.len(), 1);
                assert_eq!(
                    edits[0].new_string.as_deref(),
                    Some("Literal text: *** End Patch should appear in file")
                );
            }
            other => panic!("Expected Edit, got {other:?}"),
        }
    }
}
