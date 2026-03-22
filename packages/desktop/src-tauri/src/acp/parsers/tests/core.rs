use super::*;
mod agent_type {
    use super::*;
    use crate::acp::types::CanonicalAgentId;

    #[test]
    fn can_create_all_agent_types() {
        let agents = [
            AgentType::ClaudeCode,
            AgentType::OpenCode,
            AgentType::Cursor,
            AgentType::Codex,
        ];
        assert_eq!(agents.len(), 4);
    }

    #[test]
    fn agent_types_are_comparable() {
        assert_eq!(AgentType::ClaudeCode, AgentType::ClaudeCode);
        assert_ne!(AgentType::ClaudeCode, AgentType::OpenCode);
    }

    #[test]
    fn agent_types_are_cloneable() {
        let agent = AgentType::ClaudeCode;
        let cloned = agent;
        assert_eq!(agent, cloned);
    }

    #[test]
    fn converts_from_canonical_claude_code() {
        let canonical = CanonicalAgentId::ClaudeCode;
        let agent_type = AgentType::from_canonical(&canonical);
        assert_eq!(agent_type, AgentType::ClaudeCode);
    }

    #[test]
    fn converts_from_canonical_opencode() {
        let canonical = CanonicalAgentId::OpenCode;
        let agent_type = AgentType::from_canonical(&canonical);
        assert_eq!(agent_type, AgentType::OpenCode);
    }

    #[test]
    fn converts_from_canonical_cursor() {
        let canonical = CanonicalAgentId::Cursor;
        let agent_type = AgentType::from_canonical(&canonical);
        assert_eq!(agent_type, AgentType::Cursor);
    }

    #[test]
    fn converts_from_canonical_codex() {
        let canonical = CanonicalAgentId::Codex;
        let agent_type = AgentType::from_canonical(&canonical);
        assert_eq!(agent_type, AgentType::Codex);
    }

    #[test]
    fn converts_from_canonical_custom_defaults_to_claude_code() {
        let canonical = CanonicalAgentId::Custom("my-agent".to_string());
        let agent_type = AgentType::from_canonical(&canonical);
        assert_eq!(agent_type, AgentType::ClaudeCode);
    }
}

mod parse_error {
    use super::*;

    #[test]
    fn can_create_missing_field_error() {
        let error = ParseError::MissingField("toolCallId".to_string());
        assert!(error.to_string().contains("toolCallId"));
    }

    #[test]
    fn can_create_invalid_format_error() {
        let error = ParseError::InvalidFormat("Expected object".to_string());
        assert!(error.to_string().contains("Expected object"));
    }

    #[test]
    fn can_create_unknown_type_error() {
        let error = ParseError::UnknownUpdateType("fooBar".to_string());
        assert!(error.to_string().contains("fooBar"));
    }
}

mod update_type {
    use super::*;

    #[test]
    fn can_create_all_update_types() {
        let types = [
            UpdateType::UserMessageChunk,
            UpdateType::AgentMessageChunk,
            UpdateType::AgentThoughtChunk,
            UpdateType::ToolCall,
            UpdateType::ToolCallUpdate,
            UpdateType::Plan,
            UpdateType::AvailableCommandsUpdate,
            UpdateType::CurrentModeUpdate,
            UpdateType::PermissionRequest,
            UpdateType::QuestionRequest,
            UpdateType::UsageTelemetryUpdate,
        ];
        assert_eq!(types.len(), 11);
    }

    #[test]
    fn update_types_are_comparable() {
        assert_eq!(UpdateType::ToolCall, UpdateType::ToolCall);
        assert_ne!(UpdateType::ToolCall, UpdateType::ToolCallUpdate);
    }
}

mod get_parser {
    use super::*;
    use serde_json::json;

    #[test]
    fn returns_parser_for_claude_code() {
        let parser = get_parser(AgentType::ClaudeCode);
        assert_eq!(parser.agent_type(), AgentType::ClaudeCode);
    }

    #[test]
    fn returns_parser_for_opencode() {
        let parser = get_parser(AgentType::OpenCode);
        assert_eq!(parser.agent_type(), AgentType::OpenCode);
    }

    #[test]
    fn returns_parser_for_cursor() {
        let parser = get_parser(AgentType::Cursor);
        assert_eq!(parser.agent_type(), AgentType::Cursor);
    }

    #[test]
    fn returns_parser_for_codex() {
        let parser = get_parser(AgentType::Codex);
        assert_eq!(parser.agent_type(), AgentType::Codex);
    }

