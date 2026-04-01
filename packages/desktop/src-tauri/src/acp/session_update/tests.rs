use super::deserialize::{extract_update_type, parser_error_to_de_error};
use super::tool_calls::{parse_tool_call_from_acp, parse_tool_call_update_from_acp};
use super::*;
use crate::acp::parsers::get_parser;
use crate::acp::types::ContentBlock;
use serde_json::json;

mod available_commands_format {
    use super::*;

    #[test]
    fn supports_snake_case_available_commands_payload() {
        let json = json!({
            "type": "available_commands_update",
            "session_id": "sess-commands",
            "available_commands": [
                { "name": "compact", "description": "Compact conversation context", "input": null }
            ]
        });

        let result: Result<SessionUpdate, _> = serde_json::from_value(json);
        assert!(result.is_ok(), "Expected Ok, got {:?}", result);

        match result.unwrap() {
            SessionUpdate::AvailableCommandsUpdate { update, session_id } => {
                assert_eq!(session_id.as_deref(), Some("sess-commands"));
                assert_eq!(update.available_commands.len(), 1);
                assert_eq!(update.available_commands[0].name, "compact");
            }
            other => panic!("Expected AvailableCommandsUpdate, got {:?}", other),
        }
    }

    #[test]
    fn supports_snake_case_current_mode_payload() {
        let json = json!({
            "type": "current_mode_update",
            "session_id": "sess-mode",
            "current_mode_update": {
                "current_mode_id": "plan"
            }
        });

        let result: Result<SessionUpdate, _> = serde_json::from_value(json);
        assert!(result.is_ok(), "Expected Ok, got {:?}", result);

        match result.unwrap() {
            SessionUpdate::CurrentModeUpdate { update, session_id } => {
                assert_eq!(session_id.as_deref(), Some("sess-mode"));
                assert_eq!(update.current_mode_id, "plan");
            }
            other => panic!("Expected CurrentModeUpdate, got {:?}", other),
        }
    }

    #[test]
    fn supports_config_option_update_array_payload() {
        let json = json!({
            "type": "config_option_update",
            "session_id": "sess-config",
            "configOptions": [
                {
                    "id": "model",
                    "name": "Model",
                    "category": "model",
                    "type": "select",
                    "description": "Choose model",
                    "currentValue": "gpt-5.3-codex",
                    "options": [
                        { "name": "gpt-5.3-codex", "value": "gpt-5.3-codex" }
                    ]
                }
            ]
        });

        let result: Result<SessionUpdate, _> = serde_json::from_value(json);
        assert!(result.is_ok(), "Expected Ok, got {:?}", result);

        match result.unwrap() {
            SessionUpdate::ConfigOptionUpdate { update, session_id } => {
                assert_eq!(session_id.as_deref(), Some("sess-config"));
                assert_eq!(update.config_options.len(), 1);
                assert_eq!(update.config_options[0].id, "model");
                assert_eq!(update.config_options[0].option_type, "select");
            }
            other => panic!("Expected ConfigOptionUpdate, got {:?}", other),
        }
    }

    #[test]
    fn supports_config_option_update_with_grouped_options() {
        let json = json!({
            "type": "config_option_update",
            "session_id": "sess-config-grouped",
            "configOptions": [
                {
                    "id": "model",
                    "name": "Model",
                    "category": "model",
                    "type": "select",
                    "currentValue": "gpt-5.4",
                    "options": [
                        {
                            "group": "recommended",
                            "name": "Recommended",
                            "options": [
                                { "name": "GPT-5.4", "value": "gpt-5.4" },
                                { "name": "GPT-5.3 Codex", "value": "gpt-5.3-codex" }
                            ]
                        },
                        {
                            "group": "other",
                            "name": "Other",
                            "options": [
                                { "name": "GPT-4.1", "value": "gpt-4.1" }
                            ]
                        }
                    ]
                }
            ]
        });

        let result: Result<SessionUpdate, _> = serde_json::from_value(json);
        assert!(result.is_ok(), "Expected Ok, got {:?}", result);

        match result.unwrap() {
            SessionUpdate::ConfigOptionUpdate { update, session_id } => {
                assert_eq!(session_id.as_deref(), Some("sess-config-grouped"));
                assert_eq!(update.config_options.len(), 1);
                // Grouped options should be flattened
                assert_eq!(update.config_options[0].options.len(), 3);
                assert_eq!(update.config_options[0].options[0].name, "GPT-5.4");
                assert_eq!(update.config_options[0].options[2].name, "GPT-4.1");
            }
            other => panic!("Expected ConfigOptionUpdate, got {:?}", other),
        }
    }

    #[test]
    fn supports_config_option_update_with_missing_options() {
        let json = json!({
            "type": "config_option_update",
            "session_id": "sess-config-no-opts",
            "configOptions": [
                {
                    "id": "mode",
                    "name": "Mode",
                    "category": "mode",
                    "type": "select",
                    "currentValue": "auto"
                }
            ]
        });

        let result: Result<SessionUpdate, _> = serde_json::from_value(json);
        assert!(result.is_ok(), "Expected Ok, got {:?}", result);

        match result.unwrap() {
            SessionUpdate::ConfigOptionUpdate { update, session_id } => {
                assert_eq!(session_id.as_deref(), Some("sess-config-no-opts"));
                assert_eq!(update.config_options.len(), 1);
                assert_eq!(update.config_options[0].options.len(), 0);
            }
            other => panic!("Expected ConfigOptionUpdate, got {:?}", other),
        }
    }

    #[test]
    fn supports_available_commands_update_object_with_nested_snake_case_key() {
        let json = json!({
            "type": "available_commands_update",
            "session_id": "sess-commands-nested",
            "available_commands_update": {
                "available_commands": [
                    { "name": "compact", "description": "Compact conversation context", "input": null }
                ]
            }
        });

        let result: Result<SessionUpdate, _> = serde_json::from_value(json);
        assert!(result.is_ok(), "Expected Ok, got {:?}", result);

        match result.unwrap() {
            SessionUpdate::AvailableCommandsUpdate { update, session_id } => {
                assert_eq!(session_id.as_deref(), Some("sess-commands-nested"));
                assert_eq!(update.available_commands.len(), 1);
                assert_eq!(update.available_commands[0].name, "compact");
            }
            other => panic!("Expected AvailableCommandsUpdate, got {:?}", other),
        }
    }

    #[test]
    fn supports_current_mode_update_string_payload() {
        let json = json!({
            "type": "current_mode_update",
            "session_id": "sess-mode-string",
            "current_mode_update": "plan"
        });

        let result: Result<SessionUpdate, _> = serde_json::from_value(json);
        assert!(result.is_ok(), "Expected Ok, got {:?}", result);

        match result.unwrap() {
            SessionUpdate::CurrentModeUpdate { update, session_id } => {
                assert_eq!(session_id.as_deref(), Some("sess-mode-string"));
                assert_eq!(update.current_mode_id, "plan");
            }
            other => panic!("Expected CurrentModeUpdate, got {:?}", other),
        }
    }

    #[test]
    fn supports_config_option_update_object_with_nested_snake_case_key() {
        let json = json!({
            "type": "config_option_update",
            "session_id": "sess-config-object",
            "config_option_update": {
                "config_options": [
                    {
                        "id": "model",
                        "name": "Model",
                        "category": "model",
                        "type": "select",
                        "description": "Choose model",
                        "currentValue": "gpt-5.3-codex",
                        "options": [
                            { "name": "gpt-5.3-codex", "value": "gpt-5.3-codex" }
                        ]
                    }
                ]
            }
        });

        let result: Result<SessionUpdate, _> = serde_json::from_value(json);
        assert!(result.is_ok(), "Expected Ok, got {:?}", result);

        match result.unwrap() {
            SessionUpdate::ConfigOptionUpdate { update, session_id } => {
                assert_eq!(session_id.as_deref(), Some("sess-config-object"));
                assert_eq!(update.config_options.len(), 1);
                assert_eq!(update.config_options[0].id, "model");
            }
            other => panic!("Expected ConfigOptionUpdate, got {:?}", other),
        }
    }
}

mod plan_format {
    use super::*;

    #[test]
    fn flat_entries_format_end_to_end() {
        // Agent sends flat format: entries array, content alias, priority (dropped)
        let json = json!({
            "type": "plan",
            "sessionId": "sess-1",
            "entries": [
                { "content": "Step one", "status": "in_progress", "priority": "high" },
                { "content": "Step two", "status": "pending" }
            ]
        });
        let result: Result<SessionUpdate, _> = serde_json::from_value(json);
        assert!(result.is_ok(), "Expected Ok, got {:?}", result);
        let update = result.unwrap();
        match &update {
            SessionUpdate::Plan { plan, session_id } => {
                assert!(plan.has_plan);
                assert_eq!(plan.steps.len(), 2);
                assert_eq!(plan.steps[0].description, "Step one");
                assert!(matches!(plan.steps[0].status, PlanStepStatus::InProgress));
                assert_eq!(plan.steps[1].description, "Step two");
                assert!(matches!(plan.steps[1].status, PlanStepStatus::Pending));
                assert_eq!(session_id.as_deref(), Some("sess-1"));
            }
            _ => panic!("Expected Plan variant, got {:?}", update),
        }
    }

    #[test]
    fn canonical_nested_plan_steps_format() {
        let json = json!({
            "type": "plan",
            "sessionId": "sess-2",
            "plan": {
                "steps": [
                    { "description": "Canonical step", "status": "completed" }
                ]
            }
        });
        let result: Result<SessionUpdate, _> = serde_json::from_value(json);
        assert!(result.is_ok(), "Expected Ok, got {:?}", result);
        let update = result.unwrap();
        match &update {
            SessionUpdate::Plan { plan, session_id } => {
                assert_eq!(plan.steps.len(), 1);
                assert_eq!(plan.steps[0].description, "Canonical step");
                assert!(matches!(plan.steps[0].status, PlanStepStatus::Completed));
                assert_eq!(session_id.as_deref(), Some("sess-2"));
            }
            _ => panic!("Expected Plan variant"),
        }
    }

