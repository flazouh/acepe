use super::types::{QuestionItem, QuestionOption, TodoItem, TodoStatus};
use crate::acp::parsers::{get_parser, AgentType};

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
    use crate::acp::parsers::ParsedTodoStatus;

    let parser = get_parser(agent_type);
    let parsed_todos = parser.parse_todos(name, raw_input);

    // Convert ParsedTodo to TodoItem
    parsed_todos.map(|todos| {
        todos
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
            .collect()
    })
}

pub(crate) fn derive_normalized_questions_and_todos(
    name: &str,
    raw_input: &serde_json::Value,
    agent_type: AgentType,
) -> (Option<Vec<QuestionItem>>, Option<Vec<TodoItem>>) {
    (
        parse_normalized_questions(name, raw_input, agent_type),
        parse_normalized_todos(name, raw_input, agent_type),
    )
}
