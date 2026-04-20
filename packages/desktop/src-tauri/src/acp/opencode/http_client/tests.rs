use super::types::{Provider, ProviderModel};
use super::*;
use crate::acp::client_trait::{AgentClient, ReconnectSessionMethod};
use crate::acp::providers::OpenCodeProvider;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Test deserialization of ProviderResponse with HashMap models (the fix)
#[test]
fn test_provider_response_deserialization() {
    let json = r#"{
            "connected": ["anthropic", "google"],
            "all": [
                {
                    "id": "anthropic",
                    "name": "Anthropic",
                    "models": {
                        "claude-sonnet-4-5": {
                            "id": "claude-sonnet-4-5",
                            "name": "Claude Sonnet 4.5"
                        },
                        "claude-opus-4": {
                            "id": "claude-opus-4",
                            "name": "Claude Opus 4"
                        }
                    }
                },
                {
                    "id": "google",
                    "name": "Google",
                    "models": {
                        "gemini-3-pro": {
                            "id": "gemini-3-pro",
                            "name": "Gemini 3 Pro"
                        }
                    }
                }
            ],
            "default": {
                "anthropic": "claude-sonnet-4-5",
                "google": "gemini-3-pro"
            }
        }"#;

    let response: ProviderResponse =
        serde_json::from_str(json).expect("Should deserialize successfully");

    assert_eq!(response.connected, vec!["anthropic", "google"]);
    assert_eq!(response.all.len(), 2);

    let anthropic = response.all.iter().find(|p| p.id == "anthropic").unwrap();
    assert_eq!(anthropic.name, "Anthropic");
    assert_eq!(anthropic.models.len(), 2);
    assert!(anthropic.models.contains_key("claude-sonnet-4-5"));
    assert!(anthropic.models.contains_key("claude-opus-4"));

    let sonnet = anthropic.models.get("claude-sonnet-4-5").unwrap();
    assert_eq!(sonnet.id, "claude-sonnet-4-5");
    assert_eq!(sonnet.name, "Claude Sonnet 4.5");

    assert_eq!(
        response.default.get("anthropic"),
        Some(&"claude-sonnet-4-5".to_string())
    );
    assert_eq!(
        response.default.get("google"),
        Some(&"gemini-3-pro".to_string())
    );
}

/// Test ProviderResponse with empty models and defaults
#[test]
fn test_provider_response_empty() {
    let json = r#"{
            "connected": [],
            "all": [],
            "default": {}
        }"#;

    let response: ProviderResponse = serde_json::from_str(json).expect("Should deserialize");

    assert!(response.connected.is_empty());
    assert!(response.all.is_empty());
    assert!(response.default.is_empty());
}

/// Test ProviderResponse with missing optional fields (serde default)
#[test]
fn test_provider_response_missing_optional() {
    let json = r#"{
            "connected": ["anthropic"],
            "all": [
                {
                    "id": "anthropic",
                    "name": "Anthropic"
                }
            ]
        }"#;

    let response: ProviderResponse =
        serde_json::from_str(json).expect("Should deserialize with defaults");

    assert_eq!(response.connected.len(), 1);
    assert_eq!(response.all.len(), 1);
    assert!(response.default.is_empty());

    let anthropic = &response.all[0];
    assert!(anthropic.models.is_empty());
}

/// Test Session deserialization
#[test]
fn test_session_deserialization() {
    let json = r#"{
            "id": "ses_abc123def456",
            "projectID": "project-123",
            "directory": "/tmp/project",
            "title": "Test Session"
        }"#;

    let session: Session = serde_json::from_str(json).expect("Should deserialize");
    assert_eq!(session.id, "ses_abc123def456");
    assert_eq!(session.project_id, "project-123");
    assert_eq!(session.directory, "/tmp/project");
    assert_eq!(session.title, Some("Test Session".to_string()));
}

/// Test Session without title (optional field)
#[test]
fn test_session_without_title() {
    let json = r#"{
            "id": "ses_xyz789",
            "projectID": "project-xyz",
            "directory": "/tmp/project-xyz"
        }"#;

    let session: Session = serde_json::from_str(json).expect("Should deserialize");
    assert_eq!(session.id, "ses_xyz789");
    assert_eq!(session.project_id, "project-xyz");
    assert_eq!(session.directory, "/tmp/project-xyz");
    assert_eq!(session.title, None);
}

