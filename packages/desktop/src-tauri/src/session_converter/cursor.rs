use crate::acp::parsers::AgentType;
use crate::acp::session_update::{ToolCallData, ToolCallStatus, ToolCallUpdateData};
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

    merge_tool_call_update(tool_call, update);
}

fn merge_tool_call_update(tool_call: &mut ToolCallData, update: &ToolCallUpdateData) {
    if let Some(status) = &update.status {
        if !is_terminal_status(&tool_call.status) || is_terminal_status(status) {
            tool_call.status = status.clone();
        }
    }

    if let Some(title) = &update.title {
        tool_call.title = Some(title.clone());
    }

    if let Some(locations) = &update.locations {
        tool_call.locations = Some(locations.clone());
    }

    if let Some(arguments) = update
        .arguments
        .as_ref()
        .or(update.streaming_arguments.as_ref())
    {
        tool_call.arguments = arguments.clone();
    }

    if tool_call.result.is_none() {
        if let Some(result) = &update.result {
            tool_call.result = Some(result.clone());
        }
    }

    if let Some(normalized_questions) = &update.normalized_questions {
        tool_call.normalized_questions = Some(normalized_questions.clone());
    }

    if let Some(normalized_todos) = &update.normalized_todos {
        tool_call.normalized_todos = Some(normalized_todos.clone());
    }
}

fn is_terminal_status(status: &ToolCallStatus) -> bool {
    matches!(status, ToolCallStatus::Completed | ToolCallStatus::Failed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::session_update::{SessionUpdate, ToolArguments, ToolKind};
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
                    file_path: Some("/tmp/CLAUDE.md".to_string()),
                    old_string: Some("Look at AGENTS.md".to_string()),
                    new_string: Some("Look at AGENTS.md.".to_string()),
                    content: None,
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
                        file_path: None,
                        old_string: None,
                        new_string: None,
                        content: None,
                    },
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
        };

        overlay_streaming_tool_updates(session_id, &mut converted);

        let StoredEntry::ToolCall { message, .. } = &converted.entries[0] else {
            panic!("expected tool call entry");
        };

        assert_eq!(message.status, ToolCallStatus::Completed);
        match &message.arguments {
            ToolArguments::Edit {
                file_path,
                old_string,
                new_string,
                ..
            } => {
                assert_eq!(file_path.as_deref(), Some("/tmp/CLAUDE.md"));
                assert_eq!(old_string.as_deref(), Some("Look at AGENTS.md"));
                assert_eq!(new_string.as_deref(), Some("Look at AGENTS.md."));
            }
            other => panic!("expected edit arguments, got {:?}", other),
        }

        let _ = clear_session_log(session_id);
    }
}
