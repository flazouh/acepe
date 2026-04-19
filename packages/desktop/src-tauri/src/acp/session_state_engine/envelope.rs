use crate::acp::session_state_engine::protocol::SessionStatePayload;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionStateEnvelope {
    pub session_id: String,
    pub graph_revision: i64,
    pub last_event_seq: i64,
    pub payload: SessionStatePayload,
}
