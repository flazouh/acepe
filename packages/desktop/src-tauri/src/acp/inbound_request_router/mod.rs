use crate::acp::parsers::AgentType;
use crate::acp::session_update::ToolCallData;
use serde_json::Value;
use tauri::AppHandle;

mod fs_handlers;
mod helpers;
mod permission_handlers;
mod terminal_handlers;
mod types;

pub(crate) use helpers::extract_query_from_synthetic_permission;

/// Pre-built tool call data for a permission request that has no preceding tool_call event.
/// The client emits this as a synthetic ToolCall so the UI has a tool row to anchor the permission.
#[derive(Debug, Clone)]
pub(crate) struct SyntheticToolCallContext {
    pub tool_call_data: ToolCallData,
}

#[derive(Debug, Clone)]
pub(crate) enum InboundRoutingDecision {
    Handle(Value),
    /// Forward to UI, optionally with enrichments to inject into params.toolCall.
    ForwardToUi {
        /// Parsed tool arguments to inject as `parsedArguments` into toolCall metadata.
        parsed_arguments: Option<Value>,
        /// When present, the client should emit a synthetic pending ToolCall before
        /// forwarding the inbound request, so the UI has a tool row to anchor the permission.
        synthetic_tool_call: Option<Box<SyntheticToolCallContext>>,
    },
}

pub(crate) async fn route_backend_inbound_request(
    app_handle: Option<&AppHandle>,
    method: &str,
    params: &Value,
    agent_type: AgentType,
) -> InboundRoutingDecision {
    match method {
        "fs/read_text_file" => fs_handlers::handle_fs_read_text_file(params).await,
        "fs/write_text_file" => fs_handlers::handle_fs_write_text_file(params).await,
        "session/request_permission" => {
            permission_handlers::handle_session_request_permission(params, agent_type).await
        }
        "terminal/create" => terminal_handlers::handle_terminal_create(app_handle, params).await,
        "terminal/output" => terminal_handlers::handle_terminal_output(app_handle, params).await,
        "terminal/wait_for_exit" => {
            terminal_handlers::handle_terminal_wait_for_exit(app_handle, params).await
        }
        "terminal/kill" => terminal_handlers::handle_terminal_kill(app_handle, params).await,
        "terminal/release" => terminal_handlers::handle_terminal_release(app_handle, params).await,
        _ => InboundRoutingDecision::ForwardToUi {
            parsed_arguments: None,
            synthetic_tool_call: None,
        },
    }
}
#[cfg(test)]
mod tests {
    use super::{route_backend_inbound_request, InboundRoutingDecision};
    use crate::acp::inbound_request_router::helpers::{
        build_permission_request_log_payload, should_auto_deny_tcc_permission,
    };
    use crate::acp::parsers::AgentType;
    use crate::acp::session_update::ToolKind;
    use serde_json::{json, Value};
    use tempfile::tempdir;

    #[tokio::test]
    async fn forwards_permission_request_to_ui() {
        let decision = route_backend_inbound_request(
            None,
            "session/request_permission",
            &json!({
                "sessionId": "session-1",
            }),
            AgentType::ClaudeCode,
        )
        .await;

        assert!(matches!(
            decision,
            InboundRoutingDecision::ForwardToUi { .. }
        ));
    }

    #[tokio::test]
    async fn injects_parsed_arguments_for_edit_permission() {
        let decision = route_backend_inbound_request(
            None,
            "session/request_permission",
            &json!({
                "sessionId": "session-1",
                "toolCall": {
                    "toolCallId": "tc-1",
                    "name": "Edit",
                    "rawInput": {
                        "file_path": "/src/main.rs",
                        "old_string": "foo",
                        "new_string": "bar"
                    }
                },
                "options": []
            }),
            AgentType::ClaudeCode,
        )
        .await;

        match decision {
            InboundRoutingDecision::ForwardToUi {
                parsed_arguments: Some(args),
                synthetic_tool_call: Some(ref ctx),
            } => {
                assert_eq!(args["kind"], "edit");
                assert_eq!(args["file_path"], "/src/main.rs");
                assert_eq!(args["old_string"], "foo");
                assert_eq!(args["new_string"], "bar");
                assert_eq!(ctx.tool_call_data.id, "tc-1");
                assert_eq!(ctx.tool_call_data.name, "Edit");
            }
            _ => panic!("Expected ForwardToUi with parsed_arguments and synthetic_tool_call"),
        }
    }

