use crate::acp::provider_extensions::ProviderExtensionEvent;
use crate::acp::session_update::{ContentChunk, SessionUpdate, ToolCallStatus, ToolCallUpdateData};
use crate::acp::types::ContentBlock;
use serde::Deserialize;
use serde_json::{json, Value};

use super::shared::mime_type_for_path;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateImageParams {
    tool_call_id: Option<String>,
    description: Option<String>,
    file_path: Option<String>,
    reference_image_paths: Option<Vec<String>>,
}

pub(crate) fn normalize(
    params: &Value,
    session_id: String,
) -> Result<ProviderExtensionEvent, String> {
    let parsed: GenerateImageParams =
        serde_json::from_value(params.clone()).map_err(|error| error.to_string())?;
    let tool_call_id = parsed
        .tool_call_id
        .ok_or_else(|| "cursor/generate_image missing toolCallId".to_string())?;
    let file_path = parsed
        .file_path
        .ok_or_else(|| "cursor/generate_image missing filePath".to_string())?;

    Ok(ProviderExtensionEvent {
        updates: vec![
            SessionUpdate::AgentMessageChunk {
                chunk: ContentChunk {
                    content: ContentBlock::Image {
                        data: String::new(),
                        mime_type: mime_type_for_path(&file_path).to_string(),
                        uri: Some(file_path.clone()),
                    },
                    aggregation_hint: None,
                },
                part_id: None,
                message_id: None,
                parent_tool_use_id: None,
                session_id: Some(session_id.clone()),
                produced_at_monotonic_ms: None,
            },
            SessionUpdate::ToolCallUpdate {
                update: ToolCallUpdateData {
                    tool_call_id,
                    status: Some(ToolCallStatus::Completed),
                    title: parsed.description,
                    result: Some(json!({
                        "filePath": file_path,
                        "referenceImagePaths": parsed.reference_image_paths.unwrap_or_default(),
                    })),
                    ..Default::default()
                },
                session_id: Some(session_id),
            },
        ],
        response_adapter: None,
    })
}
