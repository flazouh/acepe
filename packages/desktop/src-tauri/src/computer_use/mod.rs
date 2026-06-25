use std::collections::HashMap;
use std::sync::Arc;
use std::sync::RwLock;

use async_trait::async_trait;
use dashmap::DashMap;
use serde::Serialize;
use serde_json::{json, Value};

use crate::cc_sdk::{
    Result as SdkResult, SdkMcpServer, SdkMcpServerBuilder, SdkToolResultContent, ToolDefinition,
    ToolHandler, ToolInputSchema, ToolResult,
};

pub mod ids;
#[cfg(target_os = "macos")]
pub mod macos_provider;
pub mod mock_provider;
pub mod permissions;
pub mod policy;
pub mod runtime;
pub mod types;

#[cfg(target_os = "macos")]
use macos_provider::MacosComputerProvider;
#[cfg(any(test, not(target_os = "macos")))]
use mock_provider::MockComputerProvider;
use runtime::{ComputerAppWindowScope, ComputerProvider, ComputerRuntime};
use types::{
    ComputerActionInput, ComputerActionVerb, ComputerElement, ComputerEnvironment, ComputerError,
    ComputerObservation,
};

pub use policy::{
    load_persisted_app_window_scopes, persist_app_window_scope_allowed,
    persist_app_window_scope_denied,
};

pub const COMPUTER_MCP_SERVER_NAME: &str = "acepe_computer";
pub const COMPUTER_MCP_ACT_TOOL_NAME: &str = "act";

#[derive(Default)]
pub struct ComputerRuntimeRegistry {
    runtimes_by_session_id: DashMap<String, Arc<ComputerRuntime>>,
    persisted_app_window_scopes: RwLock<Vec<ComputerAppWindowScope>>,
}

impl ComputerRuntimeRegistry {
    pub fn runtime_for_session(&self, session_id: &str) -> Arc<ComputerRuntime> {
        let runtime = self
            .runtimes_by_session_id
            .entry(session_id.to_string())
            .or_insert_with(|| Arc::new(ComputerRuntime::new(default_computer_provider())))
            .clone();

        let persisted_app_window_scopes = self
            .persisted_app_window_scopes
            .read()
            .map(|scopes| scopes.clone())
            .unwrap_or_default();
        if !persisted_app_window_scopes.is_empty() {
            tauri::async_runtime::block_on(
                runtime.replace_allowed_app_window_scopes(&persisted_app_window_scopes),
            );
        }

        runtime
    }

    pub async fn allow_app_window_scope(&self, session_id: &str, scope: ComputerAppWindowScope) {
        self.runtime_for_session(session_id)
            .allow_app_window_scope(scope)
            .await;
    }

    pub async fn deny_app_window_scope(&self, session_id: &str, scope: &ComputerAppWindowScope) {
        self.runtime_for_session(session_id)
            .deny_app_window_scope(scope)
            .await;
    }

    pub async fn deny_app_window_scope_for_all(&self, scope: &ComputerAppWindowScope) {
        for runtime in &self.runtimes_by_session_id {
            runtime.value().deny_app_window_scope(scope).await;
        }
    }

    pub async fn replace_persisted_app_window_scopes(&self, scopes: Vec<ComputerAppWindowScope>) {
        if let Ok(mut persisted_app_window_scopes) = self.persisted_app_window_scopes.write() {
            *persisted_app_window_scopes = scopes.clone();
        }

        for runtime in &self.runtimes_by_session_id {
            runtime
                .value()
                .replace_allowed_app_window_scopes(&scopes)
                .await;
        }
    }
}

pub fn build_computer_mcp_server() -> SdkMcpServer {
    let runtime = Arc::new(ComputerRuntime::new(default_computer_provider()));
    build_computer_mcp_server_with_runtime(runtime)
}

