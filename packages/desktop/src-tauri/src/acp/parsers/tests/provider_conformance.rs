use super::*;
use crate::acp::session_update::{TodoStatus, ToolArguments, ToolKind};

enum ExpectedArguments {
    ReadPath(&'static str),
    ReadWithSourceContext {
        path: &'static str,
        start_line: u32,
        end_line: u32,
        excerpt_contains: &'static str,
    },
    EditPath(&'static str),
    MovePaths {
        from: &'static str,
        to: &'static str,
    },
    Sql {
        query: &'static str,
        description: &'static str,
    },
    NoAssertion,
}

struct ExpectedTodo {
    content: &'static str,
    status: TodoStatus,
}

struct ExpectedQuestion {
    question: &'static str,
    header: &'static str,
    option_label: &'static str,
}

struct ToolCallCase {
    label: &'static str,
    agent: AgentType,
    payload: &'static str,
    expected_kind: ToolKind,
    expected_arguments: ExpectedArguments,
    expected_todo: Option<ExpectedTodo>,
    expected_question: Option<ExpectedQuestion>,
}

fn assert_expected_arguments(expected: &ExpectedArguments, arguments: &ToolArguments) {
    match expected {
        ExpectedArguments::ReadPath(expected_path) => match arguments {
            ToolArguments::Read { file_path, .. } => {
                assert_eq!(file_path.as_deref(), Some(*expected_path));
            }
            other => panic!("Expected read arguments, got {other:?}"),
        },
        ExpectedArguments::ReadWithSourceContext {
            path,
            start_line,
            end_line,
            excerpt_contains,
        } => match arguments {
            ToolArguments::Read {
                file_path,
                source_context,
            } => {
                assert_eq!(file_path.as_deref(), Some(*path));
                let ctx = source_context.as_ref().expect("source context");
                assert_eq!(ctx.path.as_deref(), Some(*path));
                assert_eq!(
                    ctx.view_range.as_ref().and_then(|range| range.start_line),
                    Some(*start_line)
                );
                assert_eq!(
                    ctx.view_range.as_ref().and_then(|range| range.end_line),
                    Some(*end_line)
                );
                assert!(ctx
                    .excerpt
                    .as_ref()
                    .is_some_and(|excerpt| excerpt.contains(excerpt_contains)));
            }
            other => panic!("Expected read arguments with source context, got {other:?}"),
        },
        ExpectedArguments::EditPath(expected_path) => match arguments {
            ToolArguments::Edit { edits } => {
                let edit = edits.first().expect("edit entry");
                assert_eq!(edit.file_path.as_deref(), Some(*expected_path));
            }
            other => panic!("Expected edit arguments, got {other:?}"),
        },
        ExpectedArguments::MovePaths { from, to } => match arguments {
            ToolArguments::Move {
                from: actual_from,
                to: actual_to,
            } => {
                assert_eq!(actual_from.as_deref(), Some(*from));
                assert_eq!(actual_to.as_deref(), Some(*to));
            }
            other => panic!("Expected move arguments, got {other:?}"),
        },
        ExpectedArguments::Sql { query, description } => match arguments {
            ToolArguments::Sql {
                query: actual_query,
                description: actual_description,
            } => {
                assert_eq!(actual_query.as_deref(), Some(*query));
                assert_eq!(actual_description.as_deref(), Some(*description));
            }
            other => panic!("Expected sql arguments, got {other:?}"),
        },
        ExpectedArguments::NoAssertion => {}
    }
}

fn assert_expected_normalized(
    expected_todo: &Option<ExpectedTodo>,
    expected_question: &Option<ExpectedQuestion>,
    parsed: &crate::acp::session_update::ToolCallData,
) {
    match expected_todo {
        Some(expected) => {
            let todo = parsed
                .normalized_todos
                .as_ref()
                .and_then(|todos| todos.first())
                .expect("normalized todo");
            assert_eq!(todo.content, expected.content);
            assert_eq!(todo.status, expected.status);
        }
        None => assert!(parsed.normalized_todos.is_none()),
    }

    match expected_question {
        Some(expected) => {
            let question = parsed
                .normalized_questions
                .as_ref()
                .and_then(|questions| questions.first())
                .expect("normalized question");
            assert_eq!(question.question, expected.question);
            assert_eq!(question.header, expected.header);
            assert_eq!(
                question.options.first().map(|option| option.label.as_str()),
                Some(expected.option_label)
            );
        }
        None => assert!(parsed.normalized_questions.is_none()),
    }
}

#[test]
fn provider_tool_call_corpus_preserves_current_head_shapes() {
    const FIXTURE_CLAUDE_READ: &str = include_str!("fixtures/claude_tool_read.json");
    const FIXTURE_CLAUDE_QUESTION: &str = include_str!("fixtures/claude_question_tool_call.json");
    const FIXTURE_COPILOT_APPLY_PATCH: &str =
        include_str!("fixtures/copilot_apply_patch_tool_call.json");
    const FIXTURE_COPILOT_SQL: &str = include_str!("fixtures/copilot_sql_regression.json");
    const FIXTURE_COPILOT_SQL_INSERT_TODOS: &str =
        include_str!("fixtures/copilot_sql_insert_todos.json");
    const FIXTURE_COPILOT_READ_SOURCE_CONTEXT: &str =
        include_str!("fixtures/copilot_read_source_context.json");
    const FIXTURE_CURSOR_READ: &str = include_str!("fixtures/cursor_acp_tool_call.json");
    const FIXTURE_CURSOR_TODO: &str = include_str!("fixtures/cursor_update_todos_tool_call.json");
    const FIXTURE_CODEX_MOVE: &str = include_str!("fixtures/codex_move_tool_call.json");
    const FIXTURE_OPENCODE_APPLY_PATCH: &str =
        include_str!("fixtures/opencode_apply_patch_tool_call.json");

    let cases = [
        ToolCallCase {
            label: "claude read",
            agent: AgentType::ClaudeCode,
            payload: FIXTURE_CLAUDE_READ,
            expected_kind: ToolKind::Read,
            expected_arguments: ExpectedArguments::ReadPath("/tmp/claude.md"),
            expected_todo: None,
            expected_question: None,
        },
        ToolCallCase {
            label: "copilot apply_patch",
            agent: AgentType::Copilot,
            payload: FIXTURE_COPILOT_APPLY_PATCH,
            expected_kind: ToolKind::Edit,
            expected_arguments: ExpectedArguments::EditPath("README.md"),
            expected_todo: None,
            expected_question: None,
        },
        ToolCallCase {
            label: "cursor read from locations",
            agent: AgentType::Cursor,
            payload: FIXTURE_CURSOR_READ,
            expected_kind: ToolKind::Read,
            expected_arguments: ExpectedArguments::ReadPath("/tmp/main.go"),
            expected_todo: None,
            expected_question: None,
        },
        ToolCallCase {
            label: "codex move from parsed_cmd",
            agent: AgentType::Codex,
            payload: FIXTURE_CODEX_MOVE,
            expected_kind: ToolKind::Move,
            expected_arguments: ExpectedArguments::MovePaths {
                from: "/tmp/a",
                to: "/tmp/b",
            },
            expected_todo: None,
            expected_question: None,
        },
        ToolCallCase {
            label: "cursor update todos",
            agent: AgentType::Cursor,
            payload: FIXTURE_CURSOR_TODO,
            expected_kind: ToolKind::Todo,
            expected_arguments: ExpectedArguments::NoAssertion,
            expected_todo: Some(ExpectedTodo {
                content: "Add unit tests",
                status: TodoStatus::InProgress,
            }),
            expected_question: None,
        },
        ToolCallCase {
            label: "opencode apply_patch",
            agent: AgentType::OpenCode,
            payload: FIXTURE_OPENCODE_APPLY_PATCH,
            expected_kind: ToolKind::Edit,
            expected_arguments: ExpectedArguments::EditPath("note.txt"),
            expected_todo: None,
            expected_question: None,
        },
        ToolCallCase {
            label: "copilot sql weak identity (regression shape)",
            agent: AgentType::Copilot,
            payload: FIXTURE_COPILOT_SQL,
            expected_kind: ToolKind::Sql,
            expected_arguments: ExpectedArguments::Sql {
                query: "UPDATE todos SET status='done' WHERE status IN ('pending','in_progress');",
                description: "Mark all done",
            },
            expected_todo: None,
            expected_question: None,
        },
        ToolCallCase {
            label: "copilot sql insert todos",
            agent: AgentType::Copilot,
            payload: FIXTURE_COPILOT_SQL_INSERT_TODOS,
            expected_kind: ToolKind::Sql,
            expected_arguments: ExpectedArguments::NoAssertion,
            expected_todo: Some(ExpectedTodo {
                content: "Add execute parser tests",
                status: TodoStatus::Pending,
            }),
            expected_question: None,
        },
        ToolCallCase {
            label: "copilot read source context",
            agent: AgentType::Copilot,
            payload: FIXTURE_COPILOT_READ_SOURCE_CONTEXT,
            expected_kind: ToolKind::Read,
            expected_arguments: ExpectedArguments::ReadWithSourceContext {
                path: "/project/src/lib.rs",
                start_line: 5,
                end_line: 20,
                excerpt_contains: "main()",
            },
            expected_todo: None,
            expected_question: None,
        },
        ToolCallCase {
            label: "claude ask user question",
            agent: AgentType::ClaudeCode,
            payload: FIXTURE_CLAUDE_QUESTION,
            expected_kind: ToolKind::Question,
            expected_arguments: ExpectedArguments::NoAssertion,
            expected_todo: None,
            expected_question: Some(ExpectedQuestion {
                question: "Pick",
                header: "Task",
                option_label: "A",
            }),
        },
    ];

    for case in cases {
        let payload: serde_json::Value = serde_json::from_str(case.payload)
            .unwrap_or_else(|error| panic!("{} fixture should parse: {error}", case.label));
        let parsed = get_parser(case.agent)
            .parse_tool_call(&payload)
            .unwrap_or_else(|error| panic!("{} failed to parse: {error:?}", case.label));
        assert_eq!(
            parsed.kind,
            Some(case.expected_kind),
            "{} returned wrong kind",
            case.label
        );
        assert_expected_arguments(&case.expected_arguments, &parsed.arguments);
        assert_expected_normalized(&case.expected_todo, &case.expected_question, &parsed);
    }
}