    #[test]
    fn neither_key_present_returns_err() {
        let json = json!({
            "type": "plan",
            "sessionId": "sess-3"
        });
        let result: Result<SessionUpdate, serde_json::Error> = serde_json::from_value(json);
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("Missing plan field"),
            "Expected 'Missing plan field' in error, got: {}",
            err_msg
        );
    }

    #[test]
    fn malformed_entries_not_array_returns_err() {
        let json = json!({
            "type": "plan",
            "sessionId": "sess-4",
            "entries": "not an array"
        });
        let result: Result<SessionUpdate, serde_json::Error> = serde_json::from_value(json);
        assert!(result.is_err());
        let err_msg = result.unwrap_err().to_string();
        assert!(
            err_msg.contains("Invalid entries") || err_msg.contains("invalid type"),
            "Expected legible error, got: {}",
            err_msg
        );
    }

    #[test]
    fn both_plan_and_entries_present_plan_wins() {
        let json = json!({
            "type": "plan",
            "sessionId": "sess-5",
            "plan": { "steps": [{ "description": "From plan key", "status": "completed" }] },
            "entries": [{ "content": "From entries", "status": "pending" }]
        });
        let result: Result<SessionUpdate, _> = serde_json::from_value(json);
        assert!(result.is_ok());
        let update = result.unwrap();
        match &update {
            SessionUpdate::Plan { plan, .. } => {
                assert_eq!(plan.steps.len(), 1);
                assert_eq!(plan.steps[0].description, "From plan key");
            }
            _ => panic!("Expected Plan variant"),
        }
    }
}

mod parse_tool_call_from_acp {
    use super::*;
    use crate::acp::agent_context::with_agent;
    use crate::acp::parsers::AgentType;

    #[test]
    fn parses_acp_format_with_all_fields() {
        let data = json!({
            "toolCallId": "tool-123",
            "_meta": {
                "claudeCode": {
                    "toolName": "Read"
                }
            },
            "rawInput": {
                "file_path": "/path/to/file.rs"
            },
            "status": "pending",
            "kind": "read",
            "title": "Reading file"
        });

        let result: Result<ToolCallData, serde_json::Error> = parse_tool_call_from_acp(&data);

        assert!(result.is_ok(), "Expected Ok, got {:?}", result);
        let tool_call = result.unwrap();
        assert_eq!(tool_call.id, "tool-123");
        assert_eq!(tool_call.name, "Read");
        assert!(matches!(tool_call.status, ToolCallStatus::Pending));
        assert_eq!(tool_call.kind, Some(ToolKind::Read));
        assert_eq!(tool_call.title, Some("Reading file".to_string()));
    }

    #[test]
    fn maps_toolcallid_to_id() {
        let data = json!({
            "toolCallId": "my-unique-id",
            "status": "pending"
        });

        let result: Result<ToolCallData, serde_json::Error> = parse_tool_call_from_acp(&data);

        assert!(result.is_ok());
        assert_eq!(result.unwrap().id, "my-unique-id");
    }

    #[test]
    fn extracts_tool_name_from_meta() {
        let data = json!({
            "toolCallId": "tool-1",
            "_meta": {
                "claudeCode": {
                    "toolName": "Bash"
                }
            }
        });

        let result: Result<ToolCallData, serde_json::Error> = parse_tool_call_from_acp(&data);

        assert!(result.is_ok());
        assert_eq!(result.unwrap().name, "Bash");
    }

    #[test]
    fn extracts_parent_tool_use_id_from_meta() {
        let data = json!({
            "toolCallId": "tool-1",
            "_meta": {
                "claudeCode": {
                    "parentToolUseId": "task-123",
                    "toolName": "Read"
                }
            }
        });

        let result: Result<ToolCallData, serde_json::Error> = parse_tool_call_from_acp(&data);

        assert!(result.is_ok());
        assert_eq!(
            result.unwrap().parent_tool_use_id,
            Some("task-123".to_string())
        );
    }

    #[test]
    fn defaults_to_unknown_when_tool_name_missing() {
        let data = json!({
            "toolCallId": "tool-1"
        });

        let result: Result<ToolCallData, serde_json::Error> = parse_tool_call_from_acp(&data);

        assert!(result.is_ok());
        assert_eq!(result.unwrap().name, "unknown");
    }

    #[test]
    fn infers_task_from_copilot_subagent_payload_without_tool_name() {
        with_agent(AgentType::Copilot, || {
            let data = json!({
                "toolCallId": "toolu_vrtx_018JbChzpCamF48QXLBn8fyA",
                "kind": "other",
                "rawInput": {
                    "agent_type": "explore",
                    "description": "Explain codebase overview",
                    "name": "codebase-explainer",
                    "prompt": "Explore the repository and summarize it."
                },
                "status": "pending",
                "title": "Explain codebase overview"
            });

            let result: Result<ToolCallData, serde_json::Error> = parse_tool_call_from_acp(&data);

            assert!(result.is_ok(), "Expected Ok, got {:?}", result);
            let tool_call = result.unwrap();
            assert_eq!(tool_call.name, "Task");
            assert_eq!(tool_call.kind, Some(ToolKind::Task));

            match tool_call.arguments {
                ToolArguments::Think {
                    description,
                    prompt,
                    subagent_type,
                    raw,
                    ..
                } => {
                    assert_eq!(description.as_deref(), Some("Explain codebase overview"));
                    assert_eq!(
                        prompt.as_deref(),
                        Some("Explore the repository and summarize it.")
                    );
                    assert_eq!(subagent_type.as_deref(), Some("explore"));
                    assert!(raw.is_some(), "Expected raw payload to be preserved");
                }
                other => {
                    panic!(
                        "Expected Think arguments for Copilot task payload, got {:?}",
                        other
                    )
                }
            }
        });
    }

    #[test]
    fn uses_kind_hint_when_tool_name_missing() {
        with_agent(AgentType::Copilot, || {
            let test_cases = vec![
                ("read", json!({ "path": "/tmp/file.rs" }), ToolKind::Read),
                (
                    "execute",
                    json!({ "command": "echo ok" }),
                    ToolKind::Execute,
                ),
                (
                    "search",
                    json!({ "query": "needle", "path": "/tmp" }),
                    ToolKind::Search,
                ),
                (
                    "glob",
                    json!({ "pattern": "**/*.rs", "path": "/tmp" }),
                    ToolKind::Glob,
                ),
                (
                    "fetch",
                    json!({ "url": "https://example.com" }),
                    ToolKind::Fetch,
                ),
            ];

            for (kind_hint, raw_input, expected_kind) in test_cases {
                let data = json!({
                    "toolCallId": format!("tool-{kind_hint}"),
                    "kind": kind_hint,
                    "rawInput": raw_input,
                    "status": "pending"
                });

                let result: Result<ToolCallData, serde_json::Error> =
                    parse_tool_call_from_acp(&data);

                assert!(
                    result.is_ok(),
                    "Expected Ok for {kind_hint}, got {:?}",
                    result
                );
                let tool_call = result.unwrap();
                assert_ne!(
                    tool_call.name, "unknown",
                    "Expected inferred name for {kind_hint}"
                );
                assert_eq!(
                    tool_call.kind,
                    Some(expected_kind),
                    "Expected inferred kind for {kind_hint}"
                );
                assert!(
                    !matches!(tool_call.arguments, ToolArguments::Other { .. }),
                    "Expected typed arguments for {kind_hint}"
                );
            }
        });
    }