/// Test ProviderResponse with many providers (stress test)
#[test]
fn test_provider_response_many_providers() {
    let mut all_providers = Vec::new();
    let mut connected = Vec::new();
    let mut default = HashMap::new();

    for i in 0..100 {
        let provider_id = format!("provider-{}", i);
        let model_id = format!("model-{}", i);

        let models = std::collections::HashMap::from([(
            model_id.clone(),
            ProviderModel {
                id: model_id.clone(),
                name: format!("Model {}", i),
            },
        )]);

        all_providers.push(Provider {
            id: provider_id.clone(),
            name: format!("Provider {}", i),
            models,
        });

        if i < 10 {
            connected.push(provider_id.clone());
            default.insert(provider_id.clone(), model_id);
        }
    }

    let response = ProviderResponse {
        connected: connected.clone(),
        all: all_providers,
        default,
    };

    let json = serde_json::to_string(&response).expect("Should serialize");
    let deserialized: ProviderResponse = serde_json::from_str(&json).expect("Should deserialize");

    assert_eq!(deserialized.connected.len(), 10);
    assert_eq!(deserialized.all.len(), 100);
    assert_eq!(deserialized.default.len(), 10);

    for i in 0..100 {
        let provider_id = format!("provider-{}", i);
        assert!(deserialized.all.iter().any(|p| p.id == provider_id));
    }
}

/// Test ProviderResponse with complex model IDs (special chars)
#[test]
fn test_provider_response_complex_model_ids() {
    let json = r#"{
            "connected": ["provider-x"],
            "all": [
                {
                    "id": "provider-x",
                    "name": "Provider X",
                    "models": {
                        "model/with/slashes": {
                            "id": "model/with/slashes",
                            "name": "Model with slashes"
                        },
                        "model-with-dashes": {
                            "id": "model-with-dashes",
                            "name": "Model with dashes"
                        },
                        "model_with_underscores": {
                            "id": "model_with_underscores",
                            "name": "Model with underscores"
                        },
                        "model.with.dots": {
                            "id": "model.with.dots",
                            "name": "Model with dots"
                        },
                        "model:with:colons": {
                            "id": "model:with:colons",
                            "name": "Model with colons"
                        }
                    }
                }
            ],
            "default": {
                "provider-x": "model/with/slashes"
            }
        }"#;

    let response: ProviderResponse = serde_json::from_str(json).expect("Should deserialize");

    let provider = &response.all[0];
    assert_eq!(provider.models.len(), 5);

    assert!(provider.models.contains_key("model/with/slashes"));
    assert!(provider.models.contains_key("model-with-dashes"));
    assert!(provider.models.contains_key("model_with_underscores"));
    assert!(provider.models.contains_key("model.with.dots"));
    assert!(provider.models.contains_key("model:with:colons"));
}

/// Test ProviderResponse with unicode characters
#[test]
fn test_provider_response_unicode() {
    let json = r#"{
            "connected": ["provider-中文"],
            "all": [
                {
                    "id": "provider-中文",
                    "name": "提供商 中文",
                    "models": {
                        "模型-中文": {
                            "id": "模型-中文",
                            "name": "中文模型 🌟"
                        },
                        "japanese-モデル": {
                            "id": "japanese-モデル",
                            "name": "日本語モデル"
                        }
                    }
                }
            ],
            "default": {
                "provider-中文": "模型-中文"
            }
        }"#;

    let response: ProviderResponse =
        serde_json::from_str(json).expect("Should deserialize unicode");

    assert_eq!(response.connected[0], "provider-中文");
    assert_eq!(response.all[0].name, "提供商 中文");
    assert_eq!(response.all[0].models.len(), 2);

    let model = response.all[0].models.get("模型-中文").unwrap();
    assert_eq!(model.name, "中文模型 🌟");
}

/// Test Provider with very long strings (edge case)
#[test]
fn test_provider_response_long_strings() {
    let long_id = "a".repeat(1000);
    let long_name = "n".repeat(10000);

    let json = format!(
        r#"{{
            "connected": ["long-id"],
            "all": [
                {{
                    "id": "{}",
                    "name": "{}",
                    "models": {{
                        "long-model": {{
                            "id": "long-model",
                            "name": "Long Model Name"
                        }}
                    }}
                }}
            ],
            "default": {{
                "long-id": "long-model"
            }}
        }}"#,
        long_id, long_name
    );

    let response: ProviderResponse =
        serde_json::from_str(&json).expect("Should handle long strings");

    assert_eq!(response.all[0].id.len(), 1000);
    assert_eq!(response.all[0].name.len(), 10000);
}

