//! Cursor SQL todo parsing — extracts todo updates from Cursor's SQL `query` tool arguments.
//!
//! Cursor agents persist todos via SQL statements against a `todos` table rather than
//! the JSON `todos` array used by Claude/Codex TodoWrite tools.

use std::sync::OnceLock;

use regex::Regex;

use crate::acp::parsers::parsed_todo::{ParsedTodo, ParsedTodoStatus};

/// Parse todo updates from Cursor SQL `query` tool arguments.
///
/// Returns `None` if `arguments` lacks a `query` field or no todo-related SQL is found.
pub(crate) fn parse_sql_todo_updates(arguments: &serde_json::Value) -> Option<Vec<ParsedTodo>> {
    let query = arguments.get("query").and_then(|value| value.as_str())?;
    let mut parsed = Vec::new();

    for statement in split_sql_statements(query) {
        let trimmed = statement.trim();
        if trimmed.is_empty() {
            continue;
        }

        if let Some(mut statement_todos) = parse_sql_todo_statement(trimmed) {
            parsed.append(&mut statement_todos);
        }
    }

    if parsed.is_empty() {
        None
    } else {
        Some(parsed)
    }
}

fn parse_sql_todo_statement(statement: &str) -> Option<Vec<ParsedTodo>> {
    let lower = statement.to_ascii_lowercase();
    if !lower.contains("todos") {
        return None;
    }

    if let Some(parsed) = parse_sql_todo_insert_statement(statement) {
        return Some(parsed);
    }

    if !lower.starts_with("update todos") {
        return None;
    }

    if let Some(parsed) = parse_sql_todo_case_status_updates(statement) {
        return Some(parsed);
    }

    let status =
        extract_sql_status_assignment(statement).and_then(|value| parse_sql_todo_status(&value))?;
    let todo_ids = extract_sql_where_ids(statement)?;
    let parsed = todo_ids
        .into_iter()
        .map(|todo_id| {
            let content = humanize_sql_todo_identifier(&todo_id);
            ParsedTodo {
                content: content.clone(),
                active_form: content,
                status,
            }
        })
        .collect::<Vec<_>>();

    if parsed.is_empty() {
        None
    } else {
        Some(parsed)
    }
}

fn parse_sql_todo_insert_statement(statement: &str) -> Option<Vec<ParsedTodo>> {
    let lower = statement.to_ascii_lowercase();
    if !(lower.starts_with("insert into todos")
        || lower.starts_with("insert or replace into todos"))
    {
        return None;
    }

    let values_index = lower.find("values")?;
    let before_values = &statement[..values_index];
    let columns_start = before_values.find('(')?;
    let columns_end = before_values.rfind(')')?;
    let columns = before_values[columns_start + 1..columns_end]
        .split(',')
        .map(|column| column.trim().trim_matches('"').to_ascii_lowercase())
        .collect::<Vec<_>>();

    let id_index = columns.iter().position(|column| column == "id");
    let title_index = columns.iter().position(|column| column == "title");
    let status_index = columns.iter().position(|column| column == "status")?;
    let tuples = parse_sql_value_tuples(&statement[values_index + "values".len()..]);

    let mut parsed = Vec::new();
    for tuple in tuples {
        let status = tuple
            .get(status_index)
            .and_then(|value| parse_sql_literal_token(value))
            .and_then(|value| parse_sql_todo_status(&value));
        let todo_id = id_index
            .and_then(|index| tuple.get(index))
            .and_then(|value| parse_sql_literal_token(value))
            .filter(|value| !value.is_empty());
        let title = title_index
            .and_then(|index| tuple.get(index))
            .and_then(|value| parse_sql_literal_token(value))
            .filter(|value| !value.is_empty());
        let (Some(status), Some(content)) = (
            status,
            title.or_else(|| todo_id.map(|id| humanize_sql_todo_identifier(&id))),
        ) else {
            continue;
        };

        parsed.push(ParsedTodo {
            content: content.clone(),
            active_form: content,
            status,
        });
    }

    if parsed.is_empty() {
        None
    } else {
        Some(parsed)
    }
}

fn parse_sql_todo_case_status_updates(statement: &str) -> Option<Vec<ParsedTodo>> {
    if !statement.to_ascii_lowercase().contains("status = case id") {
        return None;
    }

    let parsed = sql_case_when_regex()
        .captures_iter(statement)
        .filter_map(|captures| {
            let todo_id = captures.get(1).map(|capture| capture.as_str().trim())?;
            let status = captures
                .get(2)
                .map(|capture| capture.as_str())
                .and_then(parse_sql_todo_status)?;
            let content = humanize_sql_todo_identifier(todo_id);
            Some(ParsedTodo {
                content: content.clone(),
                active_form: content,
                status,
            })
        })
        .collect::<Vec<_>>();

    if parsed.is_empty() {
        None
    } else {
        Some(parsed)
    }
}