    #[test]
    fn fails_when_toolcallid_missing() {
        let data = json!({
            "_meta": {
                "claudeCode": {
                    "toolName": "Read"
                }
            }
        });

        let result: Result<ToolCallData, serde_json::Error> = parse_tool_call_from_acp(&data);

        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("toolCallId"));
    }

    #[test]
    fn parses_all_status_variants() {
        let test_cases = [
            ("pending", ToolCallStatus::Pending),
            ("in_progress", ToolCallStatus::InProgress),
            ("inProgress", ToolCallStatus::InProgress),
            ("running", ToolCallStatus::InProgress),
            ("completed", ToolCallStatus::Completed),
            ("success", ToolCallStatus::Completed),
            ("failed", ToolCallStatus::Failed),
            ("cancelled", ToolCallStatus::Failed),
            ("interrupted", ToolCallStatus::Failed),
        ];

        for (status_str, expected_status) in test_cases {
            let data = json!({
                "toolCallId": "tool-1",
                "status": status_str
            });

            let result: Result<ToolCallData, serde_json::Error> = parse_tool_call_from_acp(&data);

            assert!(result.is_ok(), "Failed for status: {}", status_str);
            assert!(
                matches!(result.unwrap().status, ref s if std::mem::discriminant(s) == std::mem::discriminant(&expected_status)),
                "Status mismatch for: {}",
                status_str
            );
        }
    }

    #[test]
    fn derives_kind_from_tool_name() {
        // Kind is now derived from tool name, not from the `kind` field in JSON
        let test_cases = [
            ("Read", ToolKind::Read),
            ("Edit", ToolKind::Edit),
            ("Write", ToolKind::Edit),
            ("Bash", ToolKind::Execute),
            ("Glob", ToolKind::Glob),
            ("Grep", ToolKind::Search),
            ("WebFetch", ToolKind::Fetch),
            ("Task", ToolKind::Task),
            ("TodoWrite", ToolKind::Todo),
            ("AskUserQuestion", ToolKind::Question),
            ("Skill", ToolKind::Skill),
            ("Move", ToolKind::Move),
            ("Delete", ToolKind::Delete),
            ("EnterPlanMode", ToolKind::EnterPlanMode),
            ("ExitPlanMode", ToolKind::ExitPlanMode),
            ("TaskOutput", ToolKind::TaskOutput),
            ("UnknownTool", ToolKind::Other),
        ];

        for (tool_name, expected_kind) in test_cases {
            let data = json!({
                "toolCallId": "tool-1",
                "_meta": {
                    "claudeCode": {
                        "toolName": tool_name
                    }
                }
            });

            let result: Result<ToolCallData, serde_json::Error> = parse_tool_call_from_acp(&data);

            assert!(result.is_ok(), "Failed for tool: {}", tool_name);
            assert_eq!(
                result.unwrap().kind,
                Some(expected_kind),
                "Kind mismatch for tool: {}",
                tool_name
            );
        }
    }

    #[test]
    fn extracts_raw_input_as_typed_arguments() {
        let data = json!({
            "toolCallId": "tool-1",
            "_meta": {
                "claudeCode": {
                    "toolName": "Read"
                }
            },
            "rawInput": {
                "file_path": "/test/path.rs"
            }
        });

        let result: Result<ToolCallData, serde_json::Error> = parse_tool_call_from_acp(&data);

        assert!(result.is_ok());
        let tool_call = result.unwrap();
        match tool_call.arguments {
            ToolArguments::Read { file_path } => {
                assert_eq!(file_path, Some("/test/path.rs".to_string()));
            }
            _ => panic!("Expected Read arguments"),
        }
    }

    #[test]
    fn parses_edit_arguments_with_camel_case_keys() {
        let data = json!({
            "toolCallId": "tool-edit-1",
            "status": "pending",
            "_meta": {
                "claudeCode": {
                    "toolName": "Edit"
                }
            },
            "rawInput": {
                "filePath": "/path/to/file.ts",
                "oldString": "old content",
                "newString": "new content"
            }
        });

        let result: Result<ToolCallData, serde_json::Error> = parse_tool_call_from_acp(&data);

        assert!(result.is_ok());
        let tool_call = result.unwrap();
        match tool_call.arguments {
            ToolArguments::Edit { edits } => {
                let e = edits.first().expect("edit entry");
                assert_eq!(e.file_path, Some("/path/to/file.ts".to_string()));
                assert_eq!(e.old_string, Some("old content".to_string()));
                assert_eq!(e.new_string, Some("new content".to_string()));
            }
            _ => panic!("Expected edit tool arguments"),
        }
    }

    #[test]
    fn parses_normalized_questions_for_ask_user_question_tool() {
        let data = json!({
            "toolCallId": "tool-question-123",
            "_meta": {
                "claudeCode": {
                    "toolName": "AskUserQuestion"
                }
            },
            "kind": "think",
            "rawInput": {
                "questions": [{
                    "question": "Which framework should we use?",
                    "header": "Framework",
                    "options": [
                        { "label": "React", "description": "Popular choice" },
                        { "label": "Vue", "description": "Progressive framework" }
                    ],
                    "multiSelect": false
                }]
            },
            "status": "pending"
        });

        let result: Result<ToolCallData, serde_json::Error> = parse_tool_call_from_acp(&data);

        assert!(result.is_ok(), "Expected Ok, got {:?}", result);
        let tool_call = result.unwrap();

        // Verify normalized_questions is populated
        assert!(
            tool_call.normalized_questions.is_some(),
            "Expected normalized_questions to be populated"
        );
        let questions = tool_call.normalized_questions.unwrap();
        assert_eq!(questions.len(), 1);

        let q = &questions[0];
        assert_eq!(q.question, "Which framework should we use?");
        assert_eq!(q.header, "Framework");
        assert_eq!(q.options.len(), 2);
        assert_eq!(q.options[0].label, "React");
        assert_eq!(q.options[0].description, "Popular choice");
        assert_eq!(q.options[1].label, "Vue");
        assert!(!q.multi_select);
    }

    #[test]
    fn normalized_questions_is_none_for_non_question_tools() {
        let data = json!({
            "toolCallId": "tool-read-123",
            "_meta": {
                "claudeCode": {
                    "toolName": "Read"
                }
            },
            "kind": "read",
            "rawInput": {
                "file_path": "/test.rs"
            },
            "status": "pending"
        });

        let result: Result<ToolCallData, serde_json::Error> = parse_tool_call_from_acp(&data);

        assert!(result.is_ok());
        let tool_call = result.unwrap();
        assert!(tool_call.normalized_questions.is_none());
    }

    #[test]
    fn codex_tool_call_uses_current_agent_parser() {
        with_agent(AgentType::Codex, || {
            let data = json!({
                "type": "tool_use",
                "id": "tool-1",
                "name": "codex.execute",
                "input": { "command": "echo ok" }
            });

            let result: Result<ToolCallData, serde_json::Error> = parse_tool_call_from_acp(&data);

            assert!(result.is_ok(), "Expected Ok, got {:?}", result);
            assert_eq!(result.unwrap().name, "codex.execute");
        });
    }

    #[test]
    fn codex_infers_execute_from_command_array() {
        with_agent(AgentType::Codex, || {
            let data = json!({
                "type": "tool_use",
                "id": "tool-2",
                "name": "Read SKILL.md",
                "input": {
                    "command": ["/bin/zsh", "-lc", "cat /Users/example/.codex/skills/using-superpowers/SKILL.md"]
                }
            });

            let result: Result<ToolCallData, serde_json::Error> = parse_tool_call_from_acp(&data);

            assert!(result.is_ok(), "Expected Ok, got {:?}", result);
            let tool_call = result.unwrap();
            assert_eq!(tool_call.kind, Some(ToolKind::Execute));
            match tool_call.arguments {
                ToolArguments::Execute { command } => {
                    assert_eq!(
                        command,
                        Some(
                            "cat /Users/example/.codex/skills/using-superpowers/SKILL.md"
                                .to_string()
                        )
                    );
                }
                _ => panic!("Expected execute tool arguments"),
            }
        });
    }

    #[test]
    fn codex_infers_read_from_mcp_resource_uri() {
        with_agent(AgentType::Codex, || {
            let data = json!({
                "type": "tool_use",
                "id": "tool-3",
                "name": "Tool: filesystem/read_mcp_resource",
                "input": {
                    "arguments": {
                        "server": "filesystem",
                        "uri": "file:///Users/example/.codex/skills/using-superpowers/SKILL.md"
                    },
                    "server": "filesystem",
                    "tool": "read_mcp_resource"
                }
            });

            let result: Result<ToolCallData, serde_json::Error> = parse_tool_call_from_acp(&data);

            assert!(result.is_ok(), "Expected Ok, got {:?}", result);
            let tool_call = result.unwrap();
            assert_eq!(tool_call.kind, Some(ToolKind::Read));
            match tool_call.arguments {
                ToolArguments::Read { file_path } => {
                    assert_eq!(
                        file_path,
                        Some("/Users/example/.codex/skills/using-superpowers/SKILL.md".to_string())
                    );
                }
                _ => panic!("Expected read tool arguments"),
            }
        });
    }

    #[test]
    fn codex_infers_execute_from_mcp_list_resources() {
        with_agent(AgentType::Codex, || {
            let data = json!({
                "type": "tool_use",
                "id": "tool-4",
                "name": "Tool: codex/list_mcp_resources",
                "input": {
                    "arguments": {},
                    "server": "codex",
                    "tool": "list_mcp_resources"
                }
            });

            let result: Result<ToolCallData, serde_json::Error> = parse_tool_call_from_acp(&data);

            assert!(result.is_ok(), "Expected Ok, got {:?}", result);
            let tool_call = result.unwrap();
            assert_eq!(tool_call.kind, Some(ToolKind::Execute));
            match tool_call.arguments {
                ToolArguments::Execute { command } => {
                    assert_eq!(command, Some("mcp codex/list_mcp_resources".to_string()));
                }
                _ => panic!("Expected execute tool arguments"),
            }
        });
    }

    #[test]
    fn codex_infers_edit_from_parsed_cmd_metadata() {
        with_agent(AgentType::Codex, || {
            let data = json!({
                "type": "tool_use",
                "id": "tool-5",
                "name": "Apply patch",
                "input": {
                    "command": ["/bin/zsh", "-lc", "apply_patch *** Begin Patch ..."],
                    "parsed_cmd": [
                        {
                            "type": "edit",
                            "path": "/Users/example/Documents/acepe/packages/desktop/src/lib/acp/store/session-store.svelte.ts"
                        }
                    ]
                }
            });

            let result: Result<ToolCallData, serde_json::Error> = parse_tool_call_from_acp(&data);

            assert!(result.is_ok(), "Expected Ok, got {:?}", result);
            let tool_call = result.unwrap();
            assert_eq!(tool_call.kind, Some(ToolKind::Edit));
            match tool_call.arguments {
                ToolArguments::Edit { edits } => {
                    let e = edits.first().expect("edit entry");
                    assert_eq!(
                            e.file_path,
                            Some(
                                "/Users/example/Documents/acepe/packages/desktop/src/lib/acp/store/session-store.svelte.ts"
                                    .to_string()
                            )
                        );
                }
                _ => panic!("Expected edit tool arguments"),
            }
        });
    }

    #[test]
    fn codex_infers_move_from_parsed_cmd_metadata() {
        with_agent(AgentType::Codex, || {
            let data = json!({
                "type": "tool_use",
                "id": "tool-6",
                "name": "Move file",
                "input": {
                    "command": ["/bin/zsh", "-lc", "mv /tmp/a /tmp/b"],
                    "parsed_cmd": [
                        {
                            "type": "move",
                            "from": "/tmp/a",
                            "to": "/tmp/b"
                        }
                    ]
                }
            });

            let result: Result<ToolCallData, serde_json::Error> = parse_tool_call_from_acp(&data);

            assert!(result.is_ok(), "Expected Ok, got {:?}", result);
            let tool_call = result.unwrap();
            assert_eq!(tool_call.kind, Some(ToolKind::Move));
            match tool_call.arguments {
                ToolArguments::Move { from, to } => {
                    assert_eq!(from, Some("/tmp/a".to_string()));
                    assert_eq!(to, Some("/tmp/b".to_string()));
                }
                _ => panic!("Expected move tool arguments"),
            }
        });
    }

    #[test]
    fn codex_infers_delete_from_parsed_cmd_metadata() {
        with_agent(AgentType::Codex, || {
            let data = json!({
                "type": "tool_use",
                "id": "tool-7",
                "name": "Delete file",
                "input": {
                    "command": ["/bin/zsh", "-lc", "rm /tmp/a"],
                    "parsed_cmd": [
                        {
                            "type": "delete",
                            "path": "/tmp/a"
                        }
                    ]
                }
            });

            let result: Result<ToolCallData, serde_json::Error> = parse_tool_call_from_acp(&data);

            assert!(result.is_ok(), "Expected Ok, got {:?}", result);
            let tool_call = result.unwrap();
            assert_eq!(tool_call.kind, Some(ToolKind::Delete));
            match tool_call.arguments {
                ToolArguments::Delete { file_path } => {
                    assert_eq!(file_path, Some("/tmp/a".to_string()));
                }
                _ => panic!("Expected delete tool arguments"),
            }
        });
    }

    #[test]
    fn codex_infers_read_with_path_from_parsed_cmd_metadata() {
        with_agent(AgentType::Codex, || {
            let data = json!({
                "type": "tool_use",
                "id": "tool-8",
                "name": "Read file",
                "input": {
                    "command": ["/bin/zsh", "-lc", "cat /tmp/a"],
                    "parsed_cmd": [
                        {
                            "type": "read",
                            "path": "/tmp/a"
                        }
                    ]
                }
            });

            let result: Result<ToolCallData, serde_json::Error> = parse_tool_call_from_acp(&data);

            assert!(result.is_ok(), "Expected Ok, got {:?}", result);
            let tool_call = result.unwrap();
            assert_eq!(tool_call.kind, Some(ToolKind::Read));
            match tool_call.arguments {
                ToolArguments::Read { file_path } => {
                    assert_eq!(file_path, Some("/tmp/a".to_string()));
                }
                _ => panic!("Expected read tool arguments"),
            }
        });
    }

    #[test]
    fn codex_infers_search_with_path_from_parsed_cmd_metadata() {
        with_agent(AgentType::Codex, || {
            let data = json!({
                "type": "tool_use",
                "id": "tool-9",
                "name": "Search in file",
                "input": {
                    "command": ["/bin/zsh", "-lc", "rg foo /tmp/a"],
                    "parsed_cmd": [
                        {
                            "type": "search",
                            "path": "/tmp/a",
                            "query": "foo"
                        }
                    ]
                }
            });

            let result: Result<ToolCallData, serde_json::Error> = parse_tool_call_from_acp(&data);

            assert!(result.is_ok(), "Expected Ok, got {:?}", result);
            let tool_call = result.unwrap();
            assert_eq!(tool_call.kind, Some(ToolKind::Search));
            match tool_call.arguments {
                ToolArguments::Search { query, file_path } => {
                    assert_eq!(query, Some("foo".to_string()));
                    assert_eq!(file_path, Some("/tmp/a".to_string()));
                }
                _ => panic!("Expected search tool arguments"),
            }
        });
    }

    #[test]
    fn codex_maps_web_search_from_tool_call_id_and_kind() {
        with_agent(AgentType::Codex, || {
            let data = json!({
                "sessionUpdate": "tool_call",
                "toolCallId": "web_search_8ad1453c-2615-4d7d-8a25-85206970565e",
                "kind": "search",
                "title": "Searching the Web",
                "status": "completed"
            });

            let result: Result<ToolCallData, serde_json::Error> = parse_tool_call_from_acp(&data);

            assert!(result.is_ok(), "Expected Ok, got {:?}", result);
            let tool_call = result.unwrap();
            assert_eq!(tool_call.name, "WebSearch");
            assert_eq!(tool_call.kind, Some(ToolKind::WebSearch));
            assert!(matches!(
                tool_call.arguments,
                ToolArguments::WebSearch { .. }
            ));
        });
    }

    #[test]
    fn codex_maps_web_search_query_tool_and_extracts_query() {
        with_agent(AgentType::Codex, || {
            let data = json!({
                "type": "tool_use",
                "id": "tool-web-query",
                "name": "web.search_query",
                "input": {
                    "search_query": [
                        { "q": "latest sveltekit release notes" }
                    ]
                }
            });

            let result: Result<ToolCallData, serde_json::Error> = parse_tool_call_from_acp(&data);

            assert!(result.is_ok(), "Expected Ok, got {:?}", result);
            let tool_call = result.unwrap();
            assert_eq!(tool_call.kind, Some(ToolKind::WebSearch));
            match tool_call.arguments {
                ToolArguments::WebSearch { query } => {
                    assert_eq!(query, Some("latest sveltekit release notes".to_string()));
                }
                _ => panic!("Expected web search tool arguments"),
            }
        });
    }

    #[test]
    fn codex_maps_web_search_update_style_action_query() {
        with_agent(AgentType::Codex, || {
            let data = json!({
                "sessionUpdate": "tool_call",
                "toolCallId": "ws_0858e3ee568c89da016999952b3d008191abd78047065392c6",
                "kind": "fetch",
                "title": "Searching the Web",
                "status": "in_progress",
                "rawInput": {
                    "action": {
                        "type": "search",
                        "query": "OpenAI",
                        "queries": ["OpenAI"]
                    }
                }
            });

            let result: Result<ToolCallData, serde_json::Error> = parse_tool_call_from_acp(&data);

            assert!(result.is_ok(), "Expected Ok, got {:?}", result);
            let tool_call = result.unwrap();
            assert_eq!(tool_call.kind, Some(ToolKind::WebSearch));
            match tool_call.arguments {
                ToolArguments::WebSearch { query } => {
                    assert_eq!(query, Some("OpenAI".to_string()));
                }
                _ => panic!("Expected web search tool arguments"),
            }
        });
    }

    #[test]
    fn cursor_glob_uses_locations_as_canonical_path() {
        with_agent(AgentType::Cursor, || {
            let data = json!({
                "sessionUpdate": "tool_call",
                "toolCallId": "tool-find-1",
                "kind": "search",
                "status": "pending",
                "title": "Find `**/*`",
                "rawInput": {
                    "pattern": "**/*"
                },
                "locations": [
                    { "path": "/Users/example/Downloads/sample-go-project" }
                ]
            });

            let result: Result<ToolCallData, serde_json::Error> = parse_tool_call_from_acp(&data);

            assert!(result.is_ok(), "Expected Ok, got {:?}", result);
            let tool_call = result.unwrap();
            assert_eq!(tool_call.kind, Some(ToolKind::Glob));
            match tool_call.arguments {
                ToolArguments::Glob { pattern, path } => {
                    assert_eq!(pattern.as_deref(), Some("**/*"));
                    assert_eq!(
                        path.as_deref(),
                        Some("/Users/example/Downloads/sample-go-project")
                    );
                }
                other => panic!("Expected glob tool arguments, got {:?}", other),
            }
        });
    }

    #[test]
    fn cursor_read_uses_locations_when_raw_input_omits_file_path() {
        with_agent(AgentType::Cursor, || {
            let data = json!({
                "sessionUpdate": "tool_call",
                "toolCallId": "tool-read-1",
                "kind": "read",
                "status": "pending",
                "title": "Read README.md",
                "rawInput": {
                    "offset": 0,
                    "limit": 200
                },
                "locations": [
                    { "path": "/Users/example/Downloads/sample-go-project/README.md" }
                ]
            });

            let result: Result<ToolCallData, serde_json::Error> = parse_tool_call_from_acp(&data);

            assert!(result.is_ok(), "Expected Ok, got {:?}", result);
            let tool_call = result.unwrap();
            assert_eq!(tool_call.kind, Some(ToolKind::Read));
            match tool_call.arguments {
                ToolArguments::Read { file_path } => {
                    assert_eq!(
                        file_path.as_deref(),
                        Some("/Users/example/Downloads/sample-go-project/README.md")
                    );
                }
                other => panic!("Expected read tool arguments, got {:?}", other),
            }
        });
    }

    #[test]
    fn cursor_read_does_not_treat_generic_file_title_as_path() {
        with_agent(AgentType::Cursor, || {
            let data = json!({
                "sessionUpdate": "tool_call",
                "toolCallId": "tool-read-generic",
                "kind": "read",
                "status": "pending",
                "title": "Read File",
                "rawInput": {}
            });

            let result: Result<ToolCallData, serde_json::Error> = parse_tool_call_from_acp(&data);

            assert!(result.is_ok(), "Expected Ok, got {:?}", result);
            let tool_call = result.unwrap();
            assert_eq!(tool_call.kind, Some(ToolKind::Read));
            match tool_call.arguments {
                ToolArguments::Read { file_path } => {
                    assert_eq!(file_path, None);
                }
                other => panic!("Expected read tool arguments, got {:?}", other),
            }
        });
    }

    #[test]
    fn cursor_read_uses_specific_title_when_path_is_present() {
        with_agent(AgentType::Cursor, || {
            let data = json!({
                "sessionUpdate": "tool_call",
                "toolCallId": "tool-read-title",
                "kind": "read",
                "status": "pending",
                "title": "Read README.md",
                "rawInput": {}
            });

            let result: Result<ToolCallData, serde_json::Error> = parse_tool_call_from_acp(&data);

            assert!(result.is_ok(), "Expected Ok, got {:?}", result);
            let tool_call = result.unwrap();
            assert_eq!(tool_call.kind, Some(ToolKind::Read));
            match tool_call.arguments {
                ToolArguments::Read { file_path } => {
                    assert_eq!(file_path.as_deref(), Some("README.md"));
                }
                other => panic!("Expected read tool arguments, got {:?}", other),
            }
        });
    }

    #[test]
    fn skill_tool_accepts_name_field_as_canonical_skill() {
        let data = json!({
            "toolCallId": "tool-skill-name",
            "_meta": {
                "claudeCode": {
                    "toolName": "Skill"
                }
            },
            "rawInput": {
                "name": "using-superpowers",
                "args": "focus=high"
            },
            "status": "pending"
        });

        let result: Result<ToolCallData, serde_json::Error> = parse_tool_call_from_acp(&data);
        assert!(result.is_ok(), "Expected Ok, got {:?}", result);

        let tool_call = result.unwrap();
        assert_eq!(tool_call.kind, Some(ToolKind::Skill));
        match tool_call.arguments {
            ToolArguments::Think {
                skill, skill_args, ..
            } => {
                assert_eq!(skill.as_deref(), Some("using-superpowers"));
                assert_eq!(skill_args.as_deref(), Some("focus=high"));
            }
            other => panic!("Expected Think arguments for skill tool, got {:?}", other),
        }
    }

    #[test]
    fn skill_tool_still_accepts_legacy_skill_field() {
        let data = json!({
            "toolCallId": "tool-skill-legacy",
            "_meta": {
                "claudeCode": {
                    "toolName": "Skill"
                }
            },
            "rawInput": {
                "skill": "using-superpowers",
                "skill_args": "focus=high"
            },
            "status": "pending"
        });

        let result: Result<ToolCallData, serde_json::Error> = parse_tool_call_from_acp(&data);
        assert!(result.is_ok(), "Expected Ok, got {:?}", result);

        let tool_call = result.unwrap();
        assert_eq!(tool_call.kind, Some(ToolKind::Skill));
        match tool_call.arguments {
            ToolArguments::Think {
                skill, skill_args, ..
            } => {
                assert_eq!(skill.as_deref(), Some("using-superpowers"));
                assert_eq!(skill_args.as_deref(), Some("focus=high"));
            }
            other => panic!("Expected Think arguments for skill tool, got {:?}", other),
        }
    }

    #[test]
    fn skill_tool_normalizes_object_args_to_json_string() {
        let data = json!({
            "toolCallId": "tool-skill-object-args",
            "_meta": {
                "claudeCode": {
                    "toolName": "Skill"
                }
            },
            "rawInput": {
                "name": "using-superpowers",
                "args": { "mode": "quick", "count": 2 }
            },
            "status": "pending"
        });

        let result: Result<ToolCallData, serde_json::Error> = parse_tool_call_from_acp(&data);
        assert!(result.is_ok(), "Expected Ok, got {:?}", result);

        let tool_call = result.unwrap();
        match tool_call.arguments {
            ToolArguments::Think { skill_args, .. } => {
                let parsed_args: serde_json::Value = serde_json::from_str(
                    skill_args
                        .as_deref()
                        .expect("skill args should be present for object input"),
                )
                .expect("skill args should be valid JSON when object args are provided");
                assert_eq!(
                    parsed_args.get("mode").and_then(|v| v.as_str()),
                    Some("quick")
                );
                assert_eq!(parsed_args.get("count").and_then(|v| v.as_i64()), Some(2));
            }
            other => panic!("Expected Think arguments for skill tool, got {:?}", other),
        }
    }

    #[test]
    fn think_tool_parsing_is_unchanged() {
        let raw_input = json!({
            "description": "Thinking about architecture",
            "prompt": "reason deeply"
        });

        match get_parser(AgentType::ClaudeCode)
            .parse_typed_tool_arguments(Some("Think"), &raw_input, Some("think"))
            .expect("think arguments should parse")
        {
            ToolArguments::Think {
                description,
                prompt,
                raw,
                ..
            } => {
                assert_eq!(description.as_deref(), Some("Thinking about architecture"));
                assert_eq!(prompt.as_deref(), Some("reason deeply"));
                assert!(raw.is_some());
            }
            other => panic!("Expected think arguments, got {:?}", other),
        }
    }

    #[test]
    fn task_todo_question_tools_keep_their_kind_specific_routing() {
        let test_cases = vec![
            (
                "Task",
                ToolKind::Task,
                json!({"description": "delegate work", "prompt": "run parallel agent"}),
            ),
            (
                "TodoWrite",
                ToolKind::Todo,
                json!({"todos": [{"content": "Add tests", "status": "pending"}]}),
            ),
            (
                "AskUserQuestion",
                ToolKind::Question,
                json!({"questions": [{"question": "Pick one", "header": "Choice", "options": [{"label":"A","description":"A"}], "multiSelect": false}]}),
            ),
        ];

        for (tool_name, expected_kind, raw_input) in test_cases {
            let data = json!({
                "toolCallId": format!("tool-{}", tool_name),
                "_meta": {
                    "claudeCode": {
                        "toolName": tool_name
                    }
                },
                "rawInput": raw_input,
                "status": "pending"
            });

            let result: Result<ToolCallData, serde_json::Error> = parse_tool_call_from_acp(&data);
            assert!(result.is_ok(), "Expected Ok, got {:?}", result);
            let tool_call = result.unwrap();

            assert_eq!(tool_call.kind, Some(expected_kind));
            match tool_call.arguments {
                ToolArguments::Think { raw, .. } => {
                    assert!(raw.is_some(), "Expected raw payload for {tool_name}");
                }
                other => panic!(
                    "Expected Think argument payload for {tool_name}, got {:?}",
                    other
                ),
            }
        }
    }

    #[test]
    fn codex_maps_web_find_tool_and_extracts_pattern() {
        with_agent(AgentType::Codex, || {
            let data = json!({
                "type": "tool_use",
                "id": "tool-web-find",
                "name": "web.find",
                "input": {
                    "find": [
                        { "ref_id": "turn0open0", "pattern": "tool registry" }
                    ]
                }
            });

            let result: Result<ToolCallData, serde_json::Error> = parse_tool_call_from_acp(&data);

            assert!(result.is_ok(), "Expected Ok, got {:?}", result);
            let tool_call = result.unwrap();
            assert_eq!(tool_call.kind, Some(ToolKind::Search));
            match tool_call.arguments {
                ToolArguments::Search { query, .. } => {
                    assert_eq!(query, Some("tool registry".to_string()));
                }
                _ => panic!("Expected search tool arguments"),
            }
        });
    }

    #[test]
    fn codex_maps_functions_request_user_input_to_question_kind() {
        with_agent(AgentType::Codex, || {
            let data = json!({
                "type": "tool_use",
                "id": "tool-question",
                "name": "functions.request_user_input",
                "input": {
                    "questions": [
                        {
                            "id": "color",
                            "header": "Theme",
                            "question": "Which theme?",
                            "options": [
                                { "label": "Light", "description": "Use light mode" },
                                { "label": "Dark", "description": "Use dark mode" }
                            ]
                        }
                    ]
                }
            });

            let result: Result<ToolCallData, serde_json::Error> = parse_tool_call_from_acp(&data);

            assert!(result.is_ok(), "Expected Ok, got {:?}", result);
            let tool_call = result.unwrap();
            assert_eq!(tool_call.kind, Some(ToolKind::Question));
            assert!(tool_call.normalized_questions.is_some());
        });
    }

    #[test]
    fn codex_does_not_use_verbose_title_as_tool_name() {
        with_agent(AgentType::Codex, || {
            let data = json!({
                "toolCallId": "tool-search-name",
                "title": "Search branch:main|branch: in desktop",
                "kind": "search",
                "status": "running"
            });

            let result: Result<ToolCallData, serde_json::Error> = parse_tool_call_from_acp(&data);

            assert!(result.is_ok(), "Expected Ok, got {:?}", result);
            let tool_call = result.unwrap();
            assert_eq!(tool_call.name, "Search");
            assert_eq!(tool_call.kind, Some(ToolKind::Search));
        });
    }

    #[test]
    fn task_output_tool_parses_with_arguments() {
        let data = json!({
            "toolCallId": "tool-task-output-1",
            "_meta": {
                "claudeCode": {
                    "toolName": "TaskOutput"
                }
            },
            "rawInput": {
                "task_id": "task-abc-123",
                "timeout": 30000
            },
            "status": "pending"
        });

        let result: Result<ToolCallData, serde_json::Error> = parse_tool_call_from_acp(&data);

        assert!(result.is_ok(), "Expected Ok, got {:?}", result);
        let tool_call = result.unwrap();
        assert_eq!(tool_call.kind, Some(ToolKind::TaskOutput));
        match tool_call.arguments {
            ToolArguments::TaskOutput { task_id, timeout } => {
                assert_eq!(task_id.as_deref(), Some("task-abc-123"));
                assert_eq!(timeout, Some(30000));
            }
            other => panic!("Expected TaskOutput arguments, got {:?}", other),
        }
    }
}