/// Test Session deserialization with special characters in ID
#[test]
fn test_session_special_characters() {
    let test_cases = vec![
        "ses_abc123",
        "ses_ABC-123_XYZ",
        "ses.with.dots",
        "ses/with/slashes",
        "ses:with:colons",
        "ses_with_空格_space",
        "ses_unicode_🚀_emoji",
    ];

    for session_id in test_cases {
        let json = format!(
            r#"{{"id":"{}","projectID":"project-1","directory":"/tmp/project-1"}}"#,
            session_id
        );
        let session: Session =
            serde_json::from_str(&json).expect("Should deserialize special chars");
        assert_eq!(session.id, session_id);
    }
}

/// Test that ProviderResponse can be used in logic for filtering connected providers
#[test]
fn test_provider_response_filtering_logic() {
    let json = r#"{
            "connected": ["anthropic", "google"],
            "all": [
                {
                    "id": "anthropic",
                    "name": "Anthropic",
                    "models": {
                        "claude-sonnet": {"id": "claude-sonnet", "name": "Claude Sonnet"},
                        "claude-opus": {"id": "claude-opus", "name": "Claude Opus"}
                    }
                },
                {
                    "id": "google",
                    "name": "Google",
                    "models": {
                        "gemini-pro": {"id": "gemini-pro", "name": "Gemini Pro"}
                    }
                },
                {
                    "id": "openai",
                    "name": "OpenAI",
                    "models": {
                        "gpt-4": {"id": "gpt-4", "name": "GPT-4"}
                    }
                }
            ],
            "default": {
                "anthropic": "claude-sonnet",
                "google": "gemini-pro",
                "openai": "gpt-4"
            }
        }"#;

    let response: ProviderResponse = serde_json::from_str(json).expect("Should deserialize");

    let connected_set: std::collections::HashSet<&str> =
        response.connected.iter().map(|s| s.as_str()).collect();

    let mut connected_model_count = 0;

    for provider in &response.all {
        if connected_set.contains(provider.id.as_str()) {
            connected_model_count += provider.models.len();
        }
    }

    assert_eq!(connected_model_count, 3);
}

/// Test convert_api_response_to_message with user message containing text
#[test]
fn test_convert_user_message_with_text() {
    let json = r#"{
            "info": {
                "id": "msg_user_123",
                "sessionID": "ses_abc",
                "role": "user",
                "time": {"created": 1769281090128},
                "summary": {"title": "How do I fix this bug?"}
            },
            "parts": [
                {
                    "id": "prt_1",
                    "sessionID": "ses_abc",
                    "messageID": "msg_user_123",
                    "type": "text",
                    "text": "How do I fix this bug?"
                }
            ]
        }"#;

    let response: OpenCodeApiMessageResponse =
        serde_json::from_str(json).expect("Should deserialize");
    let message = OpenCodeHttpClient::convert_api_response_to_message(response);

    assert_eq!(message.id, "msg_user_123");
    assert_eq!(message.role, "user");
    assert_eq!(message.timestamp, Some("1769281090128".to_string()));
    assert_eq!(message.parts.len(), 1);

    match &message.parts[0] {
        OpenCodeMessagePart::Text { text } => {
            assert_eq!(text, "How do I fix this bug?");
        }
        _ => panic!("Expected Text part"),
    }
}

/// Test convert_api_response_to_message with assistant message containing tool invocation
#[test]
fn test_convert_assistant_message_with_tool() {
    let json = r#"{
            "info": {
                "id": "msg_assist_456",
                "sessionID": "ses_abc",
                "role": "assistant",
                "time": {"created": 1769281090136, "completed": 1769281096519},
                "model": {"providerID": "anthropic", "modelID": "claude-3-7-sonnet"}
            },
            "parts": [
                {
                    "id": "prt_tool_1",
                    "sessionID": "ses_abc",
                    "messageID": "msg_assist_456",
                    "type": "tool-invocation",
                    "name": "bash",
                    "arguments": {"command": "ls -la", "description": "List files"}
                },
                {
                    "id": "prt_text_1",
                    "sessionID": "ses_abc",
                    "messageID": "msg_assist_456",
                    "type": "text",
                    "text": "Let me check the files for you."
                }
            ]
        }"#;

    let response: OpenCodeApiMessageResponse =
        serde_json::from_str(json).expect("Should deserialize");
    let message = OpenCodeHttpClient::convert_api_response_to_message(response);

    assert_eq!(message.id, "msg_assist_456");
    assert_eq!(message.role, "assistant");
    assert_eq!(
        message.model,
        Some("anthropic/claude-3-7-sonnet".to_string())
    );
    assert_eq!(message.parts.len(), 2);

    match &message.parts[0] {
        OpenCodeMessagePart::ToolInvocation {
            id, name, input, ..
        } => {
            assert_eq!(id, "prt_tool_1");
            assert_eq!(name, "bash");
            assert!(input.is_object());
        }
        _ => panic!("Expected ToolInvocation as first part"),
    }
}