fn split_sql_statements(query: &str) -> Vec<String> {
    let mut statements = Vec::new();
    let mut current = String::new();
    let mut in_single_quote = false;
    let mut characters = query.chars().peekable();

    while let Some(character) = characters.next() {
        match character {
            '\'' => {
                current.push(character);
                if in_single_quote && matches!(characters.peek(), Some('\'')) {
                    current.push(characters.next().expect("peeked quote"));
                    continue;
                }
                in_single_quote = !in_single_quote;
            }
            ';' if !in_single_quote => {
                let statement = current.trim();
                if !statement.is_empty() {
                    statements.push(statement.to_string());
                }
                current.clear();
            }
            _ => current.push(character),
        }
    }

    let statement = current.trim();
    if !statement.is_empty() {
        statements.push(statement.to_string());
    }

    statements
}

fn parse_sql_value_tuples(values_section: &str) -> Vec<Vec<String>> {
    let mut tuples = Vec::new();
    let mut tuple_start = None;
    let mut depth = 0;
    let mut in_single_quote = false;
    let mut characters = values_section.char_indices().peekable();

    while let Some((index, character)) = characters.next() {
        match character {
            '\'' => {
                if in_single_quote && matches!(characters.peek(), Some((_, '\''))) {
                    characters.next();
                    continue;
                }
                in_single_quote = !in_single_quote;
            }
            '(' if !in_single_quote => {
                depth += 1;
                if depth == 1 {
                    tuple_start = Some(index + 1);
                }
            }
            ')' if !in_single_quote => {
                if depth == 1 {
                    if let Some(start) = tuple_start.take() {
                        tuples.push(split_sql_csv(&values_section[start..index]));
                    }
                }
                if depth > 0 {
                    depth -= 1;
                }
            }
            _ => {}
        }
    }

    tuples
}

fn split_sql_csv(segment: &str) -> Vec<String> {
    let mut values = Vec::new();
    let mut current = String::new();
    let mut in_single_quote = false;
    let mut characters = segment.chars().peekable();

    while let Some(character) = characters.next() {
        match character {
            '\'' => {
                current.push(character);
                if in_single_quote && matches!(characters.peek(), Some('\'')) {
                    current.push(characters.next().expect("peeked quote"));
                    continue;
                }
                in_single_quote = !in_single_quote;
            }
            ',' if !in_single_quote => {
                values.push(current.trim().to_string());
                current.clear();
            }
            _ => current.push(character),
        }
    }

    if !current.trim().is_empty() {
        values.push(current.trim().to_string());
    }

    values
}

fn extract_sql_status_assignment(statement: &str) -> Option<String> {
    sql_status_assignment_regex()
        .captures(statement)
        .and_then(|captures| captures.get(1).map(|capture| capture.as_str().to_string()))
}

fn extract_sql_where_ids(statement: &str) -> Option<Vec<String>> {
    if let Some(captures) = sql_where_id_equals_regex().captures(statement) {
        let todo_id = captures
            .get(1)
            .and_then(|capture| parse_sql_literal_token(capture.as_str()))
            .filter(|value| !value.is_empty())?;
        return Some(vec![todo_id]);
    }

    let captures = sql_where_id_in_regex().captures(statement)?;
    let ids = split_sql_csv(captures.get(1)?.as_str())
        .into_iter()
        .filter_map(|value| parse_sql_literal_token(&value))
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();

    if ids.is_empty() {
        None
    } else {
        Some(ids)
    }
}

fn parse_sql_literal_token(token: &str) -> Option<String> {
    let trimmed = token.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("null") {
        return None;
    }

    if trimmed.starts_with('\'') && trimmed.ends_with('\'') && trimmed.len() >= 2 {
        return Some(trimmed[1..trimmed.len() - 1].replace("''", "'"));
    }

    Some(trimmed.to_string())
}

fn sql_status_assignment_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"(?i)\bstatus\s*=\s*'([^']+)'").expect("valid SQL status assignment regex")
    })
}

fn sql_where_id_equals_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"(?i)\bwhere\s+id\s*=\s*('(?:''|[^'])*'|[A-Za-z0-9_-]+)")
            .expect("valid SQL id equals regex")
    })
}

fn sql_where_id_in_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"(?i)\bwhere\s+id\s+in\s*\(([^)]*)\)").expect("valid SQL id IN regex")
    })
}

fn sql_case_when_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"(?i)\bwhen\s+'([^']+)'\s+then\s+'([^']+)'").expect("valid SQL CASE regex")
    })
}

fn parse_sql_todo_status(value: &str) -> Option<ParsedTodoStatus> {
    match value.trim().to_ascii_lowercase().as_str() {
        "pending" => Some(ParsedTodoStatus::Pending),
        "in_progress" => Some(ParsedTodoStatus::InProgress),
        "done" | "completed" => Some(ParsedTodoStatus::Completed),
        "cancelled" | "canceled" => Some(ParsedTodoStatus::Cancelled),
        _ => None,
    }
}

