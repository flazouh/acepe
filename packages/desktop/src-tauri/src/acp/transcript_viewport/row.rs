use crate::acp::projections::{
    InteractionKind, InteractionState, OperationSnapshot, OperationState,
};
use crate::acp::reconciler::canonical_name_for_kind;
use crate::acp::session_state_engine::graph::ActiveStreamingTailContentKind;
use crate::acp::session_update::{SessionCompactionEvent, ToolArguments, ToolKind};
use crate::acp::transcript_projection::{TranscriptEntryRole, TranscriptSegment};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptViewportRow {
    pub row_id: String,
    pub source_entry_id: String,
    pub kind: TranscriptViewportRowKind,
    pub version: String,
    pub anchor_eligible: bool,
    pub active_streaming_tail: Option<ActiveStreamingTailContentKind>,
    pub operation_links: Vec<TranscriptViewportOperationLink>,
    pub interaction_links: Vec<TranscriptViewportInteractionLink>,
    pub content: TranscriptViewportRowContent,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_started_at_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TranscriptViewportRowKind {
    User,
    AssistantText,
    AssistantThought,
    Tool,
    SessionActivity,
    AwaitingPlaceholder,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptViewportOperationLink {
    pub operation_id: String,
    pub tool_call_id: String,
    pub name: String,
    pub state: OperationState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_facts: Option<TranscriptViewportOperationDisplayFacts>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operation: Option<Box<OperationSnapshot>>,
}

impl PartialEq for TranscriptViewportOperationLink {
    fn eq(&self, other: &Self) -> bool {
        self.operation_id == other.operation_id
            && self.tool_call_id == other.tool_call_id
            && self.name == other.name
            && self.state == other.state
            && self.display_facts == other.display_facts
    }
}

impl Eq for TranscriptViewportOperationLink {}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptViewportOperationDisplayFacts {
    pub operation_id: String,
    pub tool_call_id: String,
    pub name: String,
    pub title: String,
    pub state: OperationState,
    pub kind: Option<ToolKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command_summary: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_path_summary: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result_summary: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_summary: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub interaction_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_tool_call_id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub child_tool_call_ids: Vec<String>,
}

impl TranscriptViewportOperationDisplayFacts {
    pub fn from_operation(
        operation: &OperationSnapshot,
        interaction_ids: Vec<String>,
    ) -> Option<Self> {
        let title = display_title(operation)?;
        let command_summary = command_summary(operation);
        let target_path_summary = target_path_summary(operation);
        let result_summary = result_summary(operation.result.as_ref());
        let error_summary = error_summary(operation, result_summary.as_deref());

        Some(Self {
            operation_id: operation.id.clone(),
            tool_call_id: operation.tool_call_id.clone(),
            name: operation.name.clone(),
            title,
            state: operation.operation_state.clone(),
            kind: operation.kind,
            command_summary,
            target_path_summary,
            result_summary,
            error_summary,
            interaction_ids,
            parent_tool_call_id: operation.parent_tool_call_id.clone(),
            child_tool_call_ids: operation.child_tool_call_ids.clone(),
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptViewportInteractionLink {
    pub interaction_id: String,
    pub kind: InteractionKind,
    pub state: InteractionState,
    pub operation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TranscriptViewportRowContent {
    Transcript {
        role: TranscriptEntryRole,
        segments: Vec<TranscriptSegment>,
    },
    Compaction {
        event: SessionCompactionEvent,
    },
}

fn display_title(operation: &OperationSnapshot) -> Option<String> {
    if let Some(title) = non_empty_summary(operation.title.as_deref()) {
        return Some(title);
    }

    if let Some(kind) = operation.kind {
        return Some(canonical_name_for_kind(kind).to_string());
    }

    non_empty_summary(Some(operation.name.as_str()))
}

fn command_summary(operation: &OperationSnapshot) -> Option<String> {
    if let Some(command) = non_empty_summary(operation.command.as_deref()) {
        return Some(command);
    }

    match &operation.arguments {
        ToolArguments::Execute { command } => non_empty_summary(command.as_deref()),
        ToolArguments::ShellInput { input, .. } => non_empty_summary(input.as_deref()),
        ToolArguments::Search { query, .. } => non_empty_summary(query.as_deref()),
        ToolArguments::Glob { pattern, .. } => non_empty_summary(pattern.as_deref()),
        ToolArguments::Fetch { url } => non_empty_summary(url.as_deref()),
        ToolArguments::WebSearch { query } => non_empty_summary(query.as_deref()),
        ToolArguments::Think {
            description,
            prompt,
            skill,
            ..
        } => non_empty_summary(description.as_deref())
            .or_else(|| non_empty_summary(prompt.as_deref()))
            .or_else(|| non_empty_summary(skill.as_deref())),
        ToolArguments::TaskOutput { task_id, .. } => non_empty_summary(task_id.as_deref()),
        ToolArguments::PlanMode {
            title,
            plan_file_path,
            ..
        } => non_empty_summary(title.as_deref())
            .or_else(|| non_empty_summary(plan_file_path.as_deref())),
        ToolArguments::ToolSearch { query, .. } => non_empty_summary(query.as_deref()),
        ToolArguments::Browser {
            action,
            selector,
            script,
            ..
        } => non_empty_summary(action.as_deref())
            .or_else(|| non_empty_summary(selector.as_deref()))
            .or_else(|| non_empty_summary(script.as_deref())),
        ToolArguments::Computer {
            verb, text, key, ..
        } => non_empty_summary(verb.as_deref())
            .or_else(|| non_empty_summary(text.as_deref()))
            .or_else(|| non_empty_summary(key.as_deref())),
        ToolArguments::Sql { query, .. } => non_empty_summary(query.as_deref()),
        _ => None,
    }
}

fn target_path_summary(operation: &OperationSnapshot) -> Option<String> {
    if let Some(locations) = &operation.locations {
        if let Some(location) = locations
            .iter()
            .find_map(|location| non_empty_summary(Some(location.path.as_str())))
        {
            return Some(location);
        }
    }

    match &operation.arguments {
        ToolArguments::Read { file_path, .. }
        | ToolArguments::Search { file_path, .. }
        | ToolArguments::Delete { file_path, .. } => non_empty_summary(file_path.as_deref()),
        ToolArguments::Edit { edits } => edits
            .iter()
            .find_map(|edit| non_empty_summary(edit.file_path.as_deref())),
        ToolArguments::Move { from, to } => {
            non_empty_summary(from.as_deref()).or_else(|| non_empty_summary(to.as_deref()))
        }
        ToolArguments::Glob { path, .. } => non_empty_summary(path.as_deref()),
        ToolArguments::PlanMode { plan_file_path, .. } => {
            non_empty_summary(plan_file_path.as_deref())
        }
        _ => None,
    }
}

fn result_summary(value: Option<&Value>) -> Option<String> {
    let value = value?;
    match value {
        Value::String(text) => non_empty_summary(Some(text.as_str())),
        Value::Object(map) => ["summary", "message", "output", "error"]
            .iter()
            .find_map(|key| map.get(*key).and_then(value_text_summary)),
        other => serde_json::to_string(other)
            .ok()
            .and_then(|text| non_empty_summary(Some(text.as_str()))),
    }
}

fn error_summary(operation: &OperationSnapshot, result_summary: Option<&str>) -> Option<String> {
    if operation.operation_state != OperationState::Failed {
        return None;
    }

    result_summary
        .and_then(|summary| non_empty_summary(Some(summary)))
        .or_else(|| {
            operation
                .degradation_reason
                .as_ref()
                .and_then(|reason| non_empty_summary(reason.detail.as_deref()))
        })
}

fn value_text_summary(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => non_empty_summary(Some(text.as_str())),
        other => serde_json::to_string(other)
            .ok()
            .and_then(|text| non_empty_summary(Some(text.as_str()))),
    }
}

fn non_empty_summary(value: Option<&str>) -> Option<String> {
    let value = value?.trim();
    if value.is_empty() {
        return None;
    }

    Some(truncate_summary(value))
}

fn truncate_summary(value: &str) -> String {
    const MAX_SUMMARY_BYTES: usize = 240;
    if value.len() <= MAX_SUMMARY_BYTES {
        return value.to_string();
    }

    let mut end = MAX_SUMMARY_BYTES;
    while !value.is_char_boundary(end) {
        end = end.saturating_sub(1);
    }
    format!("{} [truncated]", &value[..end])
}
