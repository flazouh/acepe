use crate::acp::parsers::AgentType;
use crate::acp::session_update::ToolCallUpdateData;
use crate::acp::tool_call_presentation::{
    merge_tool_arguments, synthesize_locations, synthesize_title, title_is_placeholder,
};
use crate::session_jsonl::types::{ConvertedSession, FullSession, StoredEntry};

#[derive(serde::Deserialize)]
struct StreamingLogEntry {
    direction: String,
    data: serde_json::Value,
}

#[allow(dead_code)]
pub(crate) fn convert_cursor_full_session_to_entries(session: &FullSession) -> ConvertedSession {
    let mut converted =
        super::fullsession::convert_full_session_to_entries_with_agent(session, AgentType::Cursor);
    overlay_streaming_tool_updates(&session.session_id, &mut converted);
    converted
}

fn overlay_streaming_tool_updates(session_id: &str, converted: &mut ConvertedSession) {
    let Some(log_path) = crate::acp::streaming_log::get_log_file_path(session_id) else {
        return;
    };

    let Ok(content) = std::fs::read_to_string(&log_path) else {
        tracing::warn!(
            session_id = %session_id,
            path = %log_path.display(),
            "Failed to read Cursor streaming log for session overlay"
        );
        return;
    };

    for line in content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        let Ok(entry) = serde_json::from_str::<StreamingLogEntry>(line) else {
            continue;
        };

        if entry.direction != "out" {
            continue;
        }

        let Some(update_value) = entry
            .data
            .get("type")
            .and_then(|value| value.as_str())
            .filter(|value| *value == "toolCallUpdate")
            .and_then(|_| entry.data.get("update"))
            .cloned()
        else {
            continue;
        };

        let Ok(update) = serde_json::from_value::<ToolCallUpdateData>(update_value) else {
            continue;
        };

        apply_tool_call_update(converted, &update);
    }
}

fn apply_tool_call_update(converted: &mut ConvertedSession, update: &ToolCallUpdateData) {
    let Some(tool_call) = converted.entries.iter_mut().find_map(|entry| match entry {
        StoredEntry::ToolCall { id, message, .. } if id == &update.tool_call_id => Some(message),
        _ => None,
    }) else {
        return;
    };

    let normalized_update = normalize_cursor_tool_call_update(tool_call, update);
    super::merge_tool_call_update(tool_call, &normalized_update);

    if tool_call.locations.is_none() {
        tool_call.locations = synthesize_locations(&tool_call.arguments);
    }

    if title_is_placeholder(tool_call.title.as_deref()) {
        tool_call.title = synthesize_title(&tool_call.arguments).or(tool_call.title.clone());
    }
}

