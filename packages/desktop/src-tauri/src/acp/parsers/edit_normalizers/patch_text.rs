use crate::acp::session_update::{EditDelta, ToolArguments};

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

/// Parse shared `patch_text`/`patchText` edit payloads into one `EditDelta` per
/// modified file.
pub(crate) fn parse_patch_text(raw_arguments: &serde_json::Value) -> Option<ToolArguments> {
    let patch_text = raw_arguments
        .get("patch_text")
        .or_else(|| raw_arguments.get("patchText"))
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())?;

    parse_patch_text_value(patch_text)
}

pub(crate) fn parse_patch_text_value(patch_text: &str) -> Option<ToolArguments> {
    let sections = parse_patch_sections(patch_text);

    if sections.is_empty() {
        return None;
    }

    if sections.len() == 1 {
        if let Some(move_arguments) = parse_move_section(&sections[0]) {
            return Some(move_arguments);
        }
        if let Some(delete_arguments) = parse_delete_section(&sections[0]) {
            return Some(delete_arguments);
        }
    }

    if let Some(delete_arguments) = parse_delete_sections(&sections) {
        return Some(delete_arguments);
    }

    let edits = parse_patch_text_sections_to_edits(sections);

    if edits.is_empty() {
        return None;
    }

    Some(ToolArguments::Edit { edits })
}

fn parse_patch_sections(patch_text: &str) -> Vec<PatchSection> {
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
}

fn parse_move_section(section: &PatchSection) -> Option<ToolArguments> {
    if !is_pure_move_section(section) {
        return None;
    }

    let destination_path = section.move_to.as_ref()?;

    Some(ToolArguments::Move {
        from: Some(section.file_path.clone()),
        to: Some(destination_path.clone()),
    })
}

fn parse_delete_section(section: &PatchSection) -> Option<ToolArguments> {
    if section.kind != PatchSectionKind::Delete || section.move_to.is_some() {
        return None;
    }

    Some(ToolArguments::Delete {
        file_path: Some(section.file_path.clone()),
        file_paths: None,
    })
}

fn parse_delete_sections(sections: &[PatchSection]) -> Option<ToolArguments> {
    if sections.is_empty()
        || sections
            .iter()
            .any(|section| section.kind != PatchSectionKind::Delete || section.move_to.is_some())
    {
        return None;
    }

    let file_paths: Vec<String> = sections
        .iter()
        .map(|section| section.file_path.clone())
        .collect();

    Some(ToolArguments::Delete {
        file_path: file_paths.first().cloned(),
        file_paths: Some(file_paths),
    })
}

fn parse_move_edit_entry(section: &PatchSection) -> Option<EditDelta> {
    if !is_pure_move_section(section) {
        return None;
    }

    let destination_path = section.move_to.as_ref()?;
    Some(EditDelta::WriteFile {
        file_path: Some(destination_path.clone()),
        move_from: Some(section.file_path.clone()),
        previous_content: None,
        content: None,
    })
}

fn is_pure_move_section(section: &PatchSection) -> bool {
    section.kind == PatchSectionKind::Update
        && section.move_to.is_some()
        && !section_has_diff_content(section)
}

fn section_has_diff_content(section: &PatchSection) -> bool {
    section.diff_lines.iter().any(|line| {
        line.starts_with('+')
            || line.starts_with('-')
            || line.starts_with(' ')
            || parse_inline_hunk_context(line).is_some()
            || (!line.is_empty() && !line.starts_with("@@"))
    })
}