pub fn build_computer_mcp_server_with_runtime(runtime: Arc<ComputerRuntime>) -> SdkMcpServer {
    SdkMcpServerBuilder::new(COMPUTER_MCP_SERVER_NAME)
        .version(env!("CARGO_PKG_VERSION"))
        .tool(computer_act_tool(runtime))
        .build()
}

fn default_computer_provider() -> Box<dyn ComputerProvider> {
    #[cfg(target_os = "macos")]
    {
        Box::new(MacosComputerProvider::default())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Box::new(MockComputerProvider::default_desktop())
    }
}

#[cfg(test)]
fn mock_computer_mcp_server() -> SdkMcpServer {
    let runtime = Arc::new(ComputerRuntime::new(Box::new(
        MockComputerProvider::default_desktop(),
    )));
    SdkMcpServerBuilder::new(COMPUTER_MCP_SERVER_NAME)
        .version(env!("CARGO_PKG_VERSION"))
        .tool(computer_act_tool(runtime))
        .build()
}

fn computer_act_tool(runtime: Arc<ComputerRuntime>) -> ToolDefinition {
    ToolDefinition {
        name: COMPUTER_MCP_ACT_TOOL_NAME.to_string(),
        description: "Desktop UI. In: v verb,t id,e epoch,txt,k,dx/dy,b bounds,s shot. Out: e,env,els,c,sr,err.".to_string(),
        input_schema: computer_act_input_schema(),
        handler: Arc::new(ComputerActToolHandler { runtime }),
    }
}

fn computer_act_input_schema() -> ToolInputSchema {
    let mut properties = HashMap::new();
    properties.insert(
        "v".to_string(),
        json!({
            "type": "string",
            "enum": ["observe", "click", "type", "key", "scroll", "drag"]
        }),
    );
    properties.insert(
        "t".to_string(),
        json!({
            "type": "string"
        }),
    );
    properties.insert(
        "e".to_string(),
        json!({
            "type": "string"
        }),
    );
    properties.insert(
        "b".to_string(),
        json!({
            "type": "boolean"
        }),
    );
    properties.insert(
        "s".to_string(),
        json!({
            "type": "boolean"
        }),
    );
    properties.insert(
        "txt".to_string(),
        json!({
            "type": "string"
        }),
    );
    properties.insert(
        "k".to_string(),
        json!({
            "type": "string"
        }),
    );
    properties.insert(
        "dx".to_string(),
        json!({
            "type": "integer"
        }),
    );
    properties.insert(
        "dy".to_string(),
        json!({
            "type": "integer"
        }),
    );

    ToolInputSchema {
        schema_type: "object".to_string(),
        properties,
        required: Some(vec!["v".to_string()]),
    }
}

struct ComputerActToolHandler {
    runtime: Arc<ComputerRuntime>,
}

#[async_trait]
impl ToolHandler for ComputerActToolHandler {
    async fn execute(&self, args: Value) -> SdkResult<ToolResult> {
        let input = match serde_json::from_value::<ComputerActionInput>(args) {
            Ok(input) => input,
            Err(error) => {
                return Ok(tool_result(
                    mcp_error_output(ComputerError::invalid_input(error.to_string())),
                    true,
                ));
            }
        };

        let verb = input.verb;
        match self.runtime.execute(input).await {
            Ok(observation) => Ok(tool_result(mcp_success_output(verb, observation), false)),
            Err(error) => Ok(tool_result(mcp_error_output(error), true)),
        }
    }
}

#[derive(Debug, Serialize)]
struct CompactComputerObservation {
    #[serde(rename = "e")]
    epoch: String,
    #[serde(rename = "ms", skip_serializing_if = "Option::is_none")]
    settled_ms: Option<u64>,
    #[serde(rename = "env", skip_serializing_if = "Option::is_none")]
    environment: Option<CompactComputerEnvironment>,
    #[serde(rename = "els")]
    elements: Vec<CompactComputerElement>,
    #[serde(rename = "c", skip_serializing_if = "Vec::is_empty")]
    changed: Vec<String>,
    #[serde(rename = "sr", skip_serializing_if = "Option::is_none")]
    screenshot_ref: Option<String>,
}