    #[test]
    fn trait_exposes_detect_update_type() {
        let parser = get_parser(AgentType::ClaudeCode);
        let data = json!({ "type": "agent_message_chunk" });
        let update_type = parser
            .detect_update_type(&data)
            .expect("detect should succeed");
        assert_eq!(update_type, UpdateType::AgentMessageChunk);
    }
}

mod parsed_question {
    use super::*;

    #[test]
    fn can_create_question_option() {
        let option = ParsedQuestionOption {
            label: "Option A".to_string(),
            description: "Description for A".to_string(),
        };
        assert_eq!(option.label, "Option A");
        assert_eq!(option.description, "Description for A");
    }

    #[test]
    fn can_create_question_option_with_empty_description() {
        let option = ParsedQuestionOption {
            label: "Option B".to_string(),
            description: String::new(),
        };
        assert_eq!(option.label, "Option B");
        assert!(option.description.is_empty());
    }

    #[test]
    fn can_create_parsed_question() {
        let question = ParsedQuestion {
            question: "What would you like to do?".to_string(),
            header: "Task".to_string(),
            options: vec![
                ParsedQuestionOption {
                    label: "Option A".to_string(),
                    description: "Do A".to_string(),
                },
                ParsedQuestionOption {
                    label: "Option B".to_string(),
                    description: "Do B".to_string(),
                },
            ],
            multi_select: false,
        };
        assert_eq!(question.question, "What would you like to do?");
        assert_eq!(question.header, "Task");
        assert_eq!(question.options.len(), 2);
        assert!(!question.multi_select);
    }

    #[test]
    fn can_create_multi_select_question() {
        let question = ParsedQuestion {
            question: "Select all that apply".to_string(),
            header: String::new(),
            options: vec![],
            multi_select: true,
        };
        assert!(question.multi_select);
    }

    #[test]
    fn parsed_question_is_cloneable() {
        let question = ParsedQuestion {
            question: "Test?".to_string(),
            header: String::new(),
            options: vec![],
            multi_select: false,
        };
        let cloned = question.clone();
        assert_eq!(question.question, cloned.question);
    }
}

// ===========================================
// Claude Code question parsing tests
// ===========================================

mod parsed_todo {
    use super::*;

    #[test]
    fn can_create_todo_with_all_fields() {
        let todo = ParsedTodo {
            content: "Write tests".to_string(),
            active_form: "Writing tests".to_string(),
            status: ParsedTodoStatus::InProgress,
        };
        assert_eq!(todo.content, "Write tests");
        assert_eq!(todo.active_form, "Writing tests");
        assert_eq!(todo.status, ParsedTodoStatus::InProgress);
    }

    #[test]
    fn can_create_todo_with_empty_active_form() {
        let todo = ParsedTodo {
            content: "Simple task".to_string(),
            active_form: String::new(),
            status: ParsedTodoStatus::Pending,
        };
        assert!(todo.active_form.is_empty());
    }

    #[test]
    fn parsed_todo_is_cloneable() {
        let todo = ParsedTodo {
            content: "Test".to_string(),
            active_form: "Testing".to_string(),
            status: ParsedTodoStatus::Completed,
        };
        let cloned = todo.clone();
        assert_eq!(todo.content, cloned.content);
        assert_eq!(todo.active_form, cloned.active_form);
        assert_eq!(todo.status, cloned.status);
    }

    #[test]
    fn parsed_todo_status_equality() {
        assert_eq!(ParsedTodoStatus::Pending, ParsedTodoStatus::Pending);
        assert_eq!(ParsedTodoStatus::InProgress, ParsedTodoStatus::InProgress);
        assert_eq!(ParsedTodoStatus::Completed, ParsedTodoStatus::Completed);
        assert_eq!(ParsedTodoStatus::Cancelled, ParsedTodoStatus::Cancelled);

        assert_ne!(ParsedTodoStatus::Pending, ParsedTodoStatus::InProgress);
        assert_ne!(ParsedTodoStatus::InProgress, ParsedTodoStatus::Completed);
        assert_ne!(ParsedTodoStatus::Completed, ParsedTodoStatus::Pending);
        assert_ne!(ParsedTodoStatus::Cancelled, ParsedTodoStatus::Completed);
    }

    #[test]
    fn parsed_todo_status_is_copyable() {
        let status = ParsedTodoStatus::InProgress;
        let copied = status; // Copy, not move
        assert_eq!(status, copied);
    }
}
