use crate::acp::projections::{InteractionKind, InteractionState, OperationState};
use crate::acp::session_state_engine::graph::ActiveStreamingTailContentKind;
use crate::acp::transcript_projection::{TranscriptEntryRole, TranscriptSegment};
use serde::{Deserialize, Serialize};

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
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TranscriptViewportRowKind {
    User,
    AssistantText,
    AssistantThought,
    Tool,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptViewportOperationLink {
    pub operation_id: String,
    pub tool_call_id: String,
    pub name: String,
    pub state: OperationState,
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
}