fn parse_patch_text_sections_to_edits(sections: Vec<PatchSection>) -> Vec<EditDelta> {
    sections.into_iter().map(parse_patch_section).collect()
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

fn parse_patch_section(section: PatchSection) -> EditDelta {
    if let Some(move_entry) = parse_move_edit_entry(&section) {
        return move_entry;
    }

    let rendered_path = section.move_to.as_deref().unwrap_or(&section.file_path);
    let diff_lines = section.diff_lines.join("\n");

    if section.kind == PatchSectionKind::Delete {
        let old_text = diff_lines
            .lines()
            .filter_map(|line| line.strip_prefix('-').or_else(|| line.strip_prefix(' ')))
            .collect::<Vec<&str>>()
            .join("\n");
        return EditDelta::DeleteFile {
            file_path: Some(rendered_path.to_string()),
            old_text: if old_text.is_empty() {
                None
            } else {
                Some(old_text)
            },
        };
    }

    parse_file_diff_section(rendered_path, &diff_lines)
}

fn parse_file_diff_section(file_path: &str, diff_lines: &str) -> EditDelta {
    let mut old_lines: Vec<&str> = Vec::new();
    let mut new_lines: Vec<&str> = Vec::new();

    for line in diff_lines.lines() {
        if let Some(context) = parse_inline_hunk_context(line) {
            old_lines.push(context);
            new_lines.push(context);
            continue;
        }
        if line.starts_with("@@") {
            continue;
        }
        if let Some(stripped) = line.strip_prefix('-') {
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

    match (old_string, new_string) {
        (Some(old_text), Some(new_text)) => EditDelta::ReplaceText {
            file_path: Some(file_path.to_string()),
            move_from: None,
            old_text: Some(old_text),
            new_text: Some(new_text),
        },
        (None, Some(content)) => EditDelta::WriteFile {
            file_path: Some(file_path.to_string()),
            move_from: None,
            previous_content: None,
            content: Some(content),
        },
        (Some(old_text), None) => EditDelta::ReplaceText {
            file_path: Some(file_path.to_string()),
            move_from: None,
            old_text: Some(old_text),
            new_text: Some(String::new()),
        },
        (None, None) => EditDelta::ReplaceText {
            file_path: Some(file_path.to_string()),
            move_from: None,
            old_text: None,
            new_text: None,
        },
    }
}

fn parse_inline_hunk_context(line: &str) -> Option<&str> {
    let context = line.strip_prefix("@@ ")?;
    if context.trim().is_empty() || context.trim_end().ends_with("@@") {
        return None;
    }
    Some(context)
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
                assert_eq!(edits[0].file_path().map(String::as_str), Some("src/foo.ts"));
                assert_eq!(
                    edits[0].old_text().map(String::as_str),
                    Some("const value = 1;\nconst value = 1;")
                );
                assert_eq!(
                    edits[0].new_text().map(String::as_str),
                    Some("const value = 1;\nconst value = 2;")
                );
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
                assert_eq!(edits[0].file_path().map(String::as_str), Some("src/a.ts"));
                assert_eq!(edits[1].file_path().map(String::as_str), Some("src/b.ts"));
                assert!(edits[0]
                    .old_text()
                    .map(String::as_str)
                    .unwrap_or("")
                    .contains("A = 1"));
                assert!(edits[0]
                    .new_text()
                    .map(String::as_str)
                    .unwrap_or("")
                    .contains("A = 2"));
                assert!(edits[1]
                    .old_text()
                    .map(String::as_str)
                    .unwrap_or("")
                    .contains("B = \"hello\""));
                assert!(edits[1]
                    .new_text()
                    .map(String::as_str)
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
                assert_eq!(edits[0].file_path().map(String::as_str), Some("src/foo.ts"));
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
            ToolArguments::Delete {
                file_path,
                file_paths,
            } => {
                assert_eq!(file_path.as_deref(), Some("src/old.ts"));
                assert!(file_paths.is_none());
            }
            other => panic!("Expected Delete, got {other:?}"),
        }
    }

    #[test]
    fn parse_patch_text_supports_multi_delete_file_sections() {
        let patch = r#"*** Begin Patch
*** Delete File: src/old-a.ts
 old a
*** Delete File: src/old-b.ts
 old b
*** End Patch"#;

        let raw = serde_json::json!({ "patch_text": patch });
        let result = parse_patch_text(&raw).expect("should parse multi delete patch_text");

        match result {
            ToolArguments::Delete {
                file_path,
                file_paths,
            } => {
                assert_eq!(file_path.as_deref(), Some("src/old-a.ts"));
                assert_eq!(
                    file_paths,
                    Some(vec!["src/old-a.ts".to_string(), "src/old-b.ts".to_string()])
                );
            }
            other => panic!("Expected Delete, got {other:?}"),
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
                assert_eq!(edits[0].file_path().map(String::as_str), Some("src/new.ts"));
                assert_eq!(edits[0].old_text().map(String::as_str), Some("old"));
                assert_eq!(edits[0].new_text().map(String::as_str), Some("new"));
            }
            other => panic!("Expected Edit, got {other:?}"),
        }
    }

    #[test]
    fn parse_patch_text_emits_move_arguments_for_pure_rename_sections() {
        let patch = r#"*** Begin Patch
*** Update File: src/old.ts
*** Move to: src/new.ts
*** End Patch"#;

        let raw = serde_json::json!({ "patch_text": patch });
        let result = parse_patch_text(&raw).expect("should parse rename patch_text");

        match result {
            ToolArguments::Move { from, to } => {
                assert_eq!(from.as_deref(), Some("src/old.ts"));
                assert_eq!(to.as_deref(), Some("src/new.ts"));
            }
            other => panic!("Expected Move, got {other:?}"),
        }
    }

    #[test]
    fn parse_patch_text_preserves_inline_hunk_context_as_shared_context() {
        let patch = r#"*** Begin Patch
*** Update File: src/context.ts
@@ export const value = 1;
-export const value = 1;
+export const value = 2;
*** End Patch"#;

        let raw = serde_json::json!({ "patch_text": patch });
        let result = parse_patch_text(&raw).expect("should parse inline hunk context");

        match result {
            ToolArguments::Edit { edits } => {
                assert_eq!(edits.len(), 1);
                assert_eq!(
                    edits[0].old_text().map(String::as_str),
                    Some("export const value = 1;\nexport const value = 1;")
                );
                assert_eq!(
                    edits[0].new_text().map(String::as_str),
                    Some("export const value = 1;\nexport const value = 2;")
                );
            }
            other => panic!("Expected Edit, got {other:?}"),
        }
    }

    #[test]
    fn parse_patch_text_preserves_pure_rename_sections_inside_multi_file_patches() {
        let patch = r#"*** Begin Patch
*** Update File: src/old.ts
*** Move to: src/new.ts
*** Update File: src/other.ts
@@
-old
+new
*** End Patch"#;

        let raw = serde_json::json!({ "patch_text": patch });
        let result = parse_patch_text(&raw).expect("should parse mixed rename patch_text");

        match result {
            ToolArguments::Edit { edits } => {
                assert_eq!(edits.len(), 2);
                assert_eq!(edits[0].file_path().map(String::as_str), Some("src/new.ts"));
                assert_eq!(edits[0].move_from().map(String::as_str), Some("src/old.ts"));
                assert_eq!(edits[0].old_text(), None);
                assert_eq!(edits[0].new_text(), None);
                assert_eq!(
                    edits[1].file_path().map(String::as_str),
                    Some("src/other.ts")
                );
                assert_eq!(edits[1].old_text().map(String::as_str), Some("old"));
                assert_eq!(edits[1].new_text().map(String::as_str), Some("new"));
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
                    edits[0].new_text().map(String::as_str),
                    Some("Literal text: *** End Patch should appear in file")
                );
            }
            other => panic!("Expected Edit, got {other:?}"),
        }
    }

    #[test]
    fn parse_patch_text_keeps_deletion_only_update_hunks_as_replace_text() {
        let patch = r#"*** Begin Patch
*** Update File: src/remove-lines.ts
@@
-line one
-line two
*** End Patch"#;

        let raw = serde_json::json!({ "patch_text": patch });
        let result = parse_patch_text(&raw).expect("should parse deletion-only update");

        match result {
            ToolArguments::Edit { edits } => {
                assert_eq!(edits.len(), 1);
                match &edits[0] {
                    EditDelta::ReplaceText { old_text, new_text, .. } => {
                        assert_eq!(old_text.as_deref(), Some("line one\nline two"));
                        assert_eq!(new_text.as_deref(), Some(""));
                    }
                    other => panic!("Expected ReplaceText, got {other:?}"),
                }
            }
            other => panic!("Expected Edit, got {other:?}"),
        }
    }
}
