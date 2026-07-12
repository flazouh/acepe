use crate::acp::session_update::{TodoStatus, ToolCallData, ToolCallStatus, ToolCallUpdateData};
use crate::session_jsonl::types::StoredEntry;
use std::collections::HashMap;

pub fn merge_tool_call_update(tool_call: &mut ToolCallData, update: &ToolCallUpdateData) {
    if let Some(status) = &update.status {
        if !is_terminal_tool_call_status(&tool_call.status) || is_terminal_tool_call_status(status)
        {
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

fn is_terminal_tool_call_status(status: &ToolCallStatus) -> bool {
    matches!(status, ToolCallStatus::Completed | ToolCallStatus::Failed)
}

pub fn calculate_todo_timing(entries: &mut [StoredEntry]) {
    let mut task_timings: HashMap<String, (Option<i64>, Option<i64>)> = HashMap::new();
    let mut previous_states: HashMap<String, TodoStatus> = HashMap::new();

    for entry in entries.iter() {
        if let StoredEntry::ToolCall {
            message, timestamp, ..
        } = entry
        {
            if let Some(todos) = &message.normalized_todos {
                let entry_timestamp = timestamp
                    .as_ref()
                    .and_then(|t| parse_timestamp_to_millis(t));

                for todo in todos {
                    let prev_status = previous_states.get(&todo.content);
                    let timing = task_timings
                        .entry(todo.content.clone())
                        .or_insert((None, None));

                    if todo.status == TodoStatus::InProgress
                        && prev_status != Some(&TodoStatus::InProgress)
                    {
                        timing.0 = entry_timestamp;
                    }

                    if todo.status == TodoStatus::Completed
                        && prev_status != Some(&TodoStatus::Completed)
                    {
                        timing.1 = entry_timestamp;
                    }

                    previous_states.insert(todo.content.clone(), todo.status);
                }
            }
        }
    }

    for entry in entries.iter_mut() {
        if let StoredEntry::ToolCall { message, .. } = entry {
            if let Some(todos) = &mut message.normalized_todos {
                for todo in todos.iter_mut() {
                    if let Some((started_at, completed_at)) = task_timings.get(&todo.content) {
                        todo.started_at = *started_at;
                        todo.completed_at = *completed_at;

                        if let (Some(start), Some(end)) = (started_at, completed_at) {
                            let duration = end - start;
                            if duration >= 0 {
                                todo.duration = Some(duration);
                            }
                        }
                    }
                }
            }
        }
    }
}

fn parse_timestamp_to_millis(timestamp: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(timestamp)
        .ok()
        .map(|dt| dt.timestamp_millis())
}
