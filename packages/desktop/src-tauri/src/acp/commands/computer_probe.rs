use crate::acp::error::SerializableAcpError;
use crate::commands::observability::{expected_acp_command_result, CommandResult};
use crate::computer_use::{
    build_computer_mcp_server_with_runtime, ComputerRuntimeRegistry, COMPUTER_MCP_ACT_TOOL_NAME,
    COMPUTER_MCP_SERVER_NAME,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use specta::Type;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ComputerUseProbe {
    pub server_name: String,
    pub tool_name: String,
    pub session_id: String,
    pub transport: String,
    pub ok: bool,
    pub is_error: bool,
    pub payload_json: String,
    pub app: Option<String>,
    pub window: Option<String>,
    pub element_count: usize,
    pub error_code: Option<String>,
    pub permission_kind: Option<String>,
    pub action_verb: Option<String>,
    pub action_target_label: Option<String>,
    pub action_target_id: Option<String>,
    pub action_ok: Option<bool>,
    pub action_error_code: Option<String>,
    pub action_changed_count: Option<usize>,
    pub action_element_count: Option<usize>,
}

#[tauri::command]
#[specta::specta]
pub async fn acp_probe_computer_use(
    app: AppHandle,
    session_id: String,
    action: Option<String>,
    target_label: Option<String>,
    text: Option<String>,
    key: Option<String>,
    dx: Option<i32>,
    dy: Option<i32>,
) -> CommandResult<ComputerUseProbe> {
    expected_acp_command_result(
        "acp_probe_computer_use",
        async {
            let computer_runtime_registry = app
                .try_state::<Arc<ComputerRuntimeRegistry>>()
                .map(|state| Arc::clone(state.inner()))
                .ok_or_else(|| SerializableAcpError::InvalidState {
                    message: "Computer runtime registry is not available".to_string(),
                })?;

            let _ = crate::commands::window::activate_window(app.clone(), "main".to_string());
            tokio::time::sleep(Duration::from_millis(150)).await;

            let runtime = computer_runtime_registry.runtime_for_session(&session_id);
            let server = build_computer_mcp_server_with_runtime(runtime);
            let observe_response = call_computer_tool(&server, json!({ "v": "observe" })).await?;
            let observe_payload = computer_payload_from_mcp_response(&observe_response)?;

            let Some(action_verb) = normalized_probe_action(action) else {
                return computer_probe_from_mcp_response(session_id, observe_response, None);
            };

            let Some(target_label) = target_label.filter(|label| !label.trim().is_empty()) else {
                return Err(SerializableAcpError::InvalidState {
                    message: "Computer action probe requires targetLabel.".to_string(),
                });
            };
            let target_id =
                target_id_for_label(&observe_payload, &target_label).ok_or_else(|| {
                    SerializableAcpError::InvalidState {
                        message: format!(
                            "Computer action probe could not find target label: {target_label}"
                        ),
                    }
                })?;
            let epoch = observe_payload
                .get("epoch")
                .or_else(|| observe_payload.get("e"))
                .and_then(Value::as_str)
                .ok_or_else(|| SerializableAcpError::InvalidState {
                    message: "Computer observe probe did not return an epoch.".to_string(),
                })?;

            let action_arguments =
                action_arguments(&action_verb, &target_id, epoch, text, key, dx, dy);
            let action_response = call_computer_tool(&server, action_arguments).await?;
            let action_summary =
                computer_action_summary(&action_verb, target_label, target_id, &action_response)?;

            computer_probe_from_mcp_response(session_id, action_response, Some(action_summary))
        }
        .await,
    )
}

async fn call_computer_tool(
    server: &crate::cc_sdk::SdkMcpServer,
    arguments: Value,
) -> Result<Value, SerializableAcpError> {
    server
        .handle_message(json!({
            "jsonrpc": "2.0",
            "id": "acepe-computer-use-probe",
            "method": "tools/call",
            "params": {
                "name": COMPUTER_MCP_ACT_TOOL_NAME,
                "arguments": arguments
            }
        }))
        .await
        .map_err(|error| SerializableAcpError::InvalidState {
            message: format!("Computer MCP probe failed: {error}"),
        })
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ComputerActionProbeSummary {
    verb: String,
    target_label: String,
    target_id: String,
    ok: bool,
    error_code: Option<String>,
    changed_count: usize,
    element_count: usize,
}

fn computer_probe_from_mcp_response(
    session_id: String,
    response: Value,
    action: Option<ComputerActionProbeSummary>,
) -> Result<ComputerUseProbe, SerializableAcpError> {
    let payload = computer_payload_from_mcp_response(&response)?;
    let result = response
        .get("result")
        .ok_or_else(|| SerializableAcpError::InvalidState {
            message: "Computer MCP probe response did not include a result".to_string(),
        })?;
    let is_error = result
        .get("isError")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let payload_text = computer_payload_text(result)?;
    let environment = object_field(&payload, &["environment", "env"]);
    let error = object_field(&payload, &["error", "err"]);
    let action_verb = action.as_ref().map(|summary| summary.verb.clone());
    let action_target_label = action.as_ref().map(|summary| summary.target_label.clone());
    let action_target_id = action.as_ref().map(|summary| summary.target_id.clone());
    let action_ok = action.as_ref().map(|summary| summary.ok);
    let action_error_code = action
        .as_ref()
        .and_then(|summary| summary.error_code.clone());
    let action_changed_count = action.as_ref().map(|summary| summary.changed_count);
    let action_element_count = action.as_ref().map(|summary| summary.element_count);

    Ok(ComputerUseProbe {
        server_name: COMPUTER_MCP_SERVER_NAME.to_string(),
        tool_name: COMPUTER_MCP_ACT_TOOL_NAME.to_string(),
        session_id,
        transport: "tauri_command_to_in_process_mcp".to_string(),
        ok: payload
            .get("ok")
            .and_then(Value::as_bool)
            .unwrap_or(!is_error && error.is_none()),
        is_error,
        payload_json: payload_text.to_string(),
        app: environment
            .and_then(|environment| string_field(environment, &["app", "a"]))
            .and_then(Value::as_str)
            .map(ToString::to_string),
        window: environment
            .and_then(|environment| string_field(environment, &["window", "w"]))
            .and_then(Value::as_str)
            .map(ToString::to_string),
        element_count: elements_from_payload(&payload)
            .and_then(Value::as_array)
            .map(Vec::len)
            .unwrap_or(0),
        error_code: error
            .and_then(|error| string_field(error, &["code", "c"]))
            .and_then(Value::as_str)
            .map(ToString::to_string),
        permission_kind: error
            .and_then(|error| string_field(error, &["permission_kind", "pk"]))
            .and_then(Value::as_str)
            .map(ToString::to_string),
        action_verb,
        action_target_label,
        action_target_id,
        action_ok,
        action_error_code,
        action_changed_count,
        action_element_count,
    })
}

fn computer_payload_from_mcp_response(response: &Value) -> Result<Value, SerializableAcpError> {
    let result = response
        .get("result")
        .ok_or_else(|| SerializableAcpError::InvalidState {
            message: "Computer MCP probe response did not include a result".to_string(),
        })?;
    let payload_text = computer_payload_text(result)?;
    serde_json::from_str::<Value>(payload_text).map_err(|error| {
        SerializableAcpError::InvalidState {
            message: format!("Computer MCP probe returned invalid JSON: {error}"),
        }
    })
}

fn computer_payload_text(result: &Value) -> Result<&str, SerializableAcpError> {
    result
        .get("content")
        .and_then(Value::as_array)
        .and_then(|content| content.first())
        .and_then(|content| content.get("text"))
        .and_then(Value::as_str)
        .ok_or_else(|| SerializableAcpError::InvalidState {
            message: "Computer MCP probe response did not include text content".to_string(),
        })
}

fn normalized_probe_action(action: Option<String>) -> Option<String> {
    action
        .map(|action| action.trim().to_ascii_lowercase())
        .filter(|action| !action.is_empty())
}

fn object_field<'a>(payload: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    keys.iter().find_map(|key| payload.get(*key))
}

fn string_field<'a>(payload: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    keys.iter().find_map(|key| payload.get(*key))
}