/// Test convert_api_response_to_message with tool result
#[test]
fn test_convert_message_with_tool_result() {
    let json = r#"{
            "info": {
                "id": "msg_user_789",
                "sessionID": "ses_abc",
                "role": "user",
                "time": {"created": 1769281097000}
            },
            "parts": [
                {
                    "id": "call_func_1",
                    "sessionID": "ses_abc",
                    "messageID": "msg_user_789",
                    "type": "tool-result",
                    "text": "total 128\ndrwxr-xr-x   5 alex  staff   160 Jan 24 10:00 ."
                }
            ]
        }"#;

    let response: OpenCodeApiMessageResponse =
        serde_json::from_str(json).expect("Should deserialize");
    let message = OpenCodeHttpClient::convert_api_response_to_message(response);

    assert_eq!(message.parts.len(), 1);

    match &message.parts[0] {
        OpenCodeMessagePart::ToolResult {
            tool_use_id,
            content,
        } => {
            assert_eq!(tool_use_id, "call_func_1");
            assert!(content.contains("total 128"));
        }
        _ => panic!("Expected ToolResult part"),
    }
}

/// Test convert_api_response_to_message with reasoning part
#[test]
fn test_convert_message_with_reasoning() {
    let json = r#"{
            "info": {
                "id": "msg_assist_reason",
                "sessionID": "ses_abc",
                "role": "assistant",
                "time": {"created": 1769281095000}
            },
            "parts": [
                {
                    "id": "prt_reason",
                    "sessionID": "ses_abc",
                    "messageID": "msg_assist_reason",
                    "type": "reasoning",
                    "text": "Let me analyze the codebase to understand the structure..."
                }
            ]
        }"#;

    let response: OpenCodeApiMessageResponse =
        serde_json::from_str(json).expect("Should deserialize");
    let message = OpenCodeHttpClient::convert_api_response_to_message(response);

    match &message.parts[0] {
        OpenCodeMessagePart::Text { text } => {
            assert!(text.contains("Let me analyze"));
        }
        _ => panic!("Reasoning should convert to Text part"),
    }
}

/// Test convert_api_response_to_message with missing optional fields
#[test]
fn test_convert_message_missing_optional_fields() {
    let json = r#"{
            "info": {
                "id": "msg_minimal",
                "sessionID": "ses_abc",
                "role": "assistant",
                "time": {"created": 1769281090000}
            },
            "parts": []
        }"#;

    let response: OpenCodeApiMessageResponse =
        serde_json::from_str(json).expect("Should deserialize");
    let message = OpenCodeHttpClient::convert_api_response_to_message(response);

    assert_eq!(message.id, "msg_minimal");
    assert_eq!(message.role, "assistant");
    assert_eq!(message.model, None);
    assert!(message.parts.is_empty());
}

/// Test convert_api_response_to_message with unknown part type (fallback to Text)
#[test]
fn test_convert_message_unknown_part_type() {
    let json = r#"{
            "info": {
                "id": "msg_unknown",
                "sessionID": "ses_abc",
                "role": "assistant",
                "time": {"created": 1769281090000}
            },
            "parts": [
                {
                    "id": "prt_unknown",
                    "sessionID": "ses_abc",
                    "messageID": "msg_unknown",
                    "type": "unknown-custom-type",
                    "text": "Some content"
                }
            ]
        }"#;

    let response: OpenCodeApiMessageResponse =
        serde_json::from_str(json).expect("Should deserialize");
    let message = OpenCodeHttpClient::convert_api_response_to_message(response);

    match &message.parts[0] {
        OpenCodeMessagePart::Text { text } => {
            assert_eq!(text, "Some content");
        }
        _ => panic!("Unknown type should fallback to Text"),
    }
}

