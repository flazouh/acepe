use crate::acp::projections::{InteractionSnapshot, OperationSnapshot};
use crate::acp::session_state_engine::graph::SessionStateGraph;
use crate::acp::session_state_engine::revision::SessionGraphRevision;
use crate::acp::session_state_engine::selectors::{
    SessionGraphCapabilities, SessionGraphLifecycle,
};
use crate::acp::session_update::UsageTelemetryData;
use crate::acp::transcript_projection::TranscriptDeltaOperation;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CapabilityPreviewState {
    Canonical,
    Pending,
    Failed,
    Partial,
    Stale,
}

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
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub transcript_operations: Vec<TranscriptDeltaOperation>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub operation_patches: Vec<OperationSnapshot>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub interaction_patches: Vec<InteractionSnapshot>,
    #[serde(default)]
    pub changed_fields: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SessionStatePayload {
    Snapshot {
        graph: Box<SessionStateGraph>,
    },
    Delta {
        delta: SessionStateDelta,
    },
    Lifecycle {
        lifecycle: SessionGraphLifecycle,
        revision: SessionGraphRevision,
    },
    Capabilities {
        capabilities: Box<SessionGraphCapabilities>,
        revision: SessionGraphRevision,
        #[serde(skip_serializing_if = "Option::is_none")]
        pending_mutation_id: Option<String>,
        preview_state: CapabilityPreviewState,
    },
    Telemetry {
        telemetry: UsageTelemetryData,
        revision: SessionGraphRevision,
    },
}