#[test]
fn parses_parent_task_and_children_from_tool_call() {
    let json = json!({
        "id": "tool-1",
        "name": "Task",
        "arguments": { "kind": "think", "description": "Do work" },
        "status": "pending",
        "kind": "think",
        "parentToolUseId": "parent-123",
        "taskChildren": [
            {
                "id": "child-1",
                "name": "Read",
                "arguments": { "kind": "read", "file_path": "src/main.ts" },
                "status": "completed",
                "kind": "read"
            }
        ]
    });

    let parsed: ToolCallData = serde_json::from_value(json).expect("tool call should parse");
    assert_eq!(parsed.parent_tool_use_id.as_deref(), Some("parent-123"));
    let children = parsed.task_children.expect("children should exist");
    assert_eq!(children.len(), 1);
    assert_eq!(children[0].id, "child-1");
}

#[test]
fn replays_serialized_copilot_task_tool_call_from_event_hub() {
    crate::acp::agent_context::with_agent(crate::acp::parsers::AgentType::Copilot, || {
        let json = json!({
            "type": "toolCall",
            "session_id": "copilot-replay-session",
            "tool_call": {
                "id": "toolu_vrtx_018JbChzpCamF48QXLBn8fyA",
                "name": "unknown",
                "arguments": {
                    "kind": "other",
                    "raw": {
                        "agent_type": "explore",
                        "description": "Explain codebase overview",
                        "prompt": "Explore the repository and summarize it."
                    }
                },
                "status": "pending",
                "kind": "other",
                "title": "Explain codebase overview"
            }
        });

        let result: Result<SessionUpdate, serde_json::Error> = serde_json::from_value(json);

        assert!(result.is_ok(), "Expected Ok, got {:?}", result);
        match result.unwrap() {
            SessionUpdate::ToolCall {
                tool_call,
                session_id,
            } => {
                assert_eq!(session_id.as_deref(), Some("copilot-replay-session"));
                assert_eq!(tool_call.name, "Task");
                assert_eq!(tool_call.kind, Some(ToolKind::Task));
                match tool_call.arguments {
                    ToolArguments::Think {
                        description,
                        prompt,
                        subagent_type,
                        raw,
                        ..
                    } => {
                        assert_eq!(description.as_deref(), Some("Explain codebase overview"));
                        assert_eq!(prompt.as_deref(), Some("Explore the repository and summarize it."));
                        assert_eq!(subagent_type.as_deref(), Some("explore"));
                        assert!(raw.is_some(), "expected raw payload to be preserved");
                    }
                    other => panic!("Expected Think arguments, got {:?}", other),
                }
            }
            other => panic!("Expected ToolCall, got {:?}", other),
        }
    });
}

