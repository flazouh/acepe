use crate::acp::session_update::{EditEntry, ToolArguments, ToolCallLocation};

pub(crate) fn title_is_placeholder(title: Option<&str>) -> bool {
    matches!(
        title.map(str::trim),
        None | Some("")
            | Some("Read File")
            | Some("Edit File")
            | Some("Delete File")
            | Some("View Image")
            | Some("Terminal")
            | Some("Apply Patch")
    )
}

pub(crate) fn synthesize_title(arguments: &ToolArguments) -> Option<String> {
    match arguments {
        ToolArguments::Read { file_path } => {
            file_path.as_ref().map(|path| format!("Read {}", path))
        }
        ToolArguments::Edit { edits, .. } => edits.first().and_then(synthesize_edit_title),
        ToolArguments::Delete {
            file_path,
            file_paths,
        } => {
            if let Some(paths) = file_paths.as_ref().filter(|paths| !paths.is_empty()) {
                if paths.len() == 1 {
                    return paths.first().map(|path| format!("Delete {}", path));
                }
                return Some(format!("Delete {} files", paths.len()));
            }

            file_path.as_ref().map(|path| format!("Delete {}", path))
        }
        ToolArguments::Execute { command } => command.clone(),
        _ => None,
    }
}

pub(crate) fn synthesize_locations(arguments: &ToolArguments) -> Option<Vec<ToolCallLocation>> {
    extract_paths(arguments).map(|paths| {
        paths
            .into_iter()
            .map(|path| ToolCallLocation { path })
            .collect()
    })
}

pub(crate) fn merge_edit_entries(
    current: Vec<EditEntry>,
    incoming: Vec<EditEntry>,
) -> Vec<EditEntry> {
    let max_len = current.len().max(incoming.len());
    let mut merged = Vec::with_capacity(max_len);

    for index in 0..max_len {
        let current_entry = current.get(index).cloned();
        let incoming_entry = incoming.get(index).cloned();

        let next_entry = match (current_entry, incoming_entry) {
            (Some(current_value), Some(incoming_value)) => EditEntry {
                file_path: incoming_value.file_path.or(current_value.file_path),
                move_from: incoming_value.move_from.or(current_value.move_from),
                old_string: incoming_value.old_string.or(current_value.old_string),
                new_string: incoming_value.new_string.or(current_value.new_string),
                content: incoming_value.content.or(current_value.content),
            },
            (Some(current_value), None) => current_value,
            (None, Some(incoming_value)) => incoming_value,
            (None, None) => continue,
        };

        merged.push(next_entry);
    }

    merged
}

pub(crate) fn merge_tool_arguments(
    current: ToolArguments,
    incoming: ToolArguments,
) -> ToolArguments {
    match (current, incoming) {
        (
            ToolArguments::Edit {
                edits: current_edits,
            },
            ToolArguments::Edit {
                edits: incoming_edits,
            },
        ) => ToolArguments::Edit {
            edits: merge_edit_entries(current_edits, incoming_edits),
        },
        (_, incoming_arguments) => incoming_arguments,
    }
}

fn extract_paths(arguments: &ToolArguments) -> Option<Vec<String>> {
    match arguments {
        ToolArguments::Read { file_path } | ToolArguments::Search { file_path, .. } => {
            file_path.clone().map(|path| vec![path])
        }
        ToolArguments::Delete {
            file_path,
            file_paths,
        } => file_paths
            .clone()
            .filter(|paths| !paths.is_empty())
            .or_else(|| file_path.clone().map(|path| vec![path])),
        ToolArguments::Edit { edits, .. } => edits
            .first()
            .and_then(|edit| edit.file_path.clone())
            .map(|path| vec![path]),
        ToolArguments::Glob { path, .. } => path.clone().map(|value| vec![value]),
        _ => None,
    }
}