    #[tokio::test]
    async fn injects_parsed_arguments_for_codex_changes_map_permission() {
        let decision = route_backend_inbound_request(
            None,
            "session/request_permission",
            &json!({
                "sessionId": "session-1",
                "toolCall": {
                    "toolCallId": "tc-codex-1",
                    "name": "Edit",
                    "rawInput": {
                        "changes": {
                            "/tmp/README.md": {
                                "type": "add",
                                "content": "# Hello"
                            }
                        }
                    }
                },
                "options": []
            }),
            AgentType::Codex,
        )
        .await;

        match decision {
            InboundRoutingDecision::ForwardToUi {
                parsed_arguments: Some(args),
                synthetic_tool_call: Some(_),
            } => {
                assert_eq!(args["kind"], "edit");
                assert_eq!(args["file_path"], "/tmp/README.md");
                assert_eq!(args["content"], "# Hello");
            }
            _ => panic!("Expected ForwardToUi with parsed_arguments"),
        }
    }

    #[tokio::test]
    async fn injects_parsed_arguments_for_execute_permission() {
        let decision = route_backend_inbound_request(
            None,
            "session/request_permission",
            &json!({
                "sessionId": "session-1",
                "toolCall": {
                    "toolCallId": "tc-2",
                    "name": "Bash",
                    "rawInput": {
                        "command": "ls -la"
                    }
                },
                "options": []
            }),
            AgentType::ClaudeCode,
        )
        .await;

        match decision {
            InboundRoutingDecision::ForwardToUi {
                parsed_arguments: Some(args),
                synthetic_tool_call: Some(ref ctx),
            } => {
                assert_eq!(args["kind"], "execute");
                assert_eq!(args["command"], "ls -la");
                assert_eq!(ctx.tool_call_data.id, "tc-2");
                assert_eq!(ctx.tool_call_data.name, "Bash");
                assert_eq!(ctx.tool_call_data.arguments.tool_kind(), ToolKind::Execute);
            }
            _ => panic!("Expected ForwardToUi with parsed_arguments and synthetic_tool_call"),
        }
    }

    #[tokio::test]
    async fn uses_kind_hint_when_permission_tool_name_is_missing() {
        let decision = route_backend_inbound_request(
            None,
            "session/request_permission",
            &json!({
                "sessionId": "session-1",
                "toolCall": {
                    "toolCallId": "tc-3",
                    "kind": "execute",
                    "rawInput": {
                        "command": ["/bin/zsh", "-lc", "echo hello"]
                    }
                },
                "options": []
            }),
            AgentType::Codex,
        )
        .await;

        match decision {
            InboundRoutingDecision::ForwardToUi {
                parsed_arguments: Some(args),
                synthetic_tool_call: Some(ref ctx),
            } => {
                assert_eq!(args["kind"], "execute");
                assert_eq!(args["command"], "echo hello");
                assert_eq!(ctx.tool_call_data.name, "Execute");
                assert_eq!(ctx.tool_call_data.kind, Some(ToolKind::Execute));
            }
            _ => panic!("Expected ForwardToUi with parsed execute args and synthetic tool call"),
        }
    }

    #[tokio::test]
    async fn no_synthetic_hint_when_tool_call_id_missing() {
        let decision = route_backend_inbound_request(
            None,
            "session/request_permission",
            &json!({
                "sessionId": "session-1",
                "toolCall": {
                    "name": "Read",
                    "rawInput": { "file_path": "/tmp/test.txt" }
                },
                "options": []
            }),
            AgentType::ClaudeCode,
        )
        .await;

        match decision {
            InboundRoutingDecision::ForwardToUi {
                parsed_arguments: Some(_),
                synthetic_tool_call: None,
            } => {} // Expected
            _ => panic!(
                "Expected ForwardToUi with no synthetic_tool_call when toolCallId is missing"
            ),
        }
    }

    #[tokio::test]
    async fn no_synthetic_hint_when_session_id_missing() {
        let decision = route_backend_inbound_request(
            None,
            "session/request_permission",
            &json!({
                "toolCall": {
                    "toolCallId": "tc-3",
                    "name": "Read",
                    "rawInput": { "file_path": "/tmp/test.txt" }
                },
                "options": []
            }),
            AgentType::ClaudeCode,
        )
        .await;

        match decision {
            InboundRoutingDecision::ForwardToUi {
                synthetic_tool_call: None,
                ..
            } => {} // Expected
            _ => {
                panic!("Expected ForwardToUi with no synthetic_tool_call when sessionId is missing")
            }
        }
    }