#[test]
fn replays_serialized_copilot_read_tool_call_data_from_event_hub() {
    crate::acp::agent_context::with_agent(crate::acp::parsers::AgentType::Copilot, || {
        let json = json!({
            "id": "tooluse_gUVhTYrqJnLirn08ln2wxu",
            "name": "unknown",
            "arguments": {
                "kind": "other",
                "raw": {
                    "path": "/tmp/example.rs"
                }
            },
            "status": "pending",
            "kind": "other",
            "title": "Viewing /tmp/example.rs"
        });

        let result: Result<ToolCallData, serde_json::Error> = serde_json::from_value(json);

        assert!(result.is_ok(), "Expected Ok, got {:?}", result);
        let tool_call = result.unwrap();
        assert_eq!(tool_call.name, "Read");
        assert_eq!(tool_call.kind, Some(ToolKind::Read));
        match tool_call.arguments {
            ToolArguments::Read {
                file_path: Some(file_path),
            } => {
                assert_eq!(file_path, "/tmp/example.rs");
            }
            other => panic!("Expected Read arguments, got {:?}", other),
        }
    });
}

#[test]
fn replays_serialized_tool_call_update_from_event_hub() {
    let json = json!({
        "type": "toolCallUpdate",
        "session_id": "copilot-replay-session",
        "update": {
            "toolCallId": "tooluse_gUVhTYrqJnLirn08ln2wxu",
            "status": "completed",
            "result": {
                "content": "example"
            }
        }
    });

    let result: Result<SessionUpdate, serde_json::Error> = serde_json::from_value(json);

    assert!(result.is_ok(), "Expected Ok, got {:?}", result);
    match result.unwrap() {
        SessionUpdate::ToolCallUpdate { update, session_id } => {
            assert_eq!(session_id.as_deref(), Some("copilot-replay-session"));
            assert_eq!(update.tool_call_id, "tooluse_gUVhTYrqJnLirn08ln2wxu");
            assert_eq!(update.status, Some(ToolCallStatus::Completed));
            assert_eq!(update.result, Some(json!({ "content": "example" })));
        }
        other => panic!("Expected ToolCallUpdate, got {:?}", other),
    }
}

