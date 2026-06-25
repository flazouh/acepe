use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::Type;

use crate::acp::session_update::{
    QuestionItem, SkillMeta, TodoItem, ToolCallLocation, ToolCallStatus, ToolKind,
};
use crate::computer_use::permissions::ComputerPermissionKind;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum OperationState {
    Pending,
    Running,
    Blocked,
    Completed,
    Failed,
    Cancelled,
    Degraded,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum OperationDegradationCode {
    ImpossibleTransition,
    MissingEvidence,
    AbsentFromHistory,
    ClassificationFailure,
    InvalidProvenanceKey,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct OperationDegradationReason {
    pub code: OperationDegradationCode,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum OperationSourceLink {
    TranscriptLinked { entry_id: String },
    Synthetic { reason: String },
    Degraded { reason: OperationDegradationReason },
}

impl OperationSourceLink {
    pub(crate) fn transcript_linked(entry_id: String) -> Self {
        Self::TranscriptLinked { entry_id }
    }

    pub(crate) fn synthetic(reason: &str) -> Self {
        Self::Synthetic {
            reason: reason.to_string(),
        }
    }

    pub(crate) fn degraded(reason: OperationDegradationReason) -> Self {
        Self::Degraded { reason }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProvenanceValidationError {
    Empty,
    InvalidCharacters,
    ExceedsMaxLength { key_len: usize },
}

pub const PROVENANCE_KEY_MAX_LEN: usize = 512;
pub const MAX_SESSION_OPERATIONS: usize = 50_000;

pub fn validate_provenance_key(key: &str) -> Result<(), ProvenanceValidationError> {
    if key.is_empty() {
        return Err(ProvenanceValidationError::Empty);
    }
    if key.len() > PROVENANCE_KEY_MAX_LEN {
        return Err(ProvenanceValidationError::ExceedsMaxLength { key_len: key.len() });
    }
    if key.bytes().any(|b| b < 0x20 || b == 0x7f) {
        return Err(ProvenanceValidationError::InvalidCharacters);
    }
    Ok(())
}

pub fn build_canonical_operation_id(session_id: &str, provenance_key: &str) -> String {
    format!(
        "op:{}:{}:{}:{}",
        session_id.len(),
        session_id,
        provenance_key.len(),
        provenance_key
    )
}

pub fn build_validated_canonical_operation_id(
    session_id: &str,
    provenance_key: &str,
) -> Result<String, ProvenanceValidationError> {
    validate_provenance_key(provenance_key)?;
    Ok(build_canonical_operation_id(session_id, provenance_key))
}

/// Provider-layer provenance status carried by an Operation snapshot.
/// This is the raw status from the tool-call stream, captured as provenance evidence.
/// Do NOT use for canonical state decisions — use [`OperationState`] instead.
pub type OperationProviderStatus = ToolCallStatus;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ComputerOperationInputPayload {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub verb: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub target_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub epoch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub delta_x: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub delta_y: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub include_bounds: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub include_screenshot: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ComputerOperationOutputPayload {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub epoch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub settled_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub app: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub window: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub focused_target_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub busy: Option<bool>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub changed_target_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub element_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub screenshot_ref: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ComputerOperationErrorPayload {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub permission_kind: Option<ComputerPermissionKind>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub app: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub window: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub current_epoch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub reobserve: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct ComputerOperationPayload {
    pub input: ComputerOperationInputPayload,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub output: Option<ComputerOperationOutputPayload>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub error: Option<ComputerOperationErrorPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct OperationSnapshot {
    pub id: String,
    pub session_id: String,
    pub tool_call_id: String,
    pub name: String,
    pub kind: Option<ToolKind>,
    /// Provider-layer provenance status. Use `operation_state` for canonical state decisions.
    pub provider_status: OperationProviderStatus,
    pub title: Option<String>,
    pub arguments: crate::acp::session_update::ToolArguments,
    pub progressive_arguments: Option<crate::acp::session_update::ToolArguments>,
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub computer_payload: Option<ComputerOperationPayload>,
    pub command: Option<String>,
    pub normalized_todos: Option<Vec<TodoItem>>,
    pub parent_tool_call_id: Option<String>,
    pub parent_operation_id: Option<String>,
    pub child_tool_call_ids: Vec<String>,
    pub child_operation_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub operation_provenance_key: Option<String>,
    pub operation_state: OperationState,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub locations: Option<Vec<ToolCallLocation>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub skill_meta: Option<SkillMeta>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub normalized_questions: Option<Vec<QuestionItem>>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub question_answer: Option<crate::session_jsonl::types::QuestionAnswer>,
    pub awaiting_plan_approval: bool,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub plan_approval_request_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub started_at_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub completed_at_ms: Option<u64>,
    pub source_link: OperationSourceLink,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub degradation_reason: Option<OperationDegradationReason>,
}