/// Test full API response deserialization and conversion
#[test]
fn test_full_api_response_conversion() {
    let json = r#"[
            {
                "info": {
                    "id": "msg_1",
                    "sessionID": "ses_test",
                    "role": "user",
                    "time": {"created": 1000000000000},
                    "agent": "build",
                    "model": {"providerID": "openrouter", "modelID": "minimax/minimax-m2.1"}
                },
                "parts": [
                    {
                        "id": "prt_1",
                        "sessionID": "ses_test",
                        "messageID": "msg_1",
                        "type": "text",
                        "text": "Hello, help me with my code."
                    }
                ]
            },
            {
                "info": {
                    "id": "msg_2",
                    "sessionID": "ses_test",
                    "role": "assistant",
                    "time": {"created": 1000000001000, "completed": 1000000002000},
                    "agent": "build",
                    "model": {"providerID": "openrouter", "modelID": "minimax/minimax-m2.1"}
                },
                "parts": [
                    {
                        "id": "prt_2",
                        "sessionID": "ses_test",
                        "messageID": "msg_2",
                        "type": "step-start",
                        "text": "I'll help you with your code."
                    }
                ]
            }
        ]"#;

    let api_responses: Vec<OpenCodeApiMessageResponse> =
        serde_json::from_str(json).expect("Should deserialize array");
    let messages: Vec<OpenCodeMessage> = api_responses
        .into_iter()
        .map(OpenCodeHttpClient::convert_api_response_to_message)
        .collect();

    assert_eq!(messages.len(), 2);

    // Verify first message (user)
    assert_eq!(messages[0].id, "msg_1");
    assert_eq!(messages[0].role, "user");
    assert_eq!(
        messages[0].model,
        Some("openrouter/minimax/minimax-m2.1".to_string())
    );

    // Verify second message (assistant)
    assert_eq!(messages[1].id, "msg_2");
    assert_eq!(messages[1].role, "assistant");
    assert_eq!(
        messages[1].model,
        Some("openrouter/minimax/minimax-m2.1".to_string())
    );
}

/// Test convert_api_response_to_message with "tool" type (not tool-invocation)
#[test]
fn test_convert_message_with_tool_type() {
    let json = r#"{
            "info": {
                "id": "msg_tool_type",
                "sessionID": "ses_abc",
                "role": "assistant",
                "time": {"created": 1769281090000}
            },
            "parts": [
                {
                    "id": "prt_tool_1",
                    "sessionID": "ses_abc",
                    "messageID": "msg_tool_type",
                    "type": "tool",
                    "name": "read_file",
                    "arguments": {"path": "/test/file.txt"}
                }
            ]
        }"#;

    let response: OpenCodeApiMessageResponse =
        serde_json::from_str(json).expect("Should deserialize");
    let message = OpenCodeHttpClient::convert_api_response_to_message(response);

    assert_eq!(message.parts.len(), 1);

    match &message.parts[0] {
        OpenCodeMessagePart::ToolInvocation {
            id, name, input, ..
        } => {
            assert_eq!(id, "prt_tool_1");
            assert_eq!(name, "read_file");
            // Verify the arguments alias worked
            assert!(input.is_object());
            assert_eq!(input.get("path").unwrap(), "/test/file.txt");
        }
        _ => panic!("Expected ToolInvocation part"),
    }
}

/// Test convert_api_response_to_message with tool field + callID (OpenCode format)
#[test]
fn test_convert_message_with_tool_field_and_call_id() {
    let json = r#"{
            "info": {
                "id": "msg_tool_call_id",
                "sessionID": "ses_abc",
                "role": "assistant",
                "time": {"created": 1769281090000}
            },
            "parts": [
                {
                    "id": "prt_tool_1",
                    "sessionID": "ses_abc",
                    "messageID": "msg_tool_call_id",
                    "type": "tool",
                    "tool": "webfetch",
                    "callID": "call_webfetch_1",
                    "state": {
                        "status": "pending",
                        "input": {
                            "url": "https://example.com",
                            "format": "markdown"
                        }
                    }
                }
            ]
        }"#;

    let response: OpenCodeApiMessageResponse =
        serde_json::from_str(json).expect("Should deserialize");
    let message = OpenCodeHttpClient::convert_api_response_to_message(response);

    assert_eq!(message.parts.len(), 1);

    match &message.parts[0] {
        OpenCodeMessagePart::ToolInvocation {
            id, name, input, ..
        } => {
            assert_eq!(id, "call_webfetch_1");
            assert_eq!(name, "webfetch");
            assert!(input.is_object());
            assert_eq!(input.get("url").unwrap(), "https://example.com");
        }
        _ => panic!("Expected ToolInvocation part"),
    }
}

