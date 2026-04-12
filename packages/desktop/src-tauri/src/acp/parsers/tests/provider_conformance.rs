use super::*;
use crate::acp::session_update::{ToolArguments, ToolKind};
use serde_json::json;

enum ExpectedArguments {
    ReadPath(&'static str),
    EditPath(&'static str),
    MovePaths {
        from: &'static str,
        to: &'static str,
    },
}

struct ToolCallCase {
    label: &'static str,
    agent: AgentType,
    payload: serde_json::Value,
    expected_kind: ToolKind,
    expected_arguments: ExpectedArguments,
}

fn assert_expected_arguments(expected: &ExpectedArguments, arguments: &ToolArguments) {
    match expected {
        ExpectedArguments::ReadPath(expected_path) => match arguments {
            ToolArguments::Read { file_path } => {
                assert_eq!(file_path.as_deref(), Some(*expected_path));
            }
            other => panic!("Expected read arguments, got {other:?}"),
        },
        ExpectedArguments::EditPath(expected_path) => match arguments {
            ToolArguments::Edit { edits } => {
                let edit = edits.first().expect("edit entry");
                assert_eq!(edit.file_path().map(String::as_str), Some(*expected_path));
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
    }
}

#[test]
fn provider_tool_call_corpus_preserves_current_head_shapes() {
    let cases = [
        ToolCallCase {
            label: "claude read",
            agent: AgentType::ClaudeCode,
            payload: json!({
                "toolCallId": "tool-claude-read",
                "_meta": { "claudeCode": { "toolName": "Read" } },
                "rawInput": { "file_path": "/tmp/claude.md" }
            }),
            expected_kind: ToolKind::Read,
            expected_arguments: ExpectedArguments::ReadPath("/tmp/claude.md"),
        },
        ToolCallCase {
            label: "copilot apply_patch",
            agent: AgentType::Copilot,
            payload: json!({
                "toolCallId": "tool-copilot-edit",
                "_meta": { "claudeCode": { "toolName": "apply_patch" } },
                "rawInput": "*** Begin Patch\n*** Update File: README.md\n@@\n-old\n+new\n*** End Patch"
            }),
            expected_kind: ToolKind::Edit,
            expected_arguments: ExpectedArguments::EditPath("README.md"),
        },
        ToolCallCase {
            label: "cursor read from locations",
            agent: AgentType::Cursor,
            payload: json!({
                "sessionUpdate": "tool_call",
                "toolCallId": "tool-cursor-read",
                "kind": "read",
                "status": "pending",
                "title": "Read README.md",
                "rawInput": { "offset": 0, "limit": 200 },
                "locations": [{ "path": "/tmp/cursor.md" }]
            }),
            expected_kind: ToolKind::Read,
            expected_arguments: ExpectedArguments::ReadPath("/tmp/cursor.md"),
        },
        ToolCallCase {
            label: "codex move from parsed_cmd",
            agent: AgentType::Codex,
            payload: json!({
                "type": "tool_use",
                "id": "tool-codex-move",
                "name": "Move file",
                "input": {
                    "command": ["/bin/zsh", "-lc", "mv /tmp/a /tmp/b"],
                    "parsed_cmd": [{ "type": "move", "from": "/tmp/a", "to": "/tmp/b" }]
                }
            }),
            expected_kind: ToolKind::Move,
            expected_arguments: ExpectedArguments::MovePaths {
                from: "/tmp/a",
                to: "/tmp/b",
            },
        },
        ToolCallCase {
            label: "opencode apply_patch",
            agent: AgentType::OpenCode,
            payload: json!({
                "id": "tool-opencode-edit",
                "type": "tool-invocation",
                "name": "apply_patch",
                "input": {
                    "patch_text": "*** Begin Patch\n*** Add File: note.txt\n+hello\n*** End Patch"
                }
            }),
            expected_kind: ToolKind::Edit,
            expected_arguments: ExpectedArguments::EditPath("note.txt"),
        },
    ];

    for case in cases {
        let parsed = get_parser(case.agent)
            .parse_tool_call(&case.payload)
            .unwrap_or_else(|error| panic!("{} failed to parse: {error:?}", case.label));
        assert_eq!(
            parsed.kind,
            Some(case.expected_kind),
            "{} returned wrong kind",
            case.label
        );
        assert_expected_arguments(&case.expected_arguments, &parsed.arguments);
    }
}