fn synthesize_edit_title(edit: &EditEntry) -> Option<String> {
    if let (Some(from), Some(to)) = (edit.move_from.as_ref(), edit.file_path.as_ref()) {
        return Some(format!("Rename {} -> {}", from, to));
    }

    edit.file_path.as_ref().map(|path| format!("Edit {}", path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_placeholder_titles_after_trim() {
        assert!(title_is_placeholder(Some(" Read File ")));
        assert!(title_is_placeholder(Some("Edit File")));
        assert!(title_is_placeholder(Some("Delete File")));
        assert!(title_is_placeholder(Some("View Image")));
        assert!(title_is_placeholder(Some("Terminal")));
        assert!(title_is_placeholder(Some("Apply Patch")));
        assert!(title_is_placeholder(None));
    }

    #[test]
    fn preserves_explicit_titles_as_non_placeholders() {
        assert!(!title_is_placeholder(Some("Read README.md")));
        assert!(!title_is_placeholder(Some("Edit /tmp/example.rs")));
        assert!(!title_is_placeholder(Some(
            "Rename src/old.rs -> src/new.rs"
        )));
        assert!(!title_is_placeholder(Some("Apply patch to README")));
    }

    #[test]
    fn synthesizes_titles_from_canonical_arguments() {
        assert_eq!(
            synthesize_title(&ToolArguments::Read {
                file_path: Some("/tmp/read.rs".to_string()),
            }),
            Some("Read /tmp/read.rs".to_string())
        );

        assert_eq!(
            synthesize_title(&ToolArguments::Delete {
                file_path: Some("/tmp/delete.rs".to_string()),
                file_paths: None,
            }),
            Some("Delete /tmp/delete.rs".to_string())
        );

        assert_eq!(
            synthesize_title(&ToolArguments::Delete {
                file_path: Some("/tmp/delete-a.rs".to_string()),
                file_paths: Some(vec![
                    "/tmp/delete-a.rs".to_string(),
                    "/tmp/delete-b.rs".to_string()
                ]),
            }),
            Some("Delete 2 files".to_string())
        );

        assert_eq!(
            synthesize_title(&ToolArguments::Edit {
                edits: vec![EditEntry {
                    file_path: Some("/tmp/new.rs".to_string()),
                    move_from: Some("/tmp/old.rs".to_string()),
                    old_string: None,
                    new_string: None,
                    content: None,
                }],
            }),
            Some("Rename /tmp/old.rs -> /tmp/new.rs".to_string())
        );

        assert_eq!(
            synthesize_title(&ToolArguments::Execute {
                command: Some("bun test".to_string()),
            }),
            Some("bun test".to_string())
        );
    }

    #[test]
    fn synthesizes_locations_from_canonical_arguments() {
        let locations = synthesize_locations(&ToolArguments::Edit {
            edits: vec![EditEntry {
                file_path: Some("/tmp/file.rs".to_string()),
                move_from: None,
                old_string: None,
                new_string: None,
                content: None,
            }],
        })
        .expect("locations");

        assert_eq!(locations.len(), 1);
        assert_eq!(locations[0].path, "/tmp/file.rs");

        let delete_locations = synthesize_locations(&ToolArguments::Delete {
            file_path: Some("/tmp/delete-a.rs".to_string()),
            file_paths: Some(vec![
                "/tmp/delete-a.rs".to_string(),
                "/tmp/delete-b.rs".to_string(),
            ]),
        })
        .expect("delete locations");

        assert_eq!(delete_locations.len(), 2);
        assert_eq!(delete_locations[0].path, "/tmp/delete-a.rs");
        assert_eq!(delete_locations[1].path, "/tmp/delete-b.rs");
    }

    #[test]
    fn merges_sparse_edit_entries_without_dropping_richer_metadata() {
        let current = vec![EditEntry {
            file_path: Some("/tmp/new.rs".to_string()),
            move_from: Some("/tmp/old.rs".to_string()),
            old_string: Some("before".to_string()),
            new_string: Some("after".to_string()),
            content: None,
        }];
        let incoming = vec![EditEntry {
            file_path: None,
            move_from: None,
            old_string: None,
            new_string: None,
            content: Some("full content".to_string()),
        }];

        let merged = merge_edit_entries(current, incoming);

        assert_eq!(merged.len(), 1);
        let edit = &merged[0];
        assert_eq!(edit.file_path.as_deref(), Some("/tmp/new.rs"));
        assert_eq!(edit.move_from.as_deref(), Some("/tmp/old.rs"));
        assert_eq!(edit.old_string.as_deref(), Some("before"));
        assert_eq!(edit.new_string.as_deref(), Some("after"));
        assert_eq!(edit.content.as_deref(), Some("full content"));
    }
}