fn elements_from_payload(payload: &Value) -> Option<&Value> {
    object_field(payload, &["elements", "els"])
}

fn changed_from_payload(payload: &Value) -> Option<&Value> {
    object_field(payload, &["changed", "c"])
}

fn target_id_for_label(payload: &Value, target_label: &str) -> Option<String> {
    let target_label = target_label.trim();
    elements_from_payload(payload)
        .and_then(Value::as_array)
        .and_then(|elements| {
            elements
                .iter()
                .filter_map(|element| {
                    let label = string_field(element, &["label", "l"]).and_then(Value::as_str)?;
                    let id = string_field(element, &["id", "i"]).and_then(Value::as_str)?;
                    Some((label, id))
                })
                .find(|(label, _id)| *label == target_label || label.contains(target_label))
                .map(|(_label, id)| id.to_string())
        })
}

fn action_arguments(
    verb: &str,
    target_id: &str,
    epoch: &str,
    text: Option<String>,
    key: Option<String>,
    dx: Option<i32>,
    dy: Option<i32>,
) -> Value {
    let mut arguments = json!({
        "v": verb,
        "t": target_id,
        "e": epoch
    });
    if let Some(text) = text.filter(|text| !text.is_empty()) {
        arguments["txt"] = json!(text);
    }
    if let Some(key) = key.filter(|key| !key.is_empty()) {
        arguments["k"] = json!(key);
    }
    if let Some(dx) = dx {
        arguments["dx"] = json!(dx);
    }
    if let Some(dy) = dy {
        arguments["dy"] = json!(dy);
    }
    arguments
}