/// Test convert_api_response_to_message with tool result using callID/state.output
#[test]
fn test_convert_message_with_tool_result_call_id_and_output() {
    let json = r#"{
            "info": {
                "id": "msg_tool_result",
                "sessionID": "ses_abc",
                "role": "user",
                "time": {"created": 1769281097000}
            },
            "parts": [
                {
                    "id": "prt_result_1",
                    "sessionID": "ses_abc",
                    "messageID": "msg_tool_result",
                    "type": "tool-result",
                    "callID": "call_webfetch_1",
                    "state": {
                        "status": "completed",
                        "output": "fetched content"
                    }
                }
            ]
        }"#;

    let response: OpenCodeApiMessageResponse =
        serde_json::from_str(json).expect("Should deserialize");
    let message = OpenCodeHttpClient::convert_api_response_to_message(response);

    assert_eq!(message.parts.len(), 1);

    match &message.parts[0] {
        OpenCodeMessagePart::ToolResult {
            tool_use_id,
            content,
        } => {
            assert_eq!(tool_use_id, "call_webfetch_1");
            assert_eq!(content, "fetched content");
        }
        _ => panic!("Expected ToolResult part"),
    }
}

/// Test convert_api_response_to_message with tool using "arguments" field alias
#[test]
fn test_convert_message_with_arguments_alias() {
    let json = r#"{
            "info": {
                "id": "msg_args_alias",
                "sessionID": "ses_abc",
                "role": "assistant",
                "time": {"created": 1769281090000}
            },
            "parts": [
                {
                    "id": "prt_alias",
                    "sessionID": "ses_abc",
                    "messageID": "msg_args_alias",
                    "type": "tool-invocation",
                    "name": "bash",
                    "arguments": {"command": "echo hello", "description": "Test command"}
                }
            ]
        }"#;

    let response: OpenCodeApiMessageResponse =
        serde_json::from_str(json).expect("Should deserialize");
    let message = OpenCodeHttpClient::convert_api_response_to_message(response);

    match &message.parts[0] {
        OpenCodeMessagePart::ToolInvocation { input, .. } => {
            assert!(input.is_object());
            assert_eq!(input.get("command").unwrap(), "echo hello");
            assert_eq!(input.get("description").unwrap(), "Test command");
        }
        _ => panic!("Expected ToolInvocation part"),
    }
}

/// Test convert_api_response_to_message with multiple parts in order
#[test]
fn test_convert_message_multiple_parts_ordered() {
    let json = r#"{
            "info": {
                "id": "msg_multi",
                "sessionID": "ses_abc",
                "role": "assistant",
                "time": {"created": 1769281090000}
            },
            "parts": [
                {
                    "id": "prt_text",
                    "sessionID": "ses_abc",
                    "messageID": "msg_multi",
                    "type": "text",
                    "text": "I'll help you."
                },
                {
                    "id": "prt_tool",
                    "sessionID": "ses_abc",
                    "messageID": "msg_multi",
                    "type": "tool",
                    "name": "bash",
                    "arguments": {"command": "ls"}
                },
                {
                    "id": "prt_result",
                    "sessionID": "ses_abc",
                    "messageID": "msg_multi",
                    "type": "tool-result",
                    "text": "file1.txt file2.txt"
                }
            ]
        }"#;

    let response: OpenCodeApiMessageResponse =
        serde_json::from_str(json).expect("Should deserialize");
    let message = OpenCodeHttpClient::convert_api_response_to_message(response);

    assert_eq!(message.parts.len(), 3);

    match &message.parts[0] {
        OpenCodeMessagePart::Text { text } => assert_eq!(text, "I'll help you."),
        _ => panic!("First part should be Text"),
    }

    match &message.parts[1] {
        OpenCodeMessagePart::ToolInvocation { name, .. } => assert_eq!(name, "bash"),
        _ => panic!("Second part should be ToolInvocation"),
    }

    match &message.parts[2] {
        OpenCodeMessagePart::ToolResult { content, .. } => {
            assert!(content.contains("file1.txt"));
        }
        _ => panic!("Third part should be ToolResult"),
    }
}