fn humanize_sql_todo_identifier(identifier: &str) -> String {
    let words: Vec<String> = identifier
        .split(|character: char| !character.is_ascii_alphanumeric())
        .filter(|segment| !segment.is_empty())
        .map(|segment| {
            let lower = segment.to_ascii_lowercase();
            let mut characters = lower.chars();
            match characters.next() {
                Some(first) => {
                    let mut title = String::new();
                    title.push(first.to_ascii_uppercase());
                    title.push_str(characters.as_str());
                    title
                }
                None => String::new(),
            }
        })
        .collect();

    if words.is_empty() {
        identifier.to_string()
    } else {
        words.join(" ")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_sql_todo_status_updates() {
        let parsed = parse_sql_todo_updates(&json!({
            "query": "UPDATE todos SET status = 'done', updated_at = CURRENT_TIMESTAMP WHERE id = 'tighten-project-header-action-rail';\nUPDATE todos SET status = 'in_progress', updated_at = CURRENT_TIMESTAMP WHERE id = 'shrink-session-list-header-buttons';"
        }))
        .expect("expected todo updates");

        assert_eq!(
            parsed,
            vec![
                ParsedTodo {
                    content: "Tighten Project Header Action Rail".to_string(),
                    active_form: "Tighten Project Header Action Rail".to_string(),
                    status: ParsedTodoStatus::Completed,
                },
                ParsedTodo {
                    content: "Shrink Session List Header Buttons".to_string(),
                    active_form: "Shrink Session List Header Buttons".to_string(),
                    status: ParsedTodoStatus::InProgress,
                },
            ]
        );
    }

    #[test]
    fn ignores_non_update_todo_sql_queries() {
        let parsed = parse_sql_todo_updates(&json!({
            "query": "SELECT COUNT(*) AS done_count FROM todos WHERE status = 'done';"
        }));

        assert!(parsed.is_none());
    }

    #[test]
    fn parses_sql_todo_inserts_from_logs() {
        let parsed = parse_sql_todo_updates(&json!({
            "query": "DELETE FROM todo_deps; DELETE FROM todos; INSERT INTO todos (id, title, description, status) VALUES ('execute-parser-tests', 'Add execute parser tests', 'Add failing tests for execute results.', 'pending'), ('execute-parser-fix', 'Fix execute result parsing', 'Update execute result parsing.', 'pending'), ('execute-verify', 'Verify execute output', 'Run targeted tests and desktop typecheck.', 'pending'); SELECT id, status FROM todos ORDER BY id;"
        }))
        .expect("expected inserted todos");

        assert_eq!(
            parsed,
            vec![
                ParsedTodo {
                    content: "Add execute parser tests".to_string(),
                    active_form: "Add execute parser tests".to_string(),
                    status: ParsedTodoStatus::Pending,
                },
                ParsedTodo {
                    content: "Fix execute result parsing".to_string(),
                    active_form: "Fix execute result parsing".to_string(),
                    status: ParsedTodoStatus::Pending,
                },
                ParsedTodo {
                    content: "Verify execute output".to_string(),
                    active_form: "Verify execute output".to_string(),
                    status: ParsedTodoStatus::Pending,
                },
            ]
        );
    }

    #[test]
    fn parses_sql_case_todo_status_updates() {
        let parsed = parse_sql_todo_updates(&json!({
            "query": "UPDATE todos SET status = CASE id WHEN 'sidebar-direct-spawn' THEN 'done' WHEN 'header-agent-picker-seam' THEN 'in_progress' ELSE status END, updated_at = CURRENT_TIMESTAMP WHERE id IN ('sidebar-direct-spawn','header-agent-picker-seam');"
        }))
        .expect("expected CASE todo updates");

        assert_eq!(
            parsed,
            vec![
                ParsedTodo {
                    content: "Sidebar Direct Spawn".to_string(),
                    active_form: "Sidebar Direct Spawn".to_string(),
                    status: ParsedTodoStatus::Completed,
                },
                ParsedTodo {
                    content: "Header Agent Picker Seam".to_string(),
                    active_form: "Header Agent Picker Seam".to_string(),
                    status: ParsedTodoStatus::InProgress,
                },
            ]
        );
    }

    #[test]
    fn parses_sql_todo_status_updates_for_id_lists() {
        let parsed = parse_sql_todo_updates(&json!({
            "query": "UPDATE todos SET status='done' WHERE id IN ('bug-a-test','bug-a-fix');"
        }))
        .expect("expected todo updates");

        assert_eq!(
            parsed,
            vec![
                ParsedTodo {
                    content: "Bug A Test".to_string(),
                    active_form: "Bug A Test".to_string(),
                    status: ParsedTodoStatus::Completed,
                },
                ParsedTodo {
                    content: "Bug A Fix".to_string(),
                    active_form: "Bug A Fix".to_string(),
                    status: ParsedTodoStatus::Completed,
                },
            ]
        );
    }
}
