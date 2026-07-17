//! Tests for cc_sdk::types — moved from inline mod tests block.

#![cfg(test)]

use super::*;
use std::collections::HashMap;

#[test]
fn test_permission_mode_serialization() {
    let mode = PermissionMode::AcceptEdits;
    let json = serde_json::to_string(&mode).unwrap();
    assert_eq!(json, r#""acceptEdits""#);

    let deserialized: PermissionMode = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized, mode);

    // Test Plan mode
    let plan_mode = PermissionMode::Plan;
    let plan_json = serde_json::to_string(&plan_mode).unwrap();
    assert_eq!(plan_json, r#""plan""#);

    let plan_deserialized: PermissionMode = serde_json::from_str(&plan_json).unwrap();
    assert_eq!(plan_deserialized, plan_mode);
}

#[test]
fn test_message_serialization() {
    let msg = Message::User {
        message: UserMessage {
            content: "Hello".to_string(),
        },
    };

    let json = serde_json::to_string(&msg).unwrap();
    assert!(json.contains(r#""type":"user""#));
    assert!(json.contains(r#""content":"Hello""#));

    let deserialized: Message = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized, msg);
}

#[test]
#[allow(deprecated)]
fn test_options_builder() {
    let options = ClaudeCodeOptions::builder()
        .system_prompt("Test prompt")
        .model("claude-3-opus")
        .permission_mode(PermissionMode::AcceptEdits)
        .allow_tool("read")
        .allow_tool("write")
        .max_turns(10)
        .build();

    assert_eq!(options.system_prompt, Some("Test prompt".to_string()));
    assert_eq!(options.model, Some("claude-3-opus".to_string()));
    assert_eq!(options.permission_mode, PermissionMode::AcceptEdits);
    assert_eq!(options.allowed_tools, vec!["read", "write"]);
    assert_eq!(options.max_turns, Some(10));
}

#[test]
fn test_extra_args() {
    let mut extra_args = HashMap::new();
    extra_args.insert("custom-flag".to_string(), Some("value".to_string()));
    extra_args.insert("boolean-flag".to_string(), None);

    let options = ClaudeCodeOptions::builder()
        .extra_args(extra_args.clone())
        .add_extra_arg("another-flag", Some("another-value".to_string()))
        .build();

    assert_eq!(options.extra_args.len(), 3);
    assert_eq!(
        options.extra_args.get("custom-flag"),
        Some(&Some("value".to_string()))
    );
    assert_eq!(options.extra_args.get("boolean-flag"), Some(&None));
    assert_eq!(
        options.extra_args.get("another-flag"),
        Some(&Some("another-value".to_string()))
    );
}

#[test]
fn test_thinking_content_serialization() {
    let thinking = ThinkingContent {
        thinking: "Let me think about this...".to_string(),
        signature: "sig123".to_string(),
    };

    let json = serde_json::to_string(&thinking).unwrap();
    assert!(json.contains(r#""thinking":"Let me think about this...""#));
    assert!(json.contains(r#""signature":"sig123""#));

    let deserialized: ThinkingContent = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized.thinking, thinking.thinking);
    assert_eq!(deserialized.signature, thinking.signature);
}

// ============== v0.4.0 New Feature Tests ==============

#[test]
fn test_tools_config_list_serialization() {
    let tools = ToolsConfig::List(vec![
        "Read".to_string(),
        "Write".to_string(),
        "Bash".to_string(),
    ]);
    let json = serde_json::to_string(&tools).unwrap();

    // List variant serializes as JSON array
    assert!(json.contains("Read"));
    assert!(json.contains("Write"));
    assert!(json.contains("Bash"));

    let deserialized: ToolsConfig = serde_json::from_str(&json).unwrap();
    match deserialized {
        ToolsConfig::List(list) => {
            assert_eq!(list.len(), 3);
            assert!(list.contains(&"Read".to_string()));
        }
        _ => panic!("Expected List variant"),
    }
}

#[test]
fn test_tools_config_preset_serialization() {
    // Test claude_code preset using the helper method
    let preset = ToolsConfig::claude_code_preset();
    let json = serde_json::to_string(&preset).unwrap();
    assert!(json.contains("preset"));
    assert!(json.contains("claude_code"));

    // Test Preset variant with custom values
    let custom_preset = ToolsConfig::Preset(ToolsPreset {
        preset_type: "preset".to_string(),
        preset: "custom".to_string(),
    });
    let json = serde_json::to_string(&custom_preset).unwrap();
    assert!(json.contains("custom"));

    // Test deserialization
    let deserialized: ToolsConfig = serde_json::from_str(&json).unwrap();
    match deserialized {
        ToolsConfig::Preset(p) => assert_eq!(p.preset, "custom"),
        _ => panic!("Expected Preset variant"),
    }
}

#[test]
fn test_tools_config_helper_methods() {
    // Test list() helper
    let tools = ToolsConfig::list(vec!["Read".to_string(), "Write".to_string()]);
    match tools {
        ToolsConfig::List(list) => assert_eq!(list.len(), 2),
        _ => panic!("Expected List variant"),
    }

    // Test none() helper (empty list)
    let empty = ToolsConfig::none();
    match empty {
        ToolsConfig::List(list) => assert!(list.is_empty()),
        _ => panic!("Expected empty List variant"),
    }

    // Test claude_code_preset() helper
    let preset = ToolsConfig::claude_code_preset();
    match preset {
        ToolsConfig::Preset(p) => {
            assert_eq!(p.preset_type, "preset");
            assert_eq!(p.preset, "claude_code");
        }
        _ => panic!("Expected Preset variant"),
    }
}

#[test]
fn test_sdk_beta_serialization() {
    let beta = SdkBeta::Context1M;
    let json = serde_json::to_string(&beta).unwrap();
    // The enum uses rename = "context-1m-2025-08-07"
    assert_eq!(json, r#""context-1m-2025-08-07""#);

    // Test Display trait
    let display = format!("{}", beta);
    assert_eq!(display, "context-1m-2025-08-07");

    // Test deserialization
    let deserialized: SdkBeta = serde_json::from_str(r#""context-1m-2025-08-07""#).unwrap();
    assert!(matches!(deserialized, SdkBeta::Context1M));
}

#[test]
fn test_sandbox_settings_serialization() {
    let sandbox = SandboxSettings {
        enabled: Some(true),
        auto_allow_bash_if_sandboxed: Some(true),
        excluded_commands: Some(vec!["git".to_string(), "docker".to_string()]),
        allow_unsandboxed_commands: Some(false),
        network: Some(SandboxNetworkConfig {
            allow_unix_sockets: Some(vec!["/tmp/ssh-agent.sock".to_string()]),
            allow_all_unix_sockets: Some(false),
            allow_local_binding: Some(true),
            http_proxy_port: Some(8080),
            socks_proxy_port: Some(1080),
        }),
        ignore_violations: Some(SandboxIgnoreViolations {
            file: Some(vec!["/tmp".to_string(), "/var/log".to_string()]),
            network: Some(vec!["localhost".to_string()]),
        }),
        enable_weaker_nested_sandbox: Some(false),
    };

    let json = serde_json::to_string(&sandbox).unwrap();
    assert!(json.contains("enabled"));
    assert!(json.contains("autoAllowBashIfSandboxed")); // camelCase
    assert!(json.contains("excludedCommands"));
    assert!(json.contains("httpProxyPort"));
    assert!(json.contains("8080"));

    let deserialized: SandboxSettings = serde_json::from_str(&json).unwrap();
    assert!(deserialized.enabled.unwrap());
    assert!(deserialized.network.is_some());
    assert_eq!(
        deserialized.network.as_ref().unwrap().http_proxy_port,
        Some(8080)
    );
}

#[test]
fn test_sandbox_network_config() {
    let config = SandboxNetworkConfig {
        allow_unix_sockets: Some(vec!["/run/user/1000/keyring/ssh".to_string()]),
        allow_all_unix_sockets: Some(false),
        allow_local_binding: Some(true),
        http_proxy_port: Some(3128),
        socks_proxy_port: Some(1080),
    };

    let json = serde_json::to_string(&config).unwrap();
    let deserialized: SandboxNetworkConfig = serde_json::from_str(&json).unwrap();

    assert_eq!(deserialized.http_proxy_port, Some(3128));
    assert_eq!(deserialized.socks_proxy_port, Some(1080));
    assert_eq!(deserialized.allow_local_binding, Some(true));
}

#[test]
fn test_sandbox_ignore_violations() {
    let violations = SandboxIgnoreViolations {
        file: Some(vec!["/tmp".to_string(), "/var/cache".to_string()]),
        network: Some(vec!["127.0.0.1".to_string(), "localhost".to_string()]),
    };

    let json = serde_json::to_string(&violations).unwrap();
    assert!(json.contains("file"));
    assert!(json.contains("/tmp"));

    let deserialized: SandboxIgnoreViolations = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized.file.as_ref().unwrap().len(), 2);
    assert_eq!(deserialized.network.as_ref().unwrap().len(), 2);
}

#[test]
fn test_sandbox_settings_default() {
    let sandbox = SandboxSettings::default();
    assert!(sandbox.enabled.is_none());
    assert!(sandbox.network.is_none());
    assert!(sandbox.ignore_violations.is_none());
}

#[test]
fn test_sdk_plugin_config_serialization() {
    let plugin = SdkPluginConfig::Local {
        path: "/path/to/plugin".to_string(),
    };

    let json = serde_json::to_string(&plugin).unwrap();
    assert!(json.contains("local")); // lowercase due to rename_all
    assert!(json.contains("/path/to/plugin"));

    let deserialized: SdkPluginConfig = serde_json::from_str(&json).unwrap();
    match deserialized {
        SdkPluginConfig::Local { path } => {
            assert_eq!(path, "/path/to/plugin");
        }
    }
}

#[test]
fn test_sdk_control_rewind_files_request() {
    let request = SDKControlRewindFilesRequest {
        subtype: "rewind_files".to_string(),
        user_message_id: "msg_12345".to_string(),
    };

    let json = serde_json::to_string(&request).unwrap();
    assert!(json.contains("user_message_id"));
    assert!(json.contains("msg_12345"));
    assert!(json.contains("subtype"));
    assert!(json.contains("rewind_files"));

    let deserialized: SDKControlRewindFilesRequest = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized.user_message_id, "msg_12345");
    assert_eq!(deserialized.subtype, "rewind_files");
}

#[test]
fn test_options_builder_with_new_fields() {
    let options = ClaudeCodeOptions::builder()
        .tools(ToolsConfig::claude_code_preset())
        .add_beta(SdkBeta::Context1M)
        .max_budget_usd(10.0)
        .fallback_model("claude-3-haiku")
        .output_format(serde_json::json!({"type": "object"}))
        .enable_file_checkpointing(true)
        .sandbox(SandboxSettings::default())
        .add_plugin(SdkPluginConfig::Local {
            path: "/plugin".to_string(),
        })
        .auto_download_cli(true)
        .build();

    // Verify tools
    assert!(options.tools.is_some());
    match options.tools.as_ref().unwrap() {
        ToolsConfig::Preset(preset) => assert_eq!(preset.preset, "claude_code"),
        _ => panic!("Expected Preset variant"),
    }

    // Verify betas
    assert_eq!(options.betas.len(), 1);
    assert!(matches!(options.betas[0], SdkBeta::Context1M));

    // Verify max_budget_usd
    assert_eq!(options.max_budget_usd, Some(10.0));

    // Verify fallback_model
    assert_eq!(options.fallback_model, Some("claude-3-haiku".to_string()));

    // Verify output_format
    assert!(options.output_format.is_some());

    // Verify enable_file_checkpointing
    assert!(options.enable_file_checkpointing);

    // Verify sandbox
    assert!(options.sandbox.is_some());

    // Verify plugins
    assert_eq!(options.plugins.len(), 1);

    // Deprecated compatibility value is still preserved on options.
    assert!(options.auto_download_cli);
}

#[test]
fn test_options_builder_with_tools_list() {
    let options = ClaudeCodeOptions::builder()
        .tools(ToolsConfig::List(vec![
            "Read".to_string(),
            "Bash".to_string(),
        ]))
        .build();

    match options.tools.as_ref().unwrap() {
        ToolsConfig::List(list) => {
            assert_eq!(list.len(), 2);
            assert!(list.contains(&"Read".to_string()));
            assert!(list.contains(&"Bash".to_string()));
        }
        _ => panic!("Expected List variant"),
    }
}

#[test]
fn test_options_builder_multiple_betas() {
    let options = ClaudeCodeOptions::builder()
        .add_beta(SdkBeta::Context1M)
        .betas(vec![SdkBeta::Context1M])
        .build();

    // betas() replaces, add_beta() appends - so only 1 from betas()
    assert_eq!(options.betas.len(), 1);
}

#[test]
fn test_options_builder_add_beta_accumulates() {
    let options = ClaudeCodeOptions::builder()
        .add_beta(SdkBeta::Context1M)
        .add_beta(SdkBeta::Context1M)
        .build();

    // add_beta() accumulates
    assert_eq!(options.betas.len(), 2);
}

#[test]
fn test_options_builder_multiple_plugins() {
    let options = ClaudeCodeOptions::builder()
        .add_plugin(SdkPluginConfig::Local {
            path: "/plugin1".to_string(),
        })
        .add_plugin(SdkPluginConfig::Local {
            path: "/plugin2".to_string(),
        })
        .plugins(vec![SdkPluginConfig::Local {
            path: "/plugin3".to_string(),
        }])
        .build();

    // plugins() replaces previous, so only 1
    assert_eq!(options.plugins.len(), 1);
}

#[test]
fn test_options_builder_add_plugin_accumulates() {
    let options = ClaudeCodeOptions::builder()
        .add_plugin(SdkPluginConfig::Local {
            path: "/plugin1".to_string(),
        })
        .add_plugin(SdkPluginConfig::Local {
            path: "/plugin2".to_string(),
        })
        .add_plugin(SdkPluginConfig::Local {
            path: "/plugin3".to_string(),
        })
        .build();

    // add_plugin() accumulates
    assert_eq!(options.plugins.len(), 3);
}

#[test]
fn test_message_result_with_structured_output() {
    // Test parsing result message with structured_output (snake_case)
    let json = r#"{
            "type": "result",
            "subtype": "success",
            "cost_usd": 0.05,
            "duration_ms": 1500,
            "duration_api_ms": 1200,
            "is_error": false,
            "num_turns": 3,
            "session_id": "session_123",
            "structured_output": {"answer": 42}
        }"#;

    let msg: Message = serde_json::from_str(json).unwrap();
    match msg {
        Message::Result {
            structured_output, ..
        } => {
            assert!(structured_output.is_some());
            let output = structured_output.unwrap();
            assert_eq!(output["answer"], 42);
        }
        _ => panic!("Expected Result message"),
    }
}

#[test]
fn test_message_result_with_structured_output_camel_case() {
    // Test parsing result message with structuredOutput (camelCase alias)
    let json = r#"{
            "type": "result",
            "subtype": "success",
            "cost_usd": 0.05,
            "duration_ms": 1500,
            "duration_api_ms": 1200,
            "is_error": false,
            "num_turns": 3,
            "session_id": "session_123",
            "structuredOutput": {"name": "test", "value": true}
        }"#;

    let msg: Message = serde_json::from_str(json).unwrap();
    match msg {
        Message::Result {
            structured_output, ..
        } => {
            assert!(structured_output.is_some());
            let output = structured_output.unwrap();
            assert_eq!(output["name"], "test");
            assert_eq!(output["value"], true);
        }
        _ => panic!("Expected Result message"),
    }
}

#[test]
fn test_default_options_new_fields() {
    let options = ClaudeCodeOptions::default();

    // Verify defaults for new fields
    assert!(options.tools.is_none());
    assert!(options.betas.is_empty());
    assert!(options.max_budget_usd.is_none());
    assert!(options.fallback_model.is_none());
    assert!(options.output_format.is_none());
    assert!(!options.enable_file_checkpointing);
    assert!(options.sandbox.is_none());
    assert!(options.plugins.is_empty());
    assert!(options.user.is_none());
    // Deprecated compatibility value defaults to false and is ignored by
    // runtime transport creation.
    assert!(!options.auto_download_cli);
}