mod parse_tool_call_update_from_acp {
    use super::*;
    use crate::acp::agent_context::with_agent;
    use crate::acp::parsers::AgentType;
    use crate::acp::session_update_parser::parse_session_update_notification_with_agent;
    use crate::acp::streaming_accumulator::{cleanup_session_streaming, has_tool_state};

    #[test]
    fn parses_acp_format_with_nested_content() {
        let data = json!({
            "toolCallId": "tool-456",
            "status": "completed",
            "content": [
                {
                    "type": "content",
                    "content": {
                        "type": "text",
                        "text": "File contents here"
                    }
                }
            ]
        });

        let result: Result<ToolCallUpdateData, serde_json::Error> =
            parse_tool_call_update_from_acp(&data, None);

        assert!(result.is_ok(), "Expected Ok, got {:?}", result);
        let update = result.unwrap();
        assert_eq!(update.tool_call_id, "tool-456");
        assert!(matches!(update.status, Some(ToolCallStatus::Completed)));
        assert!(update.content.is_some());
        let content = update.content.unwrap();
        assert_eq!(content.len(), 1);
    }

    #[test]
    fn maps_toolcallid_to_tool_call_id() {
        let data = json!({
            "toolCallId": "my-tool-id"
        });

        let result: Result<ToolCallUpdateData, serde_json::Error> =
            parse_tool_call_update_from_acp(&data, None);

        assert!(result.is_ok());
        assert_eq!(result.unwrap().tool_call_id, "my-tool-id");
    }

