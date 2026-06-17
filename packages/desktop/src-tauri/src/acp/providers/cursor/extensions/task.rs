use crate::acp::provider_extensions::ProviderExtensionEvent;
use crate::acp::session_update::{
    SessionUpdate, ToolArguments, ToolCallStatus, ToolCallUpdateData,
};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskParams {
    tool_call_id: Option<String>,
    description: Option<String>,
    prompt: Option<String>,
    subagent_type: Option<String>,
    model: Option<String>,
    agent_id: Option<String>,
    duration_ms: Option<i64>,
}

pub(crate) fn normalize(
    params: &Value,
    session_id: String,
) -> Result<ProviderExtensionEvent, String> {
    let parsed: TaskParams =
        serde_json::from_value(params.clone()).map_err(|error| error.to_string())?;
    let tool_call_id = parsed
        .tool_call_id
        .ok_or_else(|| "cursor/task missing toolCallId".to_string())?;

    let summary = [parsed.subagent_type.clone(), parsed.model, parsed.agent_id]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" · ");

    let arguments = ToolArguments::Think {
        description: parsed.description.clone(),
        prompt: parsed.prompt.clone(),
        subagent_type: parsed.subagent_type.clone(),
        skill: None,
        skill_args: None,
        raw: None,
    };

    Ok(ProviderExtensionEvent {
        updates: vec![SessionUpdate::ToolCallUpdate {
            update: ToolCallUpdateData {
                tool_call_id,
                status: Some(ToolCallStatus::Completed),
                title: parsed.description.clone(),
                arguments: Some(arguments),
                result: Some(json!({
                    "description": parsed.description,
                    "prompt": parsed.prompt,
                    "summary": if summary.is_empty() { Value::Null } else { Value::String(summary) },
                    "durationMs": parsed.duration_ms,
                })),
                ..Default::default()
            },
            session_id: Some(session_id),
        }],
        response_adapter: None,
    })
}
