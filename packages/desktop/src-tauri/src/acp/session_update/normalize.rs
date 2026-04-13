use super::types::{OperationFamily, QuestionItem, TodoItem, ToolKind};
use crate::acp::operation_projectors::{
    project_normalized_questions, project_normalized_todos, project_operation_read_model,
};
use crate::acp::parsers::AgentType;

/// Parse and normalize questions from a tool call if it's a question tool.
///
/// This provides a unified question format regardless of which agent sent the tool call.
/// Currently supports Claude Code and OpenCode question formats.
pub fn parse_normalized_questions(
    name: &str,
    raw_input: &serde_json::Value,
    agent_type: AgentType,
) -> Option<Vec<QuestionItem>> {
    project_normalized_questions(name, raw_input, agent_type)
}

/// Parse and normalize todos from a tool call if it's a TodoWrite tool.
///
/// This provides a unified todo format regardless of which agent sent the tool call.
pub fn parse_normalized_todos(
    name: &str,
    raw_input: &serde_json::Value,
    agent_type: AgentType,
) -> Option<Vec<TodoItem>> {
    project_normalized_todos(name, raw_input, agent_type)
}

pub(crate) fn derive_normalized_questions_and_todos(
    family: OperationFamily,
    name: &str,
    raw_input: &serde_json::Value,
    agent_type: AgentType,
) -> (Option<Vec<QuestionItem>>, Option<Vec<TodoItem>>) {
    let projection = project_operation_read_model(family, name, raw_input, agent_type);
    (projection.normalized_questions, projection.normalized_todos)
}

pub(crate) fn derive_normalized_questions_and_todos_for_kind(
    kind: ToolKind,
    name: &str,
    raw_input: &serde_json::Value,
    agent_type: AgentType,
) -> (Option<Vec<QuestionItem>>, Option<Vec<TodoItem>>) {
    derive_normalized_questions_and_todos(
        OperationFamily::from_tool_kind(kind),
        name,
        raw_input,
        agent_type,
    )
}
