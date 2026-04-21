use crate::acp::parsers::AgentType;
use crate::acp::session_update::{SessionUpdate, ToolCallData};
use serde_json::Value;
use tauri::AppHandle;

mod forwarded_permission_request;
mod fs_handlers;
mod helpers;
mod permission_handlers;
mod terminal_handlers;
mod types;

pub(crate) use forwarded_permission_request::{
    remap_forwarded_web_search_tool_call_id, ForwardedPermissionRequest,
};

/// Pre-built tool call data for a permission request that has no preceding tool_call event.
/// The client emits this as a synthetic ToolCall so the UI has a tool row to anchor the permission.
#[derive(Debug, Clone)]
pub(crate) struct SyntheticToolCallContext {
    pub tool_call_data: ToolCallData,
}

#[derive(Debug, Clone)]
pub(crate) enum InboundRoutingDecision {
    Handle(Value),
    AutoRespond {
        result: Value,
        session_id: Option<String>,
        synthetic_tool_call: Option<Box<SyntheticToolCallContext>>,
        canonical_interaction: Option<SessionUpdate>,
    },
    /// Forward to UI, optionally with enrichments to inject into params.toolCall.
    ForwardToUi {
        /// Parsed tool arguments to inject as `parsedArguments` into toolCall metadata.
        parsed_arguments: Option<Value>,
        /// When present, the client should emit a synthetic pending ToolCall before
        /// emitting the canonical interaction update, so the UI has a tool row to anchor
        /// the permission.
        synthetic_tool_call: Option<Box<SyntheticToolCallContext>>,
        /// Canonical interaction update derived from the inbound request.
        canonical_interaction: Option<SessionUpdate>,
        /// Whether this request still needs to be forwarded on the legacy inbound-request
        /// bridge. Canonicalized permission/question requests should keep this false.
        forward_legacy_event: bool,
    },
}

pub(crate) async fn route_backend_inbound_request(
    app_handle: Option<&AppHandle>,
    request_id: u64,
    method: &str,
    params: &Value,
    agent_type: AgentType,
) -> InboundRoutingDecision {
    match method {
        "fs/read_text_file" => fs_handlers::handle_fs_read_text_file(params).await,
        "fs/write_text_file" => fs_handlers::handle_fs_write_text_file(app_handle, params).await,
        "session/request_permission" => {
            permission_handlers::handle_session_request_permission(
                app_handle, params, request_id, agent_type,
            )
            .await
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
            canonical_interaction: None,
            forward_legacy_event: true,
        },
    }
}
#[cfg(test)]
mod tests {
    use super::{route_backend_inbound_request, InboundRoutingDecision};
    use crate::acp::inbound_request_router::helpers::build_permission_request_log_payload;
    use crate::acp::parsers::AgentType;
    use crate::acp::session_update::ToolKind;
    use serde_json::json;
    use tempfile::tempdir;