#[derive(Debug, Serialize)]
struct CompactComputerActionObservation {
    #[serde(rename = "e")]
    epoch: String,
    #[serde(rename = "els", skip_serializing_if = "Vec::is_empty")]
    elements: Vec<CompactComputerElement>,
    #[serde(rename = "sr", skip_serializing_if = "Option::is_none")]
    screenshot_ref: Option<String>,
}

#[derive(Debug, Serialize)]
struct CompactComputerElement {
    #[serde(rename = "i")]
    id: String,
    #[serde(rename = "r")]
    role: String,
    #[serde(rename = "l")]
    label: String,
    #[serde(rename = "v", skip_serializing_if = "Option::is_none")]
    value: Option<String>,
    #[serde(rename = "b", skip_serializing_if = "Option::is_none")]
    bounds: Option<CompactComputerBounds>,
    #[serde(rename = "en", skip_serializing_if = "Option::is_none")]
    enabled: Option<bool>,
}

#[derive(Debug, Serialize)]
struct CompactComputerBounds {
    x: i32,
    y: i32,
    #[serde(rename = "w")]
    width: i32,
    #[serde(rename = "h")]
    height: i32,
}

#[derive(Debug, Serialize)]
struct CompactComputerEnvironment {
    #[serde(rename = "a", skip_serializing_if = "Option::is_none")]
    app: Option<String>,
    #[serde(rename = "w", skip_serializing_if = "Option::is_none")]
    window: Option<String>,
    #[serde(rename = "f", skip_serializing_if = "Option::is_none")]
    focused_target_id: Option<String>,
    #[serde(rename = "b", skip_serializing_if = "Option::is_none")]
    busy: Option<bool>,
}

#[derive(Debug, Serialize)]
struct CompactComputerErrorOutput {
    #[serde(rename = "err")]
    error: CompactComputerError,
}