fn computer_action_summary(
    verb: &str,
    target_label: String,
    target_id: String,
    response: &Value,
) -> Result<ComputerActionProbeSummary, SerializableAcpError> {
    let payload = computer_payload_from_mcp_response(response)?;
    let error = object_field(&payload, &["error", "err"]);
    Ok(ComputerActionProbeSummary {
        verb: verb.to_string(),
        target_label,
        target_id,
        ok: payload
            .get("ok")
            .and_then(Value::as_bool)
            .unwrap_or(error.is_none()),
        error_code: error
            .and_then(|error| string_field(error, &["code", "c"]))
            .and_then(Value::as_str)
            .map(ToString::to_string),
        changed_count: changed_from_payload(&payload)
            .and_then(Value::as_array)
            .map(Vec::len)
            .or_else(|| {
                elements_from_payload(&payload)
                    .and_then(Value::as_array)
                    .map(Vec::len)
            })
            .unwrap_or(0),
        element_count: elements_from_payload(&payload)
            .and_then(Value::as_array)
            .map(Vec::len)
            .unwrap_or(0),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn computer_probe_summarizes_observation_payload() {
        let probe = computer_probe_from_mcp_response(
            "session-1".to_string(),
            json!({
                "result": {
                    "content": [{
                        "type": "text",
                        "text": "{\"ok\":true,\"epoch\":\"s_0\",\"environment\":{\"app\":\"Acepe\",\"window\":\"Main\"},\"elements\":[{\"id\":\"c_1\",\"role\":\"button\",\"label\":\"Run\",\"enabled\":true}]}"
                    }]
                }
            }),
            None,
        )
        .expect("probe");

        assert!(probe.ok);
        assert!(!probe.is_error);
        assert_eq!(probe.app.as_deref(), Some("Acepe"));
        assert_eq!(probe.window.as_deref(), Some("Main"));
        assert_eq!(probe.element_count, 1);
        assert_eq!(probe.error_code, None);
        assert_eq!(probe.permission_kind, None);
        assert_eq!(probe.action_ok, None);
    }

    #[test]
    fn computer_probe_summarizes_compact_observation_payload() {
        let probe = computer_probe_from_mcp_response(
            "session-1".to_string(),
            json!({
                "result": {
                    "content": [{
                        "type": "text",
                        "text": "{\"e\":\"s_0\",\"env\":{\"a\":\"Acepe\",\"w\":\"Main\"},\"els\":[{\"i\":\"e_1\",\"r\":\"button\",\"l\":\"Run\"}]}"
                    }]
                }
            }),
            None,
        )
        .expect("probe");

        assert!(probe.ok);
        assert!(!probe.is_error);
        assert_eq!(probe.app.as_deref(), Some("Acepe"));
        assert_eq!(probe.window.as_deref(), Some("Main"));
        assert_eq!(probe.element_count, 1);
        assert_eq!(probe.error_code, None);
    }

    #[test]
    fn computer_probe_summarizes_permission_payload() {
        let probe = computer_probe_from_mcp_response(
            "session-1".to_string(),
            json!({
                "result": {
                    "content": [{
                        "type": "text",
                        "text": "{\"ok\":false,\"error\":{\"code\":\"computer_permission_required\",\"message\":\"Accessibility permission required.\",\"permission_kind\":\"accessibility\"}}"
                    }],
                    "isError": true
                }
            }),
            None,
        )
        .expect("probe");

        assert!(!probe.ok);
        assert!(probe.is_error);
        assert_eq!(probe.element_count, 0);
        assert_eq!(
            probe.error_code.as_deref(),
            Some("computer_permission_required")
        );
        assert_eq!(probe.permission_kind.as_deref(), Some("accessibility"));
    }

    #[test]
    fn computer_probe_summarizes_compact_permission_payload() {
        let probe = computer_probe_from_mcp_response(
            "session-1".to_string(),
            json!({
                "result": {
                    "content": [{
                        "type": "text",
                        "text": "{\"err\":{\"c\":\"computer_permission_required\",\"m\":\"Accessibility permission required.\",\"pk\":\"accessibility\"}}"
                    }],
                    "isError": true
                }
            }),
            None,
        )
        .expect("probe");

        assert!(!probe.ok);
        assert!(probe.is_error);
        assert_eq!(
            probe.error_code.as_deref(),
            Some("computer_permission_required")
        );
        assert_eq!(probe.permission_kind.as_deref(), Some("accessibility"));
    }

    #[test]
    fn computer_probe_summarizes_action_payload() {
        let response = json!({
            "result": {
                "content": [{
                    "type": "text",
                    "text": "{\"ok\":true,\"epoch\":\"s_1\",\"environment\":{\"app\":\"Acepe\",\"window\":\"Main\"},\"elements\":[{\"id\":\"c_1\",\"role\":\"button\",\"label\":\"Run\",\"enabled\":true}]}"
                }]
            }
        });
        let action =
            computer_action_summary("click", "Run".to_string(), "c_1".to_string(), &response)
                .expect("action summary");
        let probe =
            computer_probe_from_mcp_response("session-1".to_string(), response, Some(action))
                .expect("probe");

        assert!(probe.ok);
        assert_eq!(probe.action_verb.as_deref(), Some("click"));
        assert_eq!(probe.action_target_label.as_deref(), Some("Run"));
        assert_eq!(probe.action_target_id.as_deref(), Some("c_1"));
        assert_eq!(probe.action_ok, Some(true));
        assert_eq!(probe.action_changed_count, Some(1));
        assert_eq!(probe.action_element_count, Some(1));
    }

    #[test]
    fn computer_probe_summarizes_compact_action_payload() {
        let response = json!({
            "result": {
                "content": [{
                    "type": "text",
                    "text": "{\"e\":\"s_1\",\"els\":[{\"i\":\"e_1\",\"r\":\"button\",\"l\":\"Run\"}]}"
                }]
            }
        });
        let action =
            computer_action_summary("click", "Run".to_string(), "e_1".to_string(), &response)
                .expect("action summary");
        let probe =
            computer_probe_from_mcp_response("session-1".to_string(), response, Some(action))
                .expect("probe");

        assert!(probe.ok);
        assert_eq!(probe.action_verb.as_deref(), Some("click"));
        assert_eq!(probe.action_target_id.as_deref(), Some("e_1"));
        assert_eq!(probe.action_ok, Some(true));
        assert_eq!(probe.action_changed_count, Some(1));
        assert_eq!(probe.action_element_count, Some(1));
    }

    #[test]
    fn target_lookup_accepts_exact_or_contained_label() {
        let payload = json!({
            "elements": [
                { "id": "e_1", "label": "Other" },
                { "id": "e_2", "label": "Computer action click target" }
            ]
        });

        assert_eq!(
            target_id_for_label(&payload, "Computer action click target").as_deref(),
            Some("e_2")
        );
        assert_eq!(
            target_id_for_label(&payload, "click target").as_deref(),
            Some("e_2")
        );
    }

    #[test]
    fn target_lookup_accepts_compact_element_keys() {
        let payload = json!({
            "els": [
                { "i": "e_1", "l": "Other" },
                { "i": "e_2", "l": "Computer action click target" }
            ]
        });

        assert_eq!(
            target_id_for_label(&payload, "click target").as_deref(),
            Some("e_2")
        );
    }
}