    #[tokio::test]
    async fn forwards_permission_request_to_ui() {
        let decision = route_backend_inbound_request(
            None,
            7,
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
            7,
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
                canonical_interaction:
                    Some(crate::acp::session_update::SessionUpdate::PermissionRequest {
                        permission,
                        ..
                    }),
                forward_legacy_event: false,
            } => {
                assert_eq!(args["kind"], "edit");
                assert_eq!(args["edits"][0]["filePath"], "/src/main.rs");
                assert_eq!(args["edits"][0]["oldString"], "foo");
                assert_eq!(args["edits"][0]["newString"], "bar");
                assert_eq!(ctx.tool_call_data.id, "tc-1");
                assert_eq!(ctx.tool_call_data.name, "Edit");
                assert_eq!(permission.id, "session-1\u{0}tc-1\u{0}7");
                assert_eq!(
                    permission.tool.as_ref().map(|tool| tool.call_id.as_str()),
                    Some("tc-1")
                );
                assert_eq!(
                    permission.reply_handler,
                    Some(crate::acp::session_update::InteractionReplyHandler::json_rpc(7))
                );
            }
            _ => panic!("Expected ForwardToUi with parsed_arguments and synthetic_tool_call"),
        }
    }

    #[tokio::test]
    async fn injects_parsed_arguments_for_codex_changes_map_permission() {
        let decision = route_backend_inbound_request(
            None,
            7,
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
                ..
            } => {
                assert_eq!(args["kind"], "edit");
                assert_eq!(args["edits"][0]["filePath"], "/tmp/README.md");
                assert_eq!(args["edits"][0]["content"], "# Hello");
            }
            _ => panic!("Expected ForwardToUi with parsed_arguments"),
        }
    }

    #[tokio::test]
    async fn injects_parsed_arguments_for_execute_permission() {
        let decision = route_backend_inbound_request(
            None,
            7,
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
                ..
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
    async fn canonicalizes_ask_user_question_into_question_request() {
        let decision = route_backend_inbound_request(
            None,
            9,
            "session/request_permission",
            &json!({
                "sessionId": "session-1",
                "toolCall": {
                    "toolCallId": "question-tool",
                    "name": "AskUserQuestion",
                    "rawInput": {
                        "questions": [
                            {
                                "question": "Proceed?",
                                "header": "Confirm",
                                "options": [
                                    { "label": "Yes", "description": "Continue" }
                                ],
                                "multiSelect": false
                            }
                        ]
                    }
                },
                "options": []
            }),
            AgentType::Copilot,
        )
        .await;

        match decision {
            InboundRoutingDecision::ForwardToUi {
                canonical_interaction:
                    Some(crate::acp::session_update::SessionUpdate::QuestionRequest {
                        question, ..
                    }),
                forward_legacy_event: false,
                ..
            } => {
                assert_eq!(question.id, "question-tool");
                assert_eq!(question.json_rpc_request_id, Some(9));
                assert_eq!(question.questions[0].question, "Proceed?");
            }
            _ => panic!("Expected canonical questionRequest session update"),
        }
    }

    #[tokio::test]
    async fn uses_kind_hint_when_permission_tool_name_is_missing() {
        let decision = route_backend_inbound_request(
            None,
            7,
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
                ..
            } => {
                assert_eq!(args["kind"], "execute");
                assert_eq!(args["command"], "echo hello");
                assert_eq!(ctx.tool_call_data.name, "Run");
                assert_eq!(ctx.tool_call_data.kind, Some(ToolKind::Execute));
            }
            _ => panic!("Expected ForwardToUi with parsed execute args and synthetic tool call"),
        }
    }

    #[tokio::test]
    async fn synthesizes_tool_call_id_when_permission_tool_call_id_is_missing() {
        let decision = route_backend_inbound_request(
            None,
            7,
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
                synthetic_tool_call: Some(ref ctx),
                canonical_interaction:
                    Some(crate::acp::session_update::SessionUpdate::PermissionRequest {
                        permission,
                        ..
                    }),
                ..
            } => {
                assert_eq!(ctx.tool_call_data.id, "permission-request-7");
                assert_eq!(permission.id, "session-1\u{0}permission-request-7\u{0}7");
            }
            _ => panic!(
                "Expected ForwardToUi with synthesized toolCallId when toolCallId is missing"
            ),
        }
    }

    #[tokio::test]
    async fn no_synthetic_hint_when_session_id_missing() {
        let decision = route_backend_inbound_request(
            None,
            7,
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
                canonical_interaction: None,
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
            7,
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

    #[tokio::test]
    async fn handles_fs_read_text_file_with_content_payload() {
        let temp = tempdir().expect("create tempdir");
        let file_path = temp.path().join("sample.txt");
        tokio::fs::write(&file_path, "line-a\nline-b")
            .await
            .expect("write file");

        let decision = route_backend_inbound_request(
            None,
            7,
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
    async fn returns_request_error_for_fs_write_without_app_handle() {
        let temp = tempdir().expect("create tempdir");
        let file_path = temp.path().join("write-me.txt");

        let decision = route_backend_inbound_request(
            None,
            7,
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
                assert_eq!(
                    result,
                    json!({
                        "error": {
                            "code": -32000,
                            "message": "App handle unavailable for session-scoped file writes"
                        }
                    })
                );
            }
            _ => panic!("Expected fs/write_text_file to be rejected without app handle"),
        }
    }

    #[tokio::test]
    async fn returns_invalid_params_for_fs_read_without_path() {
        let decision = route_backend_inbound_request(
            None,
            7,
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
            7,
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
            7,
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

    #[test]
    fn forwarded_permission_request_injects_parsed_arguments() {
        let mut forwarded = super::ForwardedPermissionRequest::new(json!({
            "params": {
                "sessionId": "session-1",
                "toolCall": {
                    "toolCallId": "tc-1"
                }
            }
        }));

        forwarded.inject_parsed_arguments(Some(&json!({
            "kind": "execute",
            "command": "ls -la"
        })));

        let payload = forwarded.into_value();
        assert_eq!(
            payload["params"]["toolCall"]["parsedArguments"]["command"],
            "ls -la"
        );
    }

    #[test]
    fn forwarded_permission_request_normalizes_session_and_remaps_tool_call_id() {
        let mut forwarded = super::ForwardedPermissionRequest::new(json!({
            "params": {
                "sessionId": "child-session",
                "toolCall": {
                    "toolCallId": "web_search_0"
                }
            }
        }));

        forwarded.normalize_session_id(Some("root-session"));
        forwarded.remap_tool_call_id("tool_123");

        let payload = forwarded.into_value();
        assert_eq!(payload["params"]["sessionId"], "root-session");
        assert_eq!(payload["params"]["toolCall"]["toolCallId"], "tool_123");
    }

    #[test]
    fn forwarded_permission_request_reports_current_session_id() {
        let mut forwarded = super::ForwardedPermissionRequest::new(json!({
            "params": {
                "sessionId": "child-session"
            }
        }));

        assert_eq!(forwarded.session_id().as_deref(), Some("child-session"));
        forwarded.normalize_session_id(Some("root-session"));
        assert_eq!(forwarded.session_id().as_deref(), Some("root-session"));
    }

    #[test]
    fn remap_forwarded_web_search_tool_call_id_updates_forwarded_payload_and_synthetic_tool() {
        let mut forwarded = super::ForwardedPermissionRequest::new(json!({
            "params": {
                "sessionId": "session-1",
                "toolCall": {
                    "toolCallId": "web_search_0",
                    "title": "Web search: tokio"
                }
            }
        }));
        let parsed = Some(json!({
            "WebSearch": {
                "query": "tokio"
            }
        }));
        let mut synthetic_tool_call = Some(Box::new(super::SyntheticToolCallContext {
            tool_call_data: crate::acp::session_update::ToolCallData {
                id: "web_search_0".to_string(),
                name: "WebSearch".to_string(),
                arguments: crate::acp::session_update::ToolArguments::Other { raw: json!({}) },
                raw_input: None,
                status: crate::acp::session_update::ToolCallStatus::InProgress,
                result: None,
                kind: Some(crate::acp::session_update::ToolKind::WebSearch),
                title: Some("Web search: tokio".to_string()),
                locations: None,
                skill_meta: None,
                normalized_questions: None,
                normalized_todos: None,
                normalized_todo_update: None,
                parent_tool_use_id: None,
                task_children: None,
                question_answer: None,
                awaiting_plan_approval: false,
                plan_approval_request_id: None,
            },
        }));
        let mut dedup = crate::acp::permission_tracker::WebSearchDedup::new();
        dedup.record(
            "session-1".to_string(),
            "tokio".to_string(),
            "tool_abc".to_string(),
        );

        let remapped = super::remap_forwarded_web_search_tool_call_id(
            &mut forwarded,
            Some(&crate::acp::providers::cursor::CursorProvider),
            &parsed,
            &mut synthetic_tool_call,
            &mut dedup,
        );

        assert_eq!(remapped.as_deref(), Some("tool_abc"));
        assert_eq!(
            forwarded.into_value()["params"]["toolCall"]["toolCallId"],
            "tool_abc"
        );
        assert_eq!(
            synthetic_tool_call
                .as_ref()
                .map(|ctx| ctx.tool_call_data.id.as_str()),
            Some("tool_abc")
        );
    }
}
