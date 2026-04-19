use crate::acp::session_state_engine::graph::SessionStateGraph;
use crate::acp::session_state_engine::revision::SessionGraphRevision;
use crate::acp::session_state_engine::selectors::{
    SessionGraphCapabilities, SessionGraphLifecycle,
};
use crate::acp::transcript_projection::TranscriptDelta;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionStateSnapshotMaterialization {
    pub graph: SessionStateGraph,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionStateDelta {
    pub from_revision: SessionGraphRevision,
    pub to_revision: SessionGraphRevision,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transcript_delta: Option<TranscriptDelta>,
    #[serde(default)]
    pub changed_fields: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SessionStatePayload {
    Snapshot {
        graph: SessionStateGraph,
    },
    Delta {
        delta: SessionStateDelta,
    },
    Lifecycle {
        lifecycle: SessionGraphLifecycle,
        revision: SessionGraphRevision,
    },
    Capabilities {
        capabilities: SessionGraphCapabilities,
        revision: SessionGraphRevision,
    },
}
