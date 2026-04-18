use std::sync::OnceLock;

use super::types::{
    QuestionItem, QuestionOption, TodoItem, TodoStatus, TodoUpdate, TodoUpdateOperation,
};
use crate::acp::parsers::{get_parser, AgentType};
use regex::Regex;

/// Parse and normalize questions from a tool call if it's a question tool.
///
/// This provides a unified question format regardless of which agent sent the tool call.
/// Currently supports Claude Code and OpenCode question formats.
pub fn parse_normalized_questions(
    name: &str,
    raw_input: &serde_json::Value,
    agent_type: AgentType,
) -> Option<Vec<QuestionItem>> {
    let parser = get_parser(agent_type);
    let parsed_questions = parser.parse_questions(name, raw_input);

    // Convert ParsedQuestion to QuestionItem
    parsed_questions.map(|questions| {
        questions
            .into_iter()
            .map(|q| QuestionItem {
                question: q.question,
                header: q.header,
                options: q
                    .options
                    .into_iter()
                    .map(|opt| QuestionOption {
                        label: opt.label,
                        description: opt.description,
                    })
                    .collect(),
                multi_select: q.multi_select,
            })
            .collect()
    })
}

/// Parse and normalize todos from a tool call if it's a TodoWrite tool.
///
/// This provides a unified todo format regardless of which agent sent the tool call.
pub fn parse_normalized_todos(
    name: &str,
    raw_input: &serde_json::Value,
    agent_type: AgentType,
) -> Option<Vec<TodoItem>> {
    parse_normalized_todo_update(name, raw_input, agent_type).and_then(|update| update.items)
}

pub fn parse_normalized_todo_update(
    name: &str,
    raw_input: &serde_json::Value,
    agent_type: AgentType,
) -> Option<TodoUpdate> {
    use crate::acp::parsers::ParsedTodoStatus;

    let parser = get_parser(agent_type);
    let parsed_todos = parser.parse_todos(name, raw_input);
    let query = raw_input.get("query").and_then(|value| value.as_str());

    if let Some(todos) = parsed_todos {
        let items = todos
            .into_iter()
            .map(|t| TodoItem {
                content: t.content,
                active_form: t.active_form,
                status: match t.status {
                    ParsedTodoStatus::Pending => TodoStatus::Pending,
                    ParsedTodoStatus::InProgress => TodoStatus::InProgress,
                    ParsedTodoStatus::Completed => TodoStatus::Completed,
                    ParsedTodoStatus::Cancelled => TodoStatus::Cancelled,
                },
                started_at: None,
                completed_at: None,
                duration: None,
            })
            .collect::<Vec<_>>();

        let operation = query
            .and_then(classify_sql_todo_update_operation)
            .unwrap_or(TodoUpdateOperation::Replace);
        return Some(TodoUpdate {
            operation,
            items: Some(items),
            from_statuses: None,
            to_status: None,
        });
    }

    query.and_then(parse_bulk_status_filter_update)
}

pub(crate) fn derive_normalized_questions_and_todos(
    name: &str,
    raw_input: &serde_json::Value,
    agent_type: AgentType,
) -> (
    Option<Vec<QuestionItem>>,
    Option<Vec<TodoItem>>,
    Option<TodoUpdate>,
) {
    let todo_update = parse_normalized_todo_update(name, raw_input, agent_type);
    let todos = todo_update.as_ref().and_then(|update| update.items.clone());
    (
        parse_normalized_questions(name, raw_input, agent_type),
        todos,
        todo_update,
    )
}

fn classify_sql_todo_update_operation(query: &str) -> Option<TodoUpdateOperation> {
    let lower = query.to_ascii_lowercase();
    if lower.contains("insert into todos") || lower.contains("insert or replace into todos") {
        return Some(TodoUpdateOperation::Upsert);
    }
    if lower.contains("update todos") {
        return Some(TodoUpdateOperation::SetStatus);
    }
    None
}

fn parse_bulk_status_filter_update(query: &str) -> Option<TodoUpdate> {
    let captures = sql_status_filter_in_regex().captures(query)?;
    let to_status = captures
        .get(1)
        .and_then(|capture| parse_todo_status(capture.as_str()))?;
    let from_statuses = captures
        .get(2)
        .map(|capture| capture.as_str())
        .map(split_sql_status_list)?;
    if from_statuses.is_empty() {
        return None;
    }
    Some(TodoUpdate {
        operation: TodoUpdateOperation::SetStatusByFilter,
        items: None,
        from_statuses: Some(from_statuses),
        to_status: Some(to_status),
    })
}

fn split_sql_status_list(segment: &str) -> Vec<TodoStatus> {
    segment
        .split(',')
        .filter_map(|token| parse_sql_literal(token))
        .filter_map(|status| parse_todo_status(&status))
        .collect()
}

fn parse_sql_literal(token: &str) -> Option<String> {
    let trimmed = token.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("null") {
        return None;
    }
    if trimmed.starts_with('\'') && trimmed.ends_with('\'') && trimmed.len() >= 2 {
        return Some(trimmed[1..trimmed.len() - 1].replace("''", "'"));
    }
    Some(trimmed.to_string())
}

fn parse_todo_status(value: &str) -> Option<TodoStatus> {
    match value.trim().to_ascii_lowercase().as_str() {
        "pending" => Some(TodoStatus::Pending),
        "in_progress" => Some(TodoStatus::InProgress),
        "done" | "completed" => Some(TodoStatus::Completed),
        "cancelled" | "canceled" => Some(TodoStatus::Cancelled),
        _ => None,
    }
}

fn sql_status_filter_in_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"(?is)\bupdate\s+todos\s+set\s+status\s*=\s*'([^']+)'.*?\bwhere\s+status\s+in\s*\(([^)]*)\)")
            .expect("valid SQL status filter regex")
    })
}