    #[tokio::test]
    async fn propagates_title_in_synthetic_tool_call_for_cursor_execute() {
        // Cursor execute permissions arrive with no rawInput but the command in the title.
        // The ToolCallData must carry the title so the UI can extract the command
        // from the backtick-wrapped title as a fallback.
        let decision = route_backend_inbound_request(
            None,
            "session/request_permission",
            &json!({
                "sessionId": "session-1",
                "toolCall": {
                    "toolCallId": "tc-cursor-exec",
                    "kind": "execute",
                    "title": "`cd /tmp && go test ./... -v`"
                },
                "options": []
            }),
            AgentType::Cursor,
        )
        .await;

        match decision {
            InboundRoutingDecision::ForwardToUi {
                synthetic_tool_call: Some(ref ctx),
                ..
            } => {
                assert_eq!(ctx.tool_call_data.id, "tc-cursor-exec");
                assert_eq!(ctx.tool_call_data.kind, Some(ToolKind::Execute));
                assert_eq!(
                    ctx.tool_call_data.title.as_deref(),
                    Some("`cd /tmp && go test ./... -v`"),
                    "ToolCallData must carry the permission title for command extraction"
                );
            }
            _ => panic!("Expected ForwardToUi with synthetic_tool_call carrying title"),
        }
    }

    #[test]
    fn blocks_known_tcc_sensitive_tools_on_macos_by_default() {
        assert!(should_auto_deny_tcc_permission(
            "mcp__acepe-mcp__take_screenshot",
            "macos",
            None
        ));
        assert!(should_auto_deny_tcc_permission(
            "simulate_text_input",
            "macos",
            None
        ));
    }

    #[test]
    fn allows_tcc_sensitive_tools_when_explicitly_opted_in() {
        assert!(!should_auto_deny_tcc_permission(
            "take_screenshot",
            "macos",
            Some("1")
        ));
    }

    #[tokio::test]
    async fn auto_denies_tcc_sensitive_permission_when_only_kind_is_present() {
        let decision = route_backend_inbound_request(
            None,
            "session/request_permission",
            &json!({
                "sessionId": "session-1",
                "toolCall": {
                    "toolCallId": "tc-tcc-1",
                    "kind": "simulate_text_input",
                    "rawInput": { "text": "hello" }
                },
                "options": [
                    { "kind": "allow_once", "optionId": "approved" },
                    { "kind": "reject_once", "optionId": "abort" }
                ]
            }),
            AgentType::ClaudeCode,
        )
        .await;

        match decision {
            InboundRoutingDecision::Handle(value) => {
                assert_eq!(value["outcome"]["outcome"], "cancelled");
                assert_eq!(value["outcome"]["optionId"], "abort");
            }
            _ => panic!("Expected auto-deny handler response"),
        }
    }

    #[test]
    fn does_not_block_tcc_tools_on_non_macos_platforms() {
        assert!(!should_auto_deny_tcc_permission(
            "take_screenshot",
            "linux",
            None
        ));
    }

    #[tokio::test]
    async fn handles_fs_read_text_file_with_content_payload() {
        let temp = tempdir().expect("create tempdir");
        let file_path = temp.path().join("sample.txt");
        tokio::fs::write(&file_path, "line-a\nline-b")
            .await
            .expect("write file");

        let decision = route_backend_inbound_request(
            None,
            "fs/read_text_file",
            &json!({
                "sessionId": "session-1",
                "path": file_path.to_string_lossy(),
            }),
            AgentType::ClaudeCode,
        )
        .await;

        match decision {
            InboundRoutingDecision::Handle(result) => {
                assert_eq!(result, json!({ "content": "line-a\nline-b" }));
            }
            _ => {
                panic!("Expected fs/read_text_file to be handled in backend");
            }
        }
    }

    #[tokio::test]
    async fn handles_fs_write_text_file_and_returns_empty_object() {
        let temp = tempdir().expect("create tempdir");
        let file_path = temp.path().join("write-me.txt");

        let decision = route_backend_inbound_request(
            None,
            "fs/write_text_file",
            &json!({
                "sessionId": "session-1",
                "path": file_path.to_string_lossy(),
                "content": "hello",
            }),
            AgentType::ClaudeCode,
        )
        .await;

        match decision {
            InboundRoutingDecision::Handle(result) => {
                assert_eq!(result, json!({}));
            }
            _ => {
                panic!("Expected fs/write_text_file to be handled in backend");
            }
        }

        let content = tokio::fs::read_to_string(&file_path)
            .await
            .expect("read written file");
        assert_eq!(content, "hello");
    }

    #[tokio::test]
    async fn returns_invalid_params_for_fs_read_without_path() {
        let decision = route_backend_inbound_request(
            None,
            "fs/read_text_file",
            &json!({
                "sessionId": "session-1",
            }),
            AgentType::ClaudeCode,
        )
        .await;

        match decision {
            InboundRoutingDecision::Handle(result) => {
                assert_eq!(
                    result,
                    json!({
                        "error": {
                            "code": -32602,
                            "message": "Invalid params: sessionId and path required"
                        }
                    })
                );
            }
            _ => {
                panic!("Expected validation error to be handled in backend");
            }
        }
    }