    #[test]
    fn fails_when_toolcallid_missing() {
        let data = json!({
            "status": "completed"
        });

        let result: Result<ToolCallUpdateData, serde_json::Error> =
            parse_tool_call_update_from_acp(&data, None);

        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("toolCallId"));
    }

    #[test]
    fn unwraps_nested_content_wrapper() {
        // ACP sends: [{"type": "content", "content": {...}}]
        // We need to unwrap to get the inner content
        let data = json!({
            "toolCallId": "tool-1",
            "content": [
                {
                    "type": "content",
                    "content": {
                        "type": "text",
                        "text": "Hello"
                    }
                },
                {
                    "type": "content",
                    "content": {
                        "type": "text",
                        "text": "World"
                    }
                }
            ]
        });

        let result: Result<ToolCallUpdateData, serde_json::Error> =
            parse_tool_call_update_from_acp(&data, None);

        assert!(result.is_ok());
        let update = result.unwrap();
        assert!(update.content.is_some());
        let content = update.content.unwrap();
        assert_eq!(content.len(), 2);
    }

    #[test]
    fn codex_tool_call_update_maps_content_blocks() {
        with_agent(AgentType::Codex, || {
            let data = json!({
                "toolCallId": "tool-789",
                "status": "completed",
                "content": [
                    {
                        "type": "content",
                        "content": { "type": "text", "text": "Done" }
                    }
                ]
            });

            let result: Result<ToolCallUpdateData, serde_json::Error> =
                parse_tool_call_update_from_acp(&data, None);

            assert!(result.is_ok(), "Expected Ok, got {:?}", result);
            let update = result.unwrap();
            let content = update.content.expect("content should be parsed");
            assert_eq!(content.len(), 1);
            assert!(matches!(content[0], ContentBlock::Text { .. }));
        });
    }

    #[test]
    fn codex_tool_call_update_maps_raw_input_to_typed_arguments() {
        with_agent(AgentType::Codex, || {
            let data = json!({
                "toolCallId": "tool-edit-raw-input",
                "status": "completed",
                "rawInput": {
                    "file_path": "/tmp/example.ts",
                    "old_string": "const value = 1;",
                    "new_string": "const value = 2;"
                }
            });

            let result: Result<ToolCallUpdateData, serde_json::Error> =
                parse_tool_call_update_from_acp(&data, None);

            assert!(result.is_ok(), "Expected Ok, got {:?}", result);
            let update = result.unwrap();
            assert!(matches!(update.arguments, Some(ToolArguments::Edit { .. })));
        });
    }

    #[test]
    fn copilot_tool_call_update_infers_task_arguments_without_tool_name() {
        with_agent(AgentType::Copilot, || {
            let data = json!({
                "toolCallId": "tool-copilot-task-update",
                "status": "in_progress",
                "kind": "other",
                "rawInput": {
                    "agent_type": "explore",
                    "description": "Explain codebase overview",
                    "prompt": "Explore the repository and summarize it."
                }
            });

            let result: Result<ToolCallUpdateData, serde_json::Error> =
                parse_tool_call_update_from_acp(&data, None);

            assert!(result.is_ok(), "Expected Ok, got {:?}", result);
            let update = result.unwrap();

            match update.arguments {
                Some(ToolArguments::Think {
                    description,
                    prompt,
                    subagent_type,
                    raw,
                    ..
                }) => {
                    assert_eq!(description.as_deref(), Some("Explain codebase overview"));
                    assert_eq!(
                        prompt.as_deref(),
                        Some("Explore the repository and summarize it.")
                    );
                    assert_eq!(subagent_type.as_deref(), Some("explore"));
                    assert!(raw.is_some(), "Expected raw payload to be preserved");
                }
                other => {
                    panic!(
                        "Expected Think arguments for Copilot task update payload, got {:?}",
                        other
                    )
                }
            }
        });
    }

    #[test]
    fn copilot_tool_call_update_uses_kind_hint_when_tool_name_missing() {
        with_agent(AgentType::Copilot, || {
            let test_cases = vec![
                ("read", json!({ "path": "/tmp/file.rs" })),
                ("execute", json!({ "command": "echo ok" })),
                ("fetch", json!({ "url": "https://example.com" })),
            ];

            for (kind_hint, raw_input) in test_cases {
                let data = json!({
                    "toolCallId": format!("tool-update-{kind_hint}"),
                    "status": "in_progress",
                    "kind": kind_hint,
                    "rawInput": raw_input
                });

                let result: Result<ToolCallUpdateData, serde_json::Error> =
                    parse_tool_call_update_from_acp(&data, None);

                assert!(
                    result.is_ok(),
                    "Expected Ok for {kind_hint}, got {:?}",
                    result
                );
                let update = result.unwrap();

                match (kind_hint, update.arguments) {
                    (
                        "read",
                        Some(ToolArguments::Read {
                            file_path: Some(file_path),
                        }),
                    ) => {
                        assert_eq!(file_path, "/tmp/file.rs");
                    }
                    (
                        "execute",
                        Some(ToolArguments::Execute {
                            command: Some(command),
                        }),
                    ) => {
                        assert_eq!(command, "echo ok");
                    }
                    ("fetch", Some(ToolArguments::Fetch { url: Some(url) })) => {
                        assert_eq!(url, "https://example.com");
                    }
                    (_, other) => {
                        panic!("Expected typed arguments for {kind_hint}, got {:?}", other);
                    }
                }
            }
        });
    }

    #[test]
    fn handles_direct_content_format() {
        // Also support direct format without wrapper
        let data = json!({
            "toolCallId": "tool-1",
            "content": [
                {
                    "type": "text",
                    "text": "Direct content"
                }
            ]
        });

        let result: Result<ToolCallUpdateData, serde_json::Error> =
            parse_tool_call_update_from_acp(&data, None);

        assert!(result.is_ok());
        let update = result.unwrap();
        assert!(update.content.is_some());
        assert_eq!(update.content.unwrap().len(), 1);
    }

    #[test]
    fn parses_all_status_variants() {
        let test_cases = [
            ("pending", ToolCallStatus::Pending),
            ("in_progress", ToolCallStatus::InProgress),
            ("inProgress", ToolCallStatus::InProgress),
            ("running", ToolCallStatus::InProgress),
            ("completed", ToolCallStatus::Completed),
            ("success", ToolCallStatus::Completed),
            ("failed", ToolCallStatus::Failed),
            ("cancelled", ToolCallStatus::Failed),
            ("interrupted", ToolCallStatus::Failed),
        ];

        for (status_str, expected_status) in test_cases {
            let data = json!({
                "toolCallId": "tool-1",
                "status": status_str
            });

            let result: Result<ToolCallUpdateData, serde_json::Error> =
                parse_tool_call_update_from_acp(&data, None);

            assert!(result.is_ok(), "Failed for status: {}", status_str);
            let update = result.unwrap();
            assert!(update.status.is_some());
            assert!(
                matches!(update.status.unwrap(), ref s if std::mem::discriminant(s) == std::mem::discriminant(&expected_status)),
                "Status mismatch for: {}",
                status_str
            );
        }
    }

    #[test]
    fn extracts_optional_fields() {
        let data = json!({
            "toolCallId": "tool-1",
            "title": "Executing command",
            "locations": [
                { "path": "/src/main.rs" }
            ]
        });

        let result: Result<ToolCallUpdateData, serde_json::Error> =
            parse_tool_call_update_from_acp(&data, None);

        assert!(result.is_ok());
        let update = result.unwrap();
        assert_eq!(update.title, Some("Executing command".to_string()));
        assert!(update.locations.is_some());
        assert_eq!(update.locations.unwrap().len(), 1);
    }

    #[test]
    fn extracts_result_from_meta() {
        let data = json!({
            "toolCallId": "tool-1",
            "_meta": {
                "claudeCode": {
                    "toolResponse": {
                        "output": "command output"
                    }
                }
            }
        });

        let result: Result<ToolCallUpdateData, serde_json::Error> =
            parse_tool_call_update_from_acp(&data, None);

        assert!(result.is_ok());
        let update = result.unwrap();
        assert!(update.result.is_some());
        // raw_output is deprecated, should always be None
        assert!(update.raw_output.is_none());
    }

    #[test]
    fn cursor_count_only_search_results_are_normalized() {
        with_agent(AgentType::Cursor, || {
            let data = json!({
                "sessionUpdate": "tool_call_update",
                "toolCallId": "tool-search-count",
                "status": "completed",
                "rawOutput": {
                    "totalMatches": 13,
                    "truncated": false
                }
            });

            let result: Result<ToolCallUpdateData, serde_json::Error> =
                parse_tool_call_update_from_acp(&data, None);

            assert!(result.is_ok(), "Expected Ok, got {:?}", result);
            let update = result.unwrap();
            let result = update.result.expect("result should be present");
            let mode = result.get("mode").and_then(|value| value.as_str());
            let num_matches = result.get("numMatches").and_then(|value| value.as_u64());
            let total_matches = result.get("totalMatches").and_then(|value| value.as_u64());
            assert_eq!(mode, Some("count"));
            assert_eq!(num_matches, Some(13));
            assert_eq!(total_matches, Some(13));
        });
    }

    #[test]
    fn cursor_count_only_glob_results_are_normalized() {
        with_agent(AgentType::Cursor, || {
            let data = json!({
                "sessionUpdate": "tool_call_update",
                "toolCallId": "tool-glob-count",
                "status": "completed",
                "rawOutput": {
                    "totalFiles": 8,
                    "truncated": false
                }
            });

            let result: Result<ToolCallUpdateData, serde_json::Error> =
                parse_tool_call_update_from_acp(&data, None);

            assert!(result.is_ok(), "Expected Ok, got {:?}", result);
            let update = result.unwrap();
            let result = update.result.expect("result should be present");
            let mode = result.get("mode").and_then(|value| value.as_str());
            let num_files = result.get("numFiles").and_then(|value| value.as_u64());
            let total_files = result.get("totalFiles").and_then(|value| value.as_u64());
            assert_eq!(mode, Some("count"));
            assert_eq!(num_files, Some(8));
            assert_eq!(total_files, Some(8));
        });
    }

    /// TDD: Claude Code toolCallUpdate with streamingInputDelta produces streaming_arguments
    /// when partial JSON parses successfully. Exercises the unified parser path.
    #[test]
    fn claude_code_streaming_delta_produces_streaming_arguments() {
        use crate::acp::session_update::ToolArguments;
        use crate::acp::streaming_accumulator::cleanup_tool_streaming;

        with_agent(AgentType::ClaudeCode, || {
            let session_id = "stream-test-session";
            let tool_call_id = "stream-test-tool";

            cleanup_tool_streaming(session_id, tool_call_id);

            // Read tool with complete JSON - accumulator should parse and produce streaming_arguments
            let data = json!({
                "toolCallId": tool_call_id,
                "status": "in_progress",
                "_meta": {
                    "claudeCode": {
                        "toolName": "Read",
                        "streamingInputDelta": "{\"file_path\": \"/tmp/test.rs\"}"
                    }
                }
            });

            let result: Result<ToolCallUpdateData, serde_json::Error> =
                parse_tool_call_update_from_acp(&data, Some(session_id));

            assert!(result.is_ok(), "Expected Ok, got {:?}", result);
            let update = result.unwrap();
            assert!(
                update.streaming_arguments.is_some(),
                "streaming_arguments should be populated when accumulator parses partial JSON"
            );
            if let Some(ToolArguments::Read { file_path }) = &update.streaming_arguments {
                assert_eq!(file_path.as_deref(), Some("/tmp/test.rs"));
            } else {
                panic!(
                    "Expected Read variant, got {:?}",
                    update.streaming_arguments
                );
            }

            cleanup_tool_streaming(session_id, tool_call_id);
        });
    }

    /// TDD: Plan streaming should work when streaming deltas omit toolName,
    /// using the cached name seeded from the initial tool_call.
    #[test]
    fn claude_code_streaming_plan_uses_seeded_tool_name_when_update_omits_tool_name() {
        use crate::acp::streaming_accumulator::{cleanup_session_streaming, seed_tool_name};

        with_agent(AgentType::ClaudeCode, || {
            let session_id = "plan-seed-session";
            let tool_call_id = "plan-seed-tool";

            cleanup_session_streaming(session_id);
            seed_tool_name(session_id, tool_call_id, "Write");

            let data = json!({
                "toolCallId": tool_call_id,
                "status": "in_progress",
                "_meta": {
                    "claudeCode": {
                        "streamingInputDelta": "{\"file_path\":\"/Users/example/.claude/plans/live-plan.md\",\"content\":\"# Live Plan\"}"
                    }
                }
            });

            let result: Result<ToolCallUpdateData, serde_json::Error> =
                parse_tool_call_update_from_acp(&data, Some(session_id));

            assert!(result.is_ok(), "Expected Ok, got {:?}", result);
            let update = result.unwrap();
            assert!(
                    update.streaming_plan.is_some(),
                    "streaming_plan should be produced for .claude/plans writes even when toolName is omitted"
                );

            cleanup_session_streaming(session_id);
        });
    }

    /// TDD: Non-Claude agents produce no streaming data (parser returns None for streaming fields).
    #[test]
    fn codex_produces_no_streaming_arguments() {
        with_agent(AgentType::Codex, || {
            let data = json!({
                "toolCallId": "tool-1",
                "status": "in_progress",
                "content": []
            });

            let result: Result<ToolCallUpdateData, serde_json::Error> =
                parse_tool_call_update_from_acp(&data, None);

            assert!(result.is_ok());
            let update = result.unwrap();
            assert!(update.streaming_input_delta.is_none());
            assert!(update.streaming_arguments.is_none());
        });
    }

    #[test]
    fn codex_infers_status_from_output_when_missing() {
        with_agent(AgentType::Codex, || {
            let data = json!({
                "toolCallId": "tool-exec-status",
                "rawOutput": "Process exited with code 127"
            });

            let result: Result<ToolCallUpdateData, serde_json::Error> =
                parse_tool_call_update_from_acp(&data, None);

            assert!(result.is_ok(), "Expected Ok, got {:?}", result);
            let update = result.unwrap();
            assert!(matches!(update.status, Some(ToolCallStatus::Failed)));
        });
    }

    #[test]
    fn streaming_state_scoped_to_session_and_cleared_on_completion() {
        with_agent(AgentType::ClaudeCode, || {
            let session_id = "sess-123";
            let tool_call_id = "tool-abc";

            cleanup_session_streaming(session_id);
            cleanup_session_streaming(tool_call_id);

            let delta_json = json!({
                "jsonrpc": "2.0",
                "method": "session/update",
                "params": {
                    "sessionId": session_id,
                    "update": {
                        "sessionUpdate": "tool_call_update",
                        "toolCallId": tool_call_id,
                        "_meta": {
                            "claudeCode": {
                                "toolName": "TodoWrite",
                                "streamingInputDelta": "{\"todos\": ["
                            }
                        }
                    }
                }
            });

            let _ =
                parse_session_update_notification_with_agent(AgentType::ClaudeCode, &delta_json);
            assert!(has_tool_state(session_id, tool_call_id));

            let completed_json = json!({
                "jsonrpc": "2.0",
                "method": "session/update",
                "params": {
                    "sessionId": session_id,
                    "update": {
                        "sessionUpdate": "tool_call_update",
                        "toolCallId": tool_call_id,
                        "status": "completed"
                    }
                }
            });

            let _ = parse_session_update_notification_with_agent(
                AgentType::ClaudeCode,
                &completed_json,
            );
            assert!(!has_tool_state(session_id, tool_call_id));

            cleanup_session_streaming(session_id);
            cleanup_session_streaming(tool_call_id);
        });
    }

    #[test]
    fn claude_code_web_search_result_array_is_normalized() {
        with_agent(AgentType::ClaudeCode, || {
            let data = json!({
                "sessionUpdate": "tool_call_update",
                "toolCallId": "ws_12345",
                "status": "completed",
                "kind": "fetch",
                "rawOutput": [
                    {
                        "type": "web_search_result",
                        "url": "https://example.com",
                        "title": "Example",
                        "encrypted_content": "EqgfCio...",
                        "page_age": "2 days"
                    }
                ],
                "_meta": { "claudeCode": { "toolName": "WebSearch" } }
            });
            let result: Result<ToolCallUpdateData, serde_json::Error> =
                parse_tool_call_update_from_acp(&data, None);
            assert!(result.is_ok(), "Expected Ok, got {:?}", result);
            let update = result.unwrap();
            let result = update.result.expect("result should be present");
            let results = result.get("results").and_then(|v| v.as_array());
            assert!(results.is_some(), "Expected results array");
            let results = results.unwrap();
            assert_eq!(results.len(), 1);
            assert_eq!(results[0]["url"], "https://example.com");
            assert_eq!(results[0]["title"], "Example");
            assert_eq!(results[0]["page_age"], "2 days");
            // encrypted_content stripped
            assert!(results[0].get("encrypted_content").is_none());
        });
    }

    #[test]
    fn claude_code_web_search_non_array_result_passes_through() {
        with_agent(AgentType::ClaudeCode, || {
            let data = json!({
                "sessionUpdate": "tool_call_update",
                "toolCallId": "ws_12345",
                "status": "completed",
                "kind": "fetch",
                "rawOutput": "Summary text with Sources:\n- [Title](https://url)",
                "_meta": { "claudeCode": { "toolName": "WebSearch" } }
            });
            let result: Result<ToolCallUpdateData, serde_json::Error> =
                parse_tool_call_update_from_acp(&data, None);
            assert!(result.is_ok());
            let update = result.unwrap();
            let result = update.result.expect("result should be present");
            // String results pass through unchanged for frontend to handle
            assert!(result.is_string());
        });
    }

    #[test]
    fn claude_code_web_search_skips_items_without_url_and_non_http() {
        with_agent(AgentType::ClaudeCode, || {
            let data = json!({
                "sessionUpdate": "tool_call_update",
                "toolCallId": "ws_12345",
                "status": "completed",
                "kind": "fetch",
                "rawOutput": [
                    {"title": "No URL"},
                    {"url": "javascript:alert(1)", "title": "XSS"},
                    {"url": "https://safe.com", "title": "Safe"}
                ],
                "_meta": { "claudeCode": { "toolName": "WebSearch" } }
            });
            let result: Result<ToolCallUpdateData, serde_json::Error> =
                parse_tool_call_update_from_acp(&data, None);
            assert!(result.is_ok());
            let update = result.unwrap();
            let result = update.result.expect("result should be present");
            let results = result.get("results").and_then(|v| v.as_array()).unwrap();
            assert_eq!(results.len(), 1);
            assert_eq!(results[0]["url"], "https://safe.com");
        });
    }

    #[test]
    fn non_web_search_tool_result_is_not_normalized() {
        with_agent(AgentType::ClaudeCode, || {
            let data = json!({
                "sessionUpdate": "tool_call_update",
                "toolCallId": "tool_123",
                "status": "completed",
                "kind": "read",
                "rawOutput": [{"url": "https://example.com", "title": "File"}],
                "_meta": { "claudeCode": { "toolName": "Read" } }
            });
            let result: Result<ToolCallUpdateData, serde_json::Error> =
                parse_tool_call_update_from_acp(&data, None);
            assert!(result.is_ok());
            let update = result.unwrap();
            let result = update.result.expect("result should be present");
            // Non-web-search array results pass through unchanged
            assert!(result.is_array());
        });
    }
}