/// Test that the prompt_async endpoint URL is correctly constructed
#[test]
fn test_prompt_async_endpoint_construction() {
    let session_id = "ses_test_123";
    let base_url = "http://127.0.0.1:4096";

    // This is the URL that send_prompt should construct
    let url = format!("{}/session/{}/prompt_async", base_url, session_id);

    assert_eq!(
        url,
        "http://127.0.0.1:4096/session/ses_test_123/prompt_async"
    );
    assert!(url.contains("/prompt_async"));
    assert!(!url.contains("/prompt\""));
}

/// Test permission reply endpoint URL construction
#[test]
fn test_permission_reply_endpoint_url() {
    let request_id = "perm_req_abc123";
    let base_url = "http://127.0.0.1:4096";

    // The API expects: POST /permission/{requestID}/reply
    let url = format!("{}/permission/{}/reply", base_url, request_id);

    assert_eq!(
        url,
        "http://127.0.0.1:4096/permission/perm_req_abc123/reply"
    );
    assert!(url.contains("/permission/"));
    assert!(url.contains("/reply"));
    assert!(!url.contains("/permission/reply")); // Should not have requestID in query or body
}

/// Test question reply endpoint URL construction
#[test]
fn test_question_reply_endpoint_url() {
    let request_id = "ques_req_xyz789";
    let base_url = "http://127.0.0.1:4096";

    // The API expects: POST /question/{requestID}/reply
    let url = format!("{}/question/{}/reply", base_url, request_id);

    assert_eq!(url, "http://127.0.0.1:4096/question/ques_req_xyz789/reply");
    assert!(url.contains("/question/"));
    assert!(url.contains("/reply"));
    assert!(!url.contains("/question/reply")); // Should not have requestID in query or body
}

/// Test permission reply body format
#[test]
fn test_permission_reply_body_format() {
    use serde_json::json;

    let reply = "once";
    let body = json!({
        "reply": reply
    });

    assert_eq!(body.get("reply").unwrap(), "once");
    assert!(body.get("requestID").is_none()); // requestID should not be in body
    assert!(body.get("directory").is_none()); // directory should not be in body
}

/// Test question reply body format
#[test]
fn test_question_reply_body_format() {
    use serde_json::json;

    let answers = vec![
        vec!["answer1".to_string(), "answer2".to_string()],
        vec!["single".to_string()],
    ];
    let body = json!({
        "answers": answers
    });

    assert!(body.get("answers").is_some());
    let answers_arr = body.get("answers").unwrap().as_array().unwrap();
    assert_eq!(answers_arr.len(), 2);
    assert!(body.get("requestID").is_none()); // requestID should not be in body
    assert!(body.get("directory").is_none()); // directory should not be in body
}

/// Test that the frontend's answer format [{questionIndex, answers}] is correctly
/// deserialized into Vec<Vec<String>> by the Tauri command layer.
///
/// Regression test for the type mismatch where Rust expected Vec<Vec<String>>
/// but the frontend was sending Array<{ questionIndex: number; answers: string[] }>.
#[test]
fn test_question_reply_deserializes_frontend_format() {
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct QuestionReplyEntry {
        #[allow(dead_code)]
        question_index: usize,
        answers: Vec<String>,
    }

    // This is the exact format the frontend sends
    let frontend_payload = serde_json::json!([
        { "questionIndex": 0, "answers": ["Option A", "Option B"] },
        { "questionIndex": 1, "answers": ["Yes"] }
    ]);

    let entries: Vec<QuestionReplyEntry> =
        serde_json::from_value(frontend_payload).expect("should deserialize frontend format");
    let parsed: Vec<Vec<String>> = entries.into_iter().map(|e| e.answers).collect();

    assert_eq!(parsed.len(), 2);
    assert_eq!(parsed[0], vec!["Option A", "Option B"]);
    assert_eq!(parsed[1], vec!["Yes"]);
}

/// Test that Vec<Vec<String>> (the old format) is rejected by the new deserializer,
/// confirming the break from the old contract.
#[test]
fn test_question_reply_rejects_old_flat_array_format() {
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct QuestionReplyEntry {
        #[allow(dead_code)]
        question_index: usize,
        #[allow(dead_code)]
        answers: Vec<String>,
    }

    // Old format: Vec<Vec<String>> — should fail to deserialize as QuestionReplyEntry
    let old_format = serde_json::json!([["answer1", "answer2"], ["single"]]);
    let result: Result<Vec<QuestionReplyEntry>, _> = serde_json::from_value(old_format);
    assert!(
        result.is_err(),
        "old Vec<Vec<String>> format should be rejected"
    );
}

