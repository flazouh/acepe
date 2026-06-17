use serde::{Deserialize, Serialize};
use specta::Type;

use crate::acp::types::CanonicalAgentId;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum SessionTurnState {
    Idle,
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct TurnFailureSnapshot {
    pub turn_id: Option<String>,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    pub kind: crate::acp::session_update::TurnErrorKind,
    pub source: crate::acp::session_update::TurnErrorSource,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SessionSnapshot {
    pub session_id: String,
    pub agent_id: Option<CanonicalAgentId>,
    pub last_event_seq: i64,
    pub turn_state: SessionTurnState,
    pub message_count: u64,
    pub active_tool_call_ids: Vec<String>,
    pub completed_tool_call_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_turn_failure: Option<TurnFailureSnapshot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_terminal_turn_id: Option<String>,
    #[serde(default)]
    pub assistant_boundary_entry_count: usize,
    #[serde(default)]
    pub transcript_entry_count: usize,
}

impl SessionSnapshot {
    #[must_use]
    pub fn new(session_id: String, agent_id: Option<CanonicalAgentId>) -> Self {
        Self {
            session_id,
            agent_id,
            last_event_seq: 0,
            turn_state: SessionTurnState::Idle,
            message_count: 0,
            active_tool_call_ids: Vec::new(),
            completed_tool_call_ids: Vec::new(),
            active_turn_failure: None,
            last_terminal_turn_id: None,
            assistant_boundary_entry_count: 0,
            transcript_entry_count: 0,
        }
    }
}