mod extract_update_type {
    use super::*;
    use crate::acp::agent_context::with_agent;
    use crate::acp::parsers::AgentType;

    #[test]
    fn codex_type_field_falls_back_to_parser_detection() {
        with_agent(AgentType::Codex, || {
            let data = json!({
                "toolCallId": "tool-1",
                "rawInput": { "command": "echo ok" }
            });
            let result: Result<String, serde_json::Error> =
                extract_update_type(&data, &Some("tool_use".to_string()), &None);
            assert_eq!(result.expect("should parse"), "toolCall");
        });
    }
}

mod parser_error_helpers {
    use super::*;
    use crate::acp::parsers::ParseError;

    #[test]
    fn formats_parser_errors_consistently() {
        let error = parser_error_to_de_error::<serde_json::Error>(ParseError::MissingField(
            "toolCallId".to_string(),
        ));
        assert!(error.to_string().contains("Parser error:"));
    }
}

mod parser_integration {
    use super::*;

    #[test]
    fn can_import_and_use_claude_code_parser() {
        use crate::acp::parsers::{AgentParser, ClaudeCodeParser, UpdateType};

        let parser = ClaudeCodeParser;
        let data = json!({
            "toolCallId": "tool-123",
            "_meta": {
                "claudeCode": {
                    "toolName": "Read"
                }
            },
            "rawInput": {}
        });

        let result = parser.detect_update_type(&data);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), UpdateType::ToolCall);
    }

    #[test]
    fn can_import_and_use_opencode_parser() {
        use crate::acp::parsers::{AgentParser, OpenCodeParser, UpdateType};

        let parser = OpenCodeParser;
        let data = json!({
            "type": "tool-invocation",
            "id": "tool-123",
            "name": "Read",
            "input": {}
        });

        let result = parser.detect_update_type(&data);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), UpdateType::ToolCall);
    }

    #[test]
    fn can_import_and_use_cursor_parser() {
        use crate::acp::parsers::{AgentParser, CursorParser, UpdateType};

        let parser = CursorParser;
        let data = json!({
            "type": "tool_use",
            "id": "tool-123",
            "name": "Edit",
            "input": {}
        });

        let result = parser.detect_update_type(&data);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), UpdateType::ToolCall);
    }

    #[test]
    fn can_use_agent_type_conversion() {
        use crate::acp::parsers::AgentType;
        use crate::acp::types::CanonicalAgentId;

        let canonical = CanonicalAgentId::ClaudeCode;
        let agent_type = AgentType::from_canonical(&canonical);
        assert_eq!(agent_type, AgentType::ClaudeCode);

        let canonical = CanonicalAgentId::Copilot;
        let agent_type = AgentType::from_canonical(&canonical);
        assert_eq!(agent_type, AgentType::Copilot);
    }
}

mod command_input_hint_deserialization {
    use super::*;

    #[test]
    fn parses_hint_as_string() {
        let json = json!({
            "hint": "some hint text"
        });

        let result: Result<CommandInput, _> = serde_json::from_value(json);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().hint, "some hint text");
    }

    #[test]
    fn parses_hint_as_array_of_strings() {
        let json = json!({
            "hint": ["skill description or requirements"]
        });

        let result: Result<CommandInput, _> = serde_json::from_value(json);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().hint, "skill description or requirements");
    }

    #[test]
    fn parses_hint_as_array_of_objects() {
        let json = json!({
            "hint": [{"optional": "specific issue to fix"}]
        });

        let result: Result<CommandInput, _> = serde_json::from_value(json);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().hint, "specific issue to fix");
    }

    #[test]
    fn parses_hint_empty_array() {
        let json = json!({
            "hint": []
        });

        let result: Result<CommandInput, _> = serde_json::from_value(json);
        assert!(result.is_ok());
        assert_eq!(result.unwrap().hint, "");
    }

    #[test]
    fn parses_available_command_with_array_hint() {
        let json = json!({
            "name": "create-agent-skill",
            "description": "Create agent skills",
            "input": {
                "hint": ["skill description or requirements"]
            }
        });

        let result: Result<AvailableCommand, _> = serde_json::from_value(json);
        assert!(result.is_ok());
        let cmd = result.unwrap();
        assert_eq!(cmd.name, "create-agent-skill");
        assert!(cmd.input.is_some());
        assert_eq!(cmd.input.unwrap().hint, "skill description or requirements");
    }
}