/// Test validate_request_id allows safe characters
#[test]
fn test_validate_request_id_allows_safe_chars() {
    assert!(OpenCodeHttpClient::validate_request_id("abc123").is_ok());
    assert!(OpenCodeHttpClient::validate_request_id("abc-123").is_ok());
    assert!(OpenCodeHttpClient::validate_request_id("abc_123").is_ok());
    assert!(OpenCodeHttpClient::validate_request_id("ABC-def-123_XYZ").is_ok());
    // UUID-style
    assert!(
        OpenCodeHttpClient::validate_request_id("550e8400-e29b-41d4-a716-446655440000").is_ok()
    );
}

/// Test validate_request_id rejects path injection characters
#[test]
fn test_validate_request_id_rejects_path_injection() {
    assert!(OpenCodeHttpClient::validate_request_id("").is_err()); // empty
    assert!(OpenCodeHttpClient::validate_request_id("../etc/passwd").is_err()); // path traversal
    assert!(OpenCodeHttpClient::validate_request_id("id/extra").is_err()); // slash
    assert!(OpenCodeHttpClient::validate_request_id("id?query=x").is_err()); // query string
    assert!(OpenCodeHttpClient::validate_request_id("id#fragment").is_err()); // fragment
    assert!(OpenCodeHttpClient::validate_request_id("id with spaces").is_err());
    // spaces
}

#[test]
fn test_seed_current_model_from_session_state() {
    let manager = Arc::new(Mutex::new(OpenCodeManager::new(PathBuf::from(
        "/tmp/project",
    ))));
    let provider = Arc::new(OpenCodeProvider);
    let mut client =
        OpenCodeHttpClient::new(manager, "/tmp/project".to_string(), provider).expect("client");

    client
        .seed_current_model("github-copilot/claude-opus-4.6")
        .expect("model should seed");

    let current_model = client
        .current_model
        .expect("current model should be stored");
    assert_eq!(current_model.provider_id, "github-copilot");
    assert_eq!(current_model.model_id, "claude-opus-4.6");
}

#[tokio::test]
async fn test_validate_session_binding_allows_global_project_id_when_directory_matches() {
    let manager = Arc::new(Mutex::new(OpenCodeManager::new(PathBuf::from(
        "/tmp/project",
    ))));
    let provider = Arc::new(OpenCodeProvider);
    let client =
        OpenCodeHttpClient::new(manager, "/tmp/project".to_string(), provider).expect("client");

    let session = Session {
        id: "ses_test".to_string(),
        project_id: "global".to_string(),
        directory: "/tmp/project".to_string(),
        title: None,
    };

    client
        .validate_session_binding(&session)
        .await
        .expect("global project ID should be accepted when directory matches");
}

#[tokio::test]
async fn test_validate_session_binding_still_rejects_directory_mismatch() {
    let manager = Arc::new(Mutex::new(OpenCodeManager::new(PathBuf::from(
        "/tmp/project",
    ))));
    let provider = Arc::new(OpenCodeProvider);
    let client =
        OpenCodeHttpClient::new(manager, "/tmp/project".to_string(), provider).expect("client");

    let session = Session {
        id: "ses_test".to_string(),
        project_id: "global".to_string(),
        directory: "/tmp/other-project".to_string(),
        title: None,
    };

    let error = client
        .validate_session_binding(&session)
        .await
        .expect_err("mismatched directories should still fail");
    assert_eq!(
        error.to_string(),
        "Invalid state: OpenCode session binding mismatch: expected directory /tmp/project, got /tmp/other-project"
    );
}

#[test]
fn test_reconnect_method_follows_provider_policy() {
    let manager = Arc::new(Mutex::new(OpenCodeManager::new(PathBuf::from(
        "/tmp/project",
    ))));
    let provider = Arc::new(OpenCodeProvider);
    let client =
        OpenCodeHttpClient::new(manager, "/tmp/project".to_string(), provider).expect("client");

    assert_eq!(
        AgentClient::reconnect_method(&client),
        ReconnectSessionMethod::Load
    );
}