#[derive(Debug, Serialize)]
struct CompactComputerError {
    #[serde(rename = "c")]
    code: String,
    #[serde(rename = "m")]
    message: String,
    #[serde(rename = "pk", skip_serializing_if = "Option::is_none")]
    permission_kind: Option<permissions::ComputerPermissionKind>,
    #[serde(rename = "a", skip_serializing_if = "Option::is_none")]
    app: Option<Box<str>>,
    #[serde(rename = "w", skip_serializing_if = "Option::is_none")]
    window: Option<Box<str>>,
    #[serde(rename = "ce", skip_serializing_if = "Option::is_none")]
    current_epoch: Option<String>,
    #[serde(rename = "r", skip_serializing_if = "Option::is_none")]
    reobserve: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
enum ComputerMcpOutput {
    Observation(CompactComputerObservation),
    Action(CompactComputerActionObservation),
}

fn mcp_success_output(
    verb: ComputerActionVerb,
    observation: ComputerObservation,
) -> ComputerMcpOutput {
    if verb == ComputerActionVerb::Observe {
        return ComputerMcpOutput::Observation(CompactComputerObservation {
            epoch: observation.epoch,
            settled_ms: observation.settled_ms,
            environment: observation.environment.map(compact_environment),
            elements: compact_elements(observation.elements),
            changed: observation.changed,
            screenshot_ref: observation.screenshot_ref,
        });
    }

    ComputerMcpOutput::Action(CompactComputerActionObservation {
        epoch: observation.epoch,
        elements: compact_elements(observation.elements),
        screenshot_ref: observation.screenshot_ref,
    })
}

fn mcp_error_output(error: ComputerError) -> CompactComputerErrorOutput {
    CompactComputerErrorOutput {
        error: CompactComputerError {
            code: error.code,
            message: error.message,
            permission_kind: error.permission_kind,
            app: error.app,
            window: error.window,
            current_epoch: error.current_epoch,
            reobserve: error.reobserve,
        },
    }
}

fn compact_environment(environment: ComputerEnvironment) -> CompactComputerEnvironment {
    CompactComputerEnvironment {
        app: environment.app,
        window: environment.window,
        focused_target_id: environment.focused_target_id,
        busy: environment.busy,
    }
}

fn compact_elements(elements: Vec<ComputerElement>) -> Vec<CompactComputerElement> {
    elements
        .into_iter()
        .map(|element| CompactComputerElement {
            id: element.id,
            role: element.role,
            label: element.label,
            value: element.value,
            bounds: element.bounds.map(compact_bounds),
            enabled: if element.enabled { None } else { Some(false) },
        })
        .collect()
}

fn compact_bounds(bounds: types::ComputerBounds) -> CompactComputerBounds {
    CompactComputerBounds {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
    }
}

fn tool_result(output: impl Serialize, is_error: bool) -> ToolResult {
    let text = serde_json::to_string(&output).unwrap_or_else(|error| {
        let fallback = mcp_error_output(ComputerError::invalid_input(error.to_string()));
        serde_json::to_string(&fallback).unwrap_or_else(|_| {
            "{\"err\":{\"c\":\"invalid_computer_input\",\"m\":\"serialization failed\"}}"
                .to_string()
        })
    });

    ToolResult {
        content: vec![SdkToolResultContent::Text { text }],
        is_error: if is_error { Some(true) } else { None },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tool_text(response: &Value) -> &str {
        response
            .get("result")
            .and_then(|result| result.get("content"))
            .and_then(Value::as_array)
            .and_then(|content| content.first())
            .and_then(|content| content.get("text"))
            .and_then(Value::as_str)
            .expect("text result")
    }

    fn parse_tool_text(response: &Value) -> Value {
        serde_json::from_str(tool_text(response)).expect("json text result")
    }

    #[tokio::test]
    async fn computer_mcp_lists_act_tool() {
        let server = mock_computer_mcp_server();

        let response = server
            .handle_message(json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/list"
            }))
            .await
            .expect("tools/list response");

        let tools = response
            .get("result")
            .and_then(|result| result.get("tools"))
            .and_then(Value::as_array)
            .expect("tool list");
        assert_eq!(tools.len(), 1);
        assert_eq!(
            tools[0].get("name").and_then(Value::as_str),
            Some(COMPUTER_MCP_ACT_TOOL_NAME)
        );
        assert!(
            tools[0]
                .get("description")
                .and_then(Value::as_str)
                .is_some_and(|description| description.contains("In: v verb")),
            "computer tool description should carry the compact key map"
        );
        assert_eq!(
            tools[0]
                .get("inputSchema")
                .and_then(|schema| schema.get("required"))
                .and_then(Value::as_array)
                .and_then(|required| required.first())
                .and_then(Value::as_str),
            Some("v")
        );
        let schema_bytes = serde_json::to_vec(
            tools[0]
                .get("inputSchema")
                .expect("computer tool input schema"),
        )
        .expect("serialize computer tool input schema");
        assert!(
            schema_bytes.len() <= 330,
            "computer tool schema should stay compact; got {} bytes",
            schema_bytes.len()
        );
    }

