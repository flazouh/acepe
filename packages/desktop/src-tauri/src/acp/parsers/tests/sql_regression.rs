use crate::acp::parsers::{AgentParser, CopilotParser};
use crate::acp::session_update::{TodoStatus, ToolArguments, ToolKind};

const FIXTURE_SQL_REGRESSION: &str = include_str!("fixtures/copilot_sql_regression.json");
const FIXTURE_SQL_INSERT_TODOS: &str = include_str!("fixtures/copilot_sql_insert_todos.json");

#[test]
fn copilot_sql_tool_call_should_classify_as_sql() {
    let parser = CopilotParser;
    let payload: serde_json::Value =
        serde_json::from_str(FIXTURE_SQL_REGRESSION).expect("valid SQL regression fixture");

    let tool_call = parser
        .parse_tool_call(&payload)
        .expect("fixture should parse through the Copilot parser");

    assert_eq!(tool_call.kind, Some(ToolKind::Sql));
    match tool_call.arguments {
        ToolArguments::Sql { query, description } => {
            assert_eq!(
                query.as_deref(),
                Some("UPDATE todos SET status='done' WHERE status IN ('pending','in_progress');")
            );
            assert_eq!(description.as_deref(), Some("Mark all done"));
        }
        other => panic!("expected Sql arguments, got {other:?}"),
    }
}

#[test]
fn copilot_sql_insert_tool_call_should_normalize_todos() {
    let parser = CopilotParser;
    let payload: serde_json::Value =
        serde_json::from_str(FIXTURE_SQL_INSERT_TODOS).expect("valid SQL insert fixture");

    let tool_call = parser
        .parse_tool_call(&payload)
        .expect("fixture should parse through the Copilot parser");

    assert_eq!(tool_call.kind, Some(ToolKind::Sql));
    let todos = tool_call
        .normalized_todos
        .expect("insert SQL should normalize todos");
    assert_eq!(todos.len(), 3);
    assert_eq!(todos[0].content, "Add execute parser tests");
    assert_eq!(todos[0].status, TodoStatus::Pending);
    assert_eq!(todos[1].content, "Fix execute result parsing");
    assert_eq!(todos[1].status, TodoStatus::Pending);
    assert_eq!(todos[2].content, "Verify execute output");
    assert_eq!(todos[2].status, TodoStatus::Pending);
}
