use super::SyntheticToolCallContext;
use crate::acp::permission_tracker::WebSearchDedup;
use crate::acp::provider::AgentProvider;
use serde_json::Value;

#[derive(Debug, Clone)]
pub(crate) struct ForwardedPermissionRequest {
    value: Value,
}

impl ForwardedPermissionRequest {
    pub fn new(value: Value) -> Self {
        Self { value }
    }

    pub fn value(&self) -> &Value {
        &self.value
    }

    pub fn into_value(self) -> Value {
        self.value
    }

    pub fn session_id(&self) -> Option<String> {
        self.value
            .pointer("/params/sessionId")
            .and_then(|value| value.as_str())
            .map(str::to_string)
    }

    pub fn inject_parsed_arguments(&mut self, parsed_arguments: Option<&Value>) {
        let Some(parsed_arguments) = parsed_arguments else {
            return;
        };

        if let Some(tool_call) = self.tool_call_object_mut() {
            tool_call.insert("parsedArguments".to_string(), parsed_arguments.clone());
        }
    }

    pub fn normalize_session_id(&mut self, session_id: Option<&str>) -> bool {
        let Some(session_id) = session_id else {
            return false;
        };

        let Some(params) = self.params_object_mut() else {
            return false;
        };

        let changed = params
            .get("sessionId")
            .and_then(|value| value.as_str())
            .is_some_and(|current| current != session_id);

        params.insert(
            "sessionId".to_string(),
            Value::String(session_id.to_string()),
        );
        changed
    }

    pub fn remap_tool_call_id(&mut self, tool_call_id: &str) -> bool {
        let Some(tool_call) = self.tool_call_object_mut() else {
            return false;
        };

        tool_call.insert(
            "toolCallId".to_string(),
            Value::String(tool_call_id.to_string()),
        );
        true
    }

    fn params_object_mut(&mut self) -> Option<&mut serde_json::Map<String, Value>> {
        self.value
            .pointer_mut("/params")
            .and_then(|value| value.as_object_mut())
    }

    fn tool_call_object_mut(&mut self) -> Option<&mut serde_json::Map<String, Value>> {
        self.value
            .pointer_mut("/params/toolCall")
            .and_then(|value| value.as_object_mut())
    }
}

pub(crate) fn remap_forwarded_web_search_tool_call_id(
    forwarded: &mut ForwardedPermissionRequest,
    provider: Option<&dyn AgentProvider>,
    parsed_arguments: &Option<Value>,
    synthetic_tool_call: &mut Option<Box<SyntheticToolCallContext>>,
    web_search_dedup: &mut WebSearchDedup,
) -> Option<String> {
    let provider = provider?;
    let synthetic_ctx = synthetic_tool_call.as_mut()?;
    if !provider.is_web_search_tool_call_id(&synthetic_ctx.tool_call_data.id) {
        return None;
    }

    let query = provider.extract_synthetic_permission_query(parsed_arguments, forwarded.value())?;
    let session_id = forwarded.session_id()?;
    let canonical_id = web_search_dedup.take(&session_id, &query)?;

    synthetic_ctx.tool_call_data.id = canonical_id.clone();
    forwarded.remap_tool_call_id(&canonical_id);
    Some(canonical_id)
}