    #[tokio::test]
    async fn returns_terminal_error_when_no_app_handle_is_available() {
        let decision = route_backend_inbound_request(
            None,
            "terminal/output",
            &json!({
                "sessionId": "session-1",
                "terminalId": "terminal-1",
            }),
            AgentType::ClaudeCode,
        )
        .await;

        match decision {
            InboundRoutingDecision::Handle(result) => {
                assert_eq!(
                    result,
                    json!({
                        "error": {
                            "code": -32000,
                            "message": "Terminal manager unavailable"
                        }
                    })
                );
            }
            _ => {
                panic!("Expected terminal/output to be handled in backend");
            }
        }
    }

    #[tokio::test]
    async fn returns_invalid_params_for_terminal_create_without_cwd() {
        let decision = route_backend_inbound_request(
            None,
            "terminal/create",
            &json!({
                "sessionId": "session-1",
                "command": "pwd"
            }),
            AgentType::ClaudeCode,
        )
        .await;

        match decision {
            InboundRoutingDecision::Handle(result) => {
                assert_eq!(
                    result,
                    json!({
                        "error": {
                            "code": -32602,
                            "message": "Invalid params: sessionId, command, and cwd required"
                        }
                    })
                );
            }
            _ => {
                panic!("Expected terminal/create validation error to be handled in backend");
            }
        }
    }

    #[test]
    fn builds_permission_request_log_payload_with_parsed_arguments() {
        let payload = build_permission_request_log_payload(
            "session/request_permission",
            &json!({
                "sessionId": "session-1",
                "toolCall": {
                    "name": "Write",
                    "rawInput": {
                        "filePath": "/tmp/articles.csv",
                        "content": "hello"
                    }
                }
            }),
            Some("Write"),
            Some("Write"),
            Some(&json!({
                "kind": "edit",
                "file_path": "/tmp/articles.csv"
            })),
            false,
            None,
        );

        assert_eq!(payload["event"], "permission.request.received");
        assert_eq!(payload["method"], "session/request_permission");
        assert_eq!(payload["toolCall"]["name"], "Write");
        assert_eq!(payload["parsedArguments"]["file_path"], "/tmp/articles.csv");
        assert_eq!(payload["blocked"], false);
        assert!(payload.get("autoRejectOptionId").is_none());
    }

    // --- extract_query_from_permission_title tests ---

    use crate::acp::inbound_request_router::extract_query_from_synthetic_permission;
    use crate::acp::inbound_request_router::helpers::extract_query_from_permission_title;

    #[test]
    fn extracts_query_from_standard_title() {
        assert_eq!(
            extract_query_from_permission_title("Web search: rust language"),
            Some("rust language".to_string()),
        );
    }

    #[test]
    fn extracts_query_preserving_original_casing() {
        assert_eq!(
            extract_query_from_permission_title("Web search: Rust Language Guide"),
            Some("Rust Language Guide".to_string()),
        );
    }

    #[test]
    fn extracts_query_case_insensitive_prefix() {
        assert_eq!(
            extract_query_from_permission_title("web search: lowercase prefix"),
            Some("lowercase prefix".to_string()),
        );
        assert_eq!(
            extract_query_from_permission_title("WEB SEARCH: UPPER PREFIX"),
            Some("UPPER PREFIX".to_string()),
        );
    }

    #[test]
    fn returns_none_for_empty_query() {
        assert_eq!(extract_query_from_permission_title("Web search:   "), None);
    }

    #[test]
    fn returns_none_for_non_web_search_title() {
        assert_eq!(
            extract_query_from_permission_title("Edit file: main.rs"),
            None
        );
    }

    #[test]
    fn returns_none_for_short_title() {
        assert_eq!(extract_query_from_permission_title("Web"), None);
    }

    #[test]
    fn extract_query_from_synthetic_uses_parsed_arguments_primary() {
        let parsed = Some(json!({"WebSearch": {"query": "tokio async runtime"}}));
        let forwarded = json!({
            "params": {
                "toolCall": {
                    "title": "Web search: ignored fallback"
                }
            }
        });
        assert_eq!(
            extract_query_from_synthetic_permission(&parsed, &forwarded),
            Some("tokio async runtime".to_string()),
        );
    }

    #[test]
    fn extract_query_from_synthetic_falls_back_to_title() {
        let parsed: Option<Value> = None;
        let forwarded = json!({
            "params": {
                "toolCall": {
                    "title": "Web search: serde json"
                }
            }
        });
        assert_eq!(
            extract_query_from_synthetic_permission(&parsed, &forwarded),
            Some("serde json".to_string()),
        );
    }

    #[test]
    fn extract_query_from_synthetic_returns_none_when_both_missing() {
        let parsed: Option<Value> = None;
        let forwarded = json!({"params": {"toolCall": {}}});
        assert_eq!(
            extract_query_from_synthetic_permission(&parsed, &forwarded),
            None,
        );
    }
}