    #[tokio::test]
    async fn computer_mcp_observe_returns_compact_runtime_observation() {
        let server = mock_computer_mcp_server();

        let response = server
            .handle_message(json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {
                    "name": COMPUTER_MCP_ACT_TOOL_NAME,
                    "arguments": {
                        "v": "observe"
                    }
                }
            }))
            .await
            .expect("tools/call response");

        let parsed = parse_tool_text(&response);
        assert!(parsed.get("ok").is_none());
        assert_eq!(parsed.get("e").and_then(Value::as_str), Some("s_0"));
        assert_eq!(
            parsed
                .get("env")
                .and_then(|environment| environment.get("a"))
                .and_then(Value::as_str),
            Some("Acepe")
        );
        assert_eq!(
            parsed
                .get("env")
                .and_then(|environment| environment.get("b"))
                .and_then(Value::as_bool),
            Some(false)
        );
        assert!(parsed.get("sr").is_none());
        assert!(parsed
            .get("els")
            .and_then(Value::as_array)
            .and_then(|elements| elements.first())
            .and_then(|element| element.get("b"))
            .is_none());
        assert!(parsed
            .get("els")
            .and_then(Value::as_array)
            .and_then(|elements| elements.first())
            .and_then(|element| element.get("en"))
            .is_none());
        assert_eq!(
            response
                .get("result")
                .and_then(|result| result.get("isError")),
            None
        );
        assert!(
            tool_text(&response).len() <= 220,
            "observe MCP output should stay compact; got {} bytes",
            tool_text(&response).len()
        );
    }

    #[test]
    fn runtime_registry_reuses_runtime_per_session() {
        let registry = ComputerRuntimeRegistry::default();

        let first = registry.runtime_for_session("session-1");
        let second = registry.runtime_for_session("session-1");
        let other = registry.runtime_for_session("session-2");

        assert!(Arc::ptr_eq(&first, &second));
        assert!(!Arc::ptr_eq(&first, &other));
    }

    #[tokio::test]
    async fn runtime_registry_replaces_persisted_scopes_for_existing_runtimes() {
        let registry = ComputerRuntimeRegistry::default();
        let runtime = registry.runtime_for_session("session-1");
        let scope = ComputerAppWindowScope {
            app: Some("Safari".to_string()),
            window: Some("GitHub".to_string()),
        };

        registry
            .replace_persisted_app_window_scopes(vec![scope.clone()])
            .await;
        assert!(runtime.is_app_window_scope_allowed(&scope).await);

        registry
            .replace_persisted_app_window_scopes(Vec::new())
            .await;

        assert!(!runtime.is_app_window_scope_allowed(&scope).await);
    }

    #[test]
    fn compact_elements_omits_enabled_true_and_preserves_enabled_false() {
        let elements = compact_elements(vec![
            ComputerElement {
                id: "enabled".to_string(),
                role: "button".to_string(),
                label: "Enabled".to_string(),
                value: Some("ready".to_string()),
                bounds: Some(types::ComputerBounds {
                    x: 10,
                    y: 20,
                    width: 30,
                    height: 40,
                }),
                enabled: true,
            },
            ComputerElement {
                id: "disabled".to_string(),
                role: "button".to_string(),
                label: "Disabled".to_string(),
                value: None,
                bounds: None,
                enabled: false,
            },
        ]);

        let serialized = serde_json::to_value(elements).expect("serialize compact elements");
        let compact_elements = serialized.as_array().expect("compact elements");

        assert!(compact_elements[0].get("en").is_none());
        assert_eq!(
            compact_elements[0]
                .get("b")
                .and_then(|bounds| bounds.get("w"))
                .and_then(Value::as_i64),
            Some(30)
        );
        assert_eq!(
            compact_elements[0]
                .get("b")
                .and_then(|bounds| bounds.get("h"))
                .and_then(Value::as_i64),
            Some(40)
        );
        assert!(compact_elements[0]
            .get("b")
            .and_then(|bounds| bounds.get("width"))
            .is_none());
        assert!(compact_elements[0]
            .get("b")
            .and_then(|bounds| bounds.get("height"))
            .is_none());
        assert_eq!(
            compact_elements[1].get("en").and_then(Value::as_bool),
            Some(false)
        );
    }

    #[test]
    fn compact_computer_observation_deserializes_to_canonical_bounds() {
        let observation = serde_json::from_value::<ComputerObservation>(json!({
            "e": "s_1",
            "els": [{
                "i": "e_target",
                "r": "button",
                "l": "Run",
                "b": {
                    "x": 10,
                    "y": 20,
                    "w": 30,
                    "h": 40
                }
            }]
        }))
        .expect("compact observation should deserialize");

        assert_eq!(observation.epoch, "s_1");
        let bounds = observation.elements[0]
            .bounds
            .as_ref()
            .expect("canonical bounds");
        assert_eq!(bounds.width, 30);
        assert_eq!(bounds.height, 40);
        assert!(observation.elements[0].enabled);
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn production_macos_computer_mcp_is_not_mock_backed() {
        let server = build_computer_mcp_server();

        let response = server
            .handle_message(json!({
                "jsonrpc": "2.0",
                "id": 8,
                "method": "tools/call",
                "params": {
                    "name": COMPUTER_MCP_ACT_TOOL_NAME,
                    "arguments": {
                        "v": "observe"
                    }
                }
            }))
            .await
            .expect("tools/call response");

        let parsed = parse_tool_text(&response);
        if response
            .get("result")
            .and_then(|result| result.get("isError"))
            .and_then(Value::as_bool)
            == Some(true)
        {
            assert_eq!(
                parsed
                    .get("err")
                    .and_then(|error| error.get("c"))
                    .and_then(Value::as_str),
                Some("computer_permission_required")
            );
            assert_eq!(
                parsed
                    .get("err")
                    .and_then(|error| error.get("pk"))
                    .and_then(Value::as_str),
                Some("accessibility")
            );
        } else {
            assert!(parsed.get("ok").is_none());
            assert!(!parsed
                .get("els")
                .and_then(Value::as_array)
                .is_some_and(|elements| elements.iter().any(|element| {
                    element
                        .get("r")
                        .and_then(Value::as_str)
                        .is_some_and(|role| role == "button")
                        && element
                            .get("l")
                            .and_then(Value::as_str)
                            .is_some_and(|label| label == "Run")
                })));
        }
    }

    #[tokio::test]
    async fn computer_mcp_expanded_observe_includes_requested_fields_only() {
        let server = mock_computer_mcp_server();

        let response = server
            .handle_message(json!({
                "jsonrpc": "2.0",
                "id": 7,
                "method": "tools/call",
                "params": {
                    "name": COMPUTER_MCP_ACT_TOOL_NAME,
                    "arguments": {
                        "v": "observe",
                        "b": true,
                        "s": true
                    }
                }
            }))
            .await
            .expect("tools/call response");

        let parsed = parse_tool_text(&response);
        assert!(parsed.get("sr").and_then(Value::as_str).is_some());
        assert!(parsed
            .get("els")
            .and_then(Value::as_array)
            .and_then(|elements| elements.first())
            .and_then(|element| element.get("b"))
            .and_then(|bounds| bounds.get("w"))
            .and_then(Value::as_i64)
            .is_some());
        assert!(parsed
            .get("els")
            .and_then(Value::as_array)
            .and_then(|elements| elements.first())
            .and_then(|element| element.get("b"))
            .and_then(|bounds| bounds.get("width"))
            .is_none());
    }

    #[tokio::test]
    async fn computer_mcp_rejects_invalid_verb() {
        let server = mock_computer_mcp_server();

        let response = server
            .handle_message(json!({
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": {
                    "name": COMPUTER_MCP_ACT_TOOL_NAME,
                    "arguments": {
                        "v": "double_click"
                    }
                }
            }))
            .await
            .expect("tools/call response");

        assert_eq!(
            response
                .get("result")
                .and_then(|result| result.get("isError"))
                .and_then(Value::as_bool),
            Some(true)
        );

        let parsed = parse_tool_text(&response);
        assert_eq!(
            parsed
                .get("err")
                .and_then(|error| error.get("c"))
                .and_then(Value::as_str),
            Some("invalid_computer_input")
        );
    }

    #[tokio::test]
    async fn computer_mcp_rejects_invalid_action_arguments() {
        let server = mock_computer_mcp_server();

        let observed = server
            .handle_message(json!({
                "jsonrpc": "2.0",
                "id": 4,
                "method": "tools/call",
                "params": {
                    "name": COMPUTER_MCP_ACT_TOOL_NAME,
                    "arguments": {
                        "v": "observe"
                    }
                }
            }))
            .await
            .expect("observe response");
        let observed_payload = parse_tool_text(&observed);
        let target_id = observed_payload
            .get("els")
            .and_then(Value::as_array)
            .and_then(|elements| elements.get(1))
            .and_then(|element| element.get("i"))
            .and_then(Value::as_str)
            .expect("target id");
        let epoch = observed_payload
            .get("e")
            .and_then(Value::as_str)
            .expect("epoch");

        let typed = server
            .handle_message(json!({
                "jsonrpc": "2.0",
                "id": 5,
                "method": "tools/call",
                "params": {
                    "name": COMPUTER_MCP_ACT_TOOL_NAME,
                    "arguments": {
                        "v": "type",
                        "t": target_id,
                        "e": epoch,
                        "txt": "   "
                    }
                }
            }))
            .await
            .expect("type response");

        assert_eq!(
            typed
                .get("result")
                .and_then(|result| result.get("isError"))
                .and_then(Value::as_bool),
            Some(true)
        );

        let typed_payload = parse_tool_text(&typed);
        assert_eq!(
            typed_payload
                .get("err")
                .and_then(|error| error.get("c"))
                .and_then(Value::as_str),
            Some("invalid_computer_input")
        );
        assert_eq!(
            typed_payload
                .get("err")
                .and_then(|error| error.get("m"))
                .and_then(Value::as_str),
            Some("type action requires non-empty text.")
        );
    }

    #[tokio::test]
    async fn computer_mcp_rejects_stale_epoch() {
        let server = mock_computer_mcp_server();

        let observed = server
            .handle_message(json!({
                "jsonrpc": "2.0",
                "id": 4,
                "method": "tools/call",
                "params": {
                    "name": COMPUTER_MCP_ACT_TOOL_NAME,
                    "arguments": {
                        "v": "observe"
                    }
                }
            }))
            .await
            .expect("observe response");
        let observed_payload = parse_tool_text(&observed);
        let target_id = observed_payload
            .get("els")
            .and_then(Value::as_array)
            .and_then(|elements| elements.get(1))
            .and_then(|element| element.get("i"))
            .and_then(Value::as_str)
            .expect("target id");

        let clicked = server
            .handle_message(json!({
                "jsonrpc": "2.0",
                "id": 5,
                "method": "tools/call",
                "params": {
                    "name": COMPUTER_MCP_ACT_TOOL_NAME,
                    "arguments": {
                        "v": "click",
                        "t": target_id,
                        "e": "s_0"
                    }
                }
            }))
            .await
            .expect("click response");
        assert_eq!(
            parse_tool_text(&clicked).get("e").and_then(Value::as_str),
            Some("s_1")
        );
        assert!(parse_tool_text(&clicked).get("c").is_none());
        assert!(parse_tool_text(&clicked).get("env").is_none());
        assert!(parse_tool_text(&clicked).get("ms").is_none());
        assert_eq!(
            parse_tool_text(&clicked)
                .get("els")
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(1)
        );
        assert!(
            tool_text(&clicked).len() <= 150,
            "action MCP output should stay compact; got {} bytes",
            tool_text(&clicked).len()
        );

        let stale = server
            .handle_message(json!({
                "jsonrpc": "2.0",
                "id": 6,
                "method": "tools/call",
                "params": {
                    "name": COMPUTER_MCP_ACT_TOOL_NAME,
                    "arguments": {
                        "v": "click",
                        "t": target_id,
                        "e": "s_0"
                    }
                }
            }))
            .await
            .expect("stale response");
        let stale_payload = parse_tool_text(&stale);
        assert_eq!(
            stale_payload
                .get("err")
                .and_then(|error| error.get("c"))
                .and_then(Value::as_str),
            Some("stale_computer_epoch")
        );
        assert_eq!(
            stale_payload
                .get("err")
                .and_then(|error| error.get("ce"))
                .and_then(Value::as_str),
            Some("s_1")
        );
    }
}
