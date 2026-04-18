use crate::acp::parsers::{AgentParser, CopilotParser};
use crate::acp::session_update::{TodoStatus, TodoUpdateOperation, ToolArguments, ToolKind};

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

    assert_eq!(tool_call.kind, Some(ToolKind::Todo));
    match tool_call.arguments {
        ToolArguments::Think { raw, .. } => {
            let raw = raw.expect("raw todo payload");
            assert_eq!(
                raw.get("query").and_then(serde_json::Value::as_str),
                Some("UPDATE todos SET status='done' WHERE status IN ('pending','in_progress');")
            );
            assert_eq!(
                raw.get("description").and_then(serde_json::Value::as_str),
                Some("Mark all done")
            );
        }
        other => panic!("expected todo arguments, got {other:?}"),
    }
    let update = tool_call
        .normalized_todo_update
        .expect("bulk todo SQL should produce a semantic todo update");
    assert_eq!(update.operation, TodoUpdateOperation::SetStatusByFilter);
    assert_eq!(update.to_status, Some(TodoStatus::Completed));
}

#[test]
fn copilot_sql_insert_tool_call_should_normalize_todos() {
    let parser = CopilotParser;
    let payload: serde_json::Value =
        serde_json::from_str(FIXTURE_SQL_INSERT_TODOS).expect("valid SQL insert fixture");

    let tool_call = parser
        .parse_tool_call(&payload)
        .expect("fixture should parse through the Copilot parser");

    assert_eq!(tool_call.kind, Some(ToolKind::Todo));
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
    let update = tool_call
        .normalized_todo_update
        .expect("insert SQL should produce a semantic todo update");
    assert_eq!(update.operation, TodoUpdateOperation::Upsert);
}