fn normalize_cursor_tool_call_update(
    tool_call: &crate::acp::session_update::ToolCallData,
    update: &ToolCallUpdateData,
) -> ToolCallUpdateData {
    let mut normalized = update.clone();

    if let Some(arguments) = update
        .arguments
        .as_ref()
        .or(update.streaming_arguments.as_ref())
    {
        let merged_arguments = merge_tool_arguments(tool_call.arguments.clone(), arguments.clone());

        if update.arguments.is_some() {
            normalized.arguments = Some(merged_arguments.clone());
        }
        if update.streaming_arguments.is_some() {
            normalized.streaming_arguments = Some(merged_arguments.clone());
        }
        if normalized.locations.is_none() {
            normalized.locations = synthesize_locations(&merged_arguments);
        }
        if title_is_placeholder(normalized.title.as_deref())
            && title_is_placeholder(tool_call.title.as_deref())
        {
            normalized.title = synthesize_title(&merged_arguments).or(normalized.title);
        }

        return normalized;
    }

    if normalized.locations.is_none() {
        normalized.locations = tool_call
            .locations
            .clone()
            .or_else(|| synthesize_locations(&tool_call.arguments));
    }

    if title_is_placeholder(normalized.title.as_deref())
        && title_is_placeholder(tool_call.title.as_deref())
    {
        normalized.title = synthesize_title(&tool_call.arguments).or(normalized.title);
    }

    normalized
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::session_update::{
        SessionUpdate, ToolArguments, ToolCallData, ToolCallStatus, ToolKind,
    };
    use crate::acp::streaming_log::{clear_session_log, log_emitted_event};
    use crate::session_jsonl::types::SessionStats;

    #[test]
    fn overlays_edit_arguments_from_streaming_log() {
        let session_id = "cursor-streaming-overlay-edit-test";
        let _ = clear_session_log(session_id);

        let emitted_update = SessionUpdate::ToolCallUpdate {
            update: ToolCallUpdateData {
                tool_call_id: "tool-edit-1".to_string(),
                status: Some(ToolCallStatus::Completed),
                result: Some(serde_json::json!([
                    {
                        "type": "diff",
                        "path": "/tmp/CLAUDE.md",
                        "oldText": "Look at AGENTS.md",
                        "newText": "Look at AGENTS.md."
                    }
                ])),
                content: None,
                raw_output: None,
                title: None,
                locations: None,
                streaming_input_delta: None,
                normalized_todos: None,
                normalized_questions: None,
                streaming_arguments: None,
                streaming_plan: None,
                arguments: Some(ToolArguments::Edit {
                    edits: vec![crate::acp::session_update::EditDelta::replace_text(
                        Some("/tmp/CLAUDE.md".to_string()),
                        None,
                        Some("Look at AGENTS.md".to_string()),
                        Some("Look at AGENTS.md.".to_string()),
                    )],
                }),
                failure_reason: None,
            },
            session_id: Some(session_id.to_string()),
        };

        log_emitted_event(session_id, &emitted_update);

        let mut converted = ConvertedSession {
            entries: vec![StoredEntry::ToolCall {
                id: "tool-edit-1".to_string(),
                message: ToolCallData {
                    id: "tool-edit-1".to_string(),
                    name: "Edit".to_string(),
                    arguments: ToolArguments::Edit {
                        edits: vec![crate::acp::session_update::EditDelta::replace_text(
                            None, None, None, None,
                        )],
                    },
                    raw_input: None,
                    status: ToolCallStatus::Pending,
                    result: None,
                    kind: Some(ToolKind::Edit),
                    title: Some("Apply Patch".to_string()),
                    locations: None,
                    skill_meta: None,
                    normalized_questions: None,
                    normalized_todos: None,
                    parent_tool_use_id: None,
                    task_children: None,
                    question_answer: None,
                    awaiting_plan_approval: false,
                    plan_approval_request_id: None,
                },
                timestamp: Some("2026-03-20T07:49:55.869382+00:00".to_string()),
            }],
            stats: SessionStats::default(),
            title: "Cursor Session".to_string(),
            created_at: "2026-03-20T07:49:55.000000+00:00".to_string(),
            current_mode_id: None,
        };

        overlay_streaming_tool_updates(session_id, &mut converted);

        let StoredEntry::ToolCall { message, .. } = &converted.entries[0] else {
            panic!("expected tool call entry");
        };

        assert_eq!(message.status, ToolCallStatus::Completed);
        match &message.arguments {
            ToolArguments::Edit { edits } => {
                let e = edits.first().expect("edit entry");
                assert_eq!(e.file_path().map(String::as_str), Some("/tmp/CLAUDE.md"));
                assert_eq!(e.old_text().map(String::as_str), Some("Look at AGENTS.md"));
                assert_eq!(e.new_text().map(String::as_str), Some("Look at AGENTS.md."));
            }
            other => panic!("expected edit arguments, got {:?}", other),
        }

        let _ = clear_session_log(session_id);
    }

    #[test]
    fn overlays_rename_title_and_move_metadata_from_streaming_log() {
        let session_id = "cursor-streaming-overlay-rename-test";
        let _ = clear_session_log(session_id);

        let emitted_update = SessionUpdate::ToolCallUpdate {
            update: ToolCallUpdateData {
                tool_call_id: "tool-rename-1".to_string(),
                status: Some(ToolCallStatus::Completed),
                result: None,
                content: None,
                raw_output: None,
                title: Some("Apply Patch".to_string()),
                locations: None,
                streaming_input_delta: None,
                normalized_todos: None,
                normalized_questions: None,
                streaming_arguments: None,
                streaming_plan: None,
                arguments: Some(ToolArguments::Edit {
                    edits: vec![crate::acp::session_update::EditDelta::write_file(
                        Some("/tmp/new.rs".to_string()),
                        Some("/tmp/old.rs".to_string()),
                        None,
                        None,
                    )],
                }),
                failure_reason: None,
            },
            session_id: Some(session_id.to_string()),
        };

        log_emitted_event(session_id, &emitted_update);

        let mut converted = ConvertedSession {
            entries: vec![StoredEntry::ToolCall {
                id: "tool-rename-1".to_string(),
                message: ToolCallData {
                    id: "tool-rename-1".to_string(),
                    name: "Edit".to_string(),
                    arguments: ToolArguments::Edit {
                        edits: vec![crate::acp::session_update::EditDelta::replace_text(
                            None, None, None, None,
                        )],
                    },
                    raw_input: None,
                    status: ToolCallStatus::Pending,
                    result: None,
                    kind: Some(ToolKind::Edit),
                    title: Some("Apply Patch".to_string()),
                    locations: None,
                    skill_meta: None,
                    normalized_questions: None,
                    normalized_todos: None,
                    parent_tool_use_id: None,
                    task_children: None,
                    question_answer: None,
                    awaiting_plan_approval: false,
                    plan_approval_request_id: None,
                },
                timestamp: Some("2026-03-20T07:49:55.869382+00:00".to_string()),
            }],
            stats: SessionStats::default(),
            title: "Cursor Session".to_string(),
            created_at: "2026-03-20T07:49:55.000000+00:00".to_string(),
            current_mode_id: None,
        };

        overlay_streaming_tool_updates(session_id, &mut converted);

        let StoredEntry::ToolCall { message, .. } = &converted.entries[0] else {
            panic!("expected tool call entry");
        };

        assert_eq!(message.status, ToolCallStatus::Completed);
        assert_eq!(
            message.title.as_deref(),
            Some("Rename /tmp/old.rs -> /tmp/new.rs")
        );
        match &message.arguments {
            ToolArguments::Edit { edits } => {
                let edit = edits.first().expect("edit entry");
                assert_eq!(edit.file_path().map(String::as_str), Some("/tmp/new.rs"));
                assert_eq!(edit.move_from().map(String::as_str), Some("/tmp/old.rs"));
            }
            other => panic!("expected edit arguments, got {:?}", other),
        }

        let _ = clear_session_log(session_id);
    }

    #[test]
    fn preserves_explicit_replay_title_when_argument_overlay_has_no_title() {
        let session_id = "cursor-streaming-overlay-explicit-title-test";
        let _ = clear_session_log(session_id);

        let emitted_update = SessionUpdate::ToolCallUpdate {
            update: ToolCallUpdateData {
                tool_call_id: "tool-read-1".to_string(),
                status: Some(ToolCallStatus::Completed),
                result: None,
                content: None,
                raw_output: None,
                title: None,
                locations: None,
                streaming_input_delta: None,
                normalized_todos: None,
                normalized_questions: None,
                streaming_arguments: None,
                streaming_plan: None,
                arguments: Some(ToolArguments::Read {
                    file_path: Some("/tmp/README.md".to_string()),
                }),
                failure_reason: None,
            },
            session_id: Some(session_id.to_string()),
        };

        log_emitted_event(session_id, &emitted_update);

        let mut converted = ConvertedSession {
            entries: vec![StoredEntry::ToolCall {
                id: "tool-read-1".to_string(),
                message: ToolCallData {
                    id: "tool-read-1".to_string(),
                    name: "Read".to_string(),
                    arguments: ToolArguments::Read { file_path: None },
                    raw_input: None,
                    status: ToolCallStatus::Pending,
                    result: None,
                    kind: Some(ToolKind::Read),
                    title: Some("Read README.md".to_string()),
                    locations: None,
                    skill_meta: None,
                    normalized_questions: None,
                    normalized_todos: None,
                    parent_tool_use_id: None,
                    task_children: None,
                    question_answer: None,
                    awaiting_plan_approval: false,
                    plan_approval_request_id: None,
                },
                timestamp: Some("2026-03-20T07:49:55.869382+00:00".to_string()),
            }],
            stats: SessionStats::default(),
            title: "Cursor Session".to_string(),
            created_at: "2026-03-20T07:49:55.000000+00:00".to_string(),
            current_mode_id: None,
        };

        overlay_streaming_tool_updates(session_id, &mut converted);

        let StoredEntry::ToolCall { message, .. } = &converted.entries[0] else {
            panic!("expected tool call entry");
        };

        assert_eq!(message.status, ToolCallStatus::Completed);
        assert_eq!(message.title.as_deref(), Some("Read README.md"));
        match &message.arguments {
            ToolArguments::Read { file_path } => {
                assert_eq!(file_path.as_deref(), Some("/tmp/README.md"));
            }
            other => panic!("expected read arguments, got {:?}", other),
        }

        let _ = clear_session_log(session_id);
    }
}
