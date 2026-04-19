use crate::acp::projections::{
    InteractionSnapshot, OperationSnapshot, SessionTurnState, TurnFailureSnapshot,
};
use crate::acp::session_state_engine::revision::SessionGraphRevision;
use crate::acp::session_state_engine::selectors::{
    SessionGraphCapabilities, SessionGraphLifecycle,
};
use crate::acp::transcript_projection::TranscriptSnapshot;
use crate::acp::types::CanonicalAgentId;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionStateGraph {
    pub requested_session_id: String,
    pub canonical_session_id: String,
    pub is_alias: bool,
    pub agent_id: CanonicalAgentId,
    pub project_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_path: Option<String>,
    pub revision: SessionGraphRevision,
    pub transcript_snapshot: TranscriptSnapshot,
    pub operations: Vec<OperationSnapshot>,
    pub interactions: Vec<InteractionSnapshot>,
    pub turn_state: SessionTurnState,
    pub message_count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_turn_failure: Option<TurnFailureSnapshot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_terminal_turn_id: Option<String>,
    pub lifecycle: SessionGraphLifecycle,
    pub capabilities: SessionGraphCapabilities,
}
