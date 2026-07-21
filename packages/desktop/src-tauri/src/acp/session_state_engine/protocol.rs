use crate::acp::projections::{
    InteractionSnapshot, OperationSnapshot, SessionTurnState, TurnFailureSnapshot,
};
use crate::acp::session_state_engine::graph::{ActiveStreamingTail, SessionStateGraph};
use crate::acp::session_state_engine::revision::SessionGraphRevision;
use crate::acp::session_state_engine::selectors::{
    SessionGraphActivity, SessionGraphCapabilities, SessionGraphLifecycle,
};
use crate::acp::session_state_engine::session_state_field::SessionStateField;
use crate::acp::session_update::{PlanData, UsageTelemetryData};
use crate::acp::transcript_projection::TranscriptDeltaOperation;
use crate::acp::transcript_viewport::TranscriptViewportRow;
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
    pub activity: SessionGraphActivity,
    pub turn_state: SessionTurnState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_turn_failure: Option<TurnFailureSnapshot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_terminal_turn_id: Option<String>,
    pub active_streaming_tail: Option<ActiveStreamingTail>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub transcript_operations: Vec<TranscriptDeltaOperation>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub operation_patches: Vec<OperationSnapshot>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub interaction_patches: Vec<InteractionSnapshot>,
    #[serde(default)]
    pub changed_fields: Vec<SessionStateField>,
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
    Plan {
        plan: PlanData,
        revision: SessionGraphRevision,
    },
    ViewportBufferPush {
        push: ViewportBufferPush,
    },
    ViewportBufferDelta {
        delta: ViewportBufferDelta,
    },
}

/// Diagnostic emitted alongside a buffer push/delta (e.g. a rejected height
/// confirmation or a shrunk buffer).
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ViewportBufferDiagnostic {
    pub code: String,
    pub row_id: Option<String>,
}

/// Full ordered row push for the DOM-authority transcript viewport. Rust owns
/// canonical order, identity, version, and row content. The WebView owns pixels
/// and scrollTop, so no height, offset, mode, or scroll target crosses this wire.
/// `request_generation` echoes the UI's rows request so late responses can be
/// ignored when needed; live pushes carry `None`.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ViewportBufferPush {
    pub session_id: String,
    pub graph_revision: SessionGraphRevision,
    /// Per-session monotonic emission sequence. A push resets the consumer's
    /// sequence baseline to this value; subsequent deltas must chain
    /// contiguously from it.
    pub emission_seq: u64,
    pub rows: Vec<TranscriptViewportRow>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_generation: Option<u64>,
    pub diagnostics: Vec<ViewportBufferDiagnostic>,
}

/// Incremental ordered-row mutation. Applies iff `emission_seq` chains
/// contiguously from the consumer's last applied sequence (`emission_seq ==
/// current + 1`). If a survivor row changes version, Rust sends a fresh push
/// instead of a delta, so the consumer never needs to patch row content in place.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ViewportBufferDelta {
    pub session_id: String,
    pub graph_revision: SessionGraphRevision,
    pub emission_seq: u64,
    pub prepended_rows: Vec<TranscriptViewportRow>,
    pub appended_rows: Vec<TranscriptViewportRow>,
    pub removed_row_ids: Vec<String>,
    pub diagnostics: Vec<ViewportBufferDiagnostic>,
}

#[cfg(test)]
mod tests {
    use super::{SessionStatePayload, ViewportBufferDiagnostic, ViewportBufferPush};
    use crate::acp::session_state_engine::revision::SessionGraphRevision;
    use crate::acp::transcript_viewport::TranscriptViewportRow;

    #[test]
    fn viewport_buffer_push_round_trip_uses_camel_case_wire_fields() {
        let payload = SessionStatePayload::ViewportBufferPush {
            push: ViewportBufferPush {
                session_id: "session-1".to_string(),
                graph_revision: SessionGraphRevision::new(3, 2, 9),
                emission_seq: 7,
                rows: Vec::<TranscriptViewportRow>::new(),
                request_generation: None,
                diagnostics: vec![ViewportBufferDiagnostic {
                    code: "empty_window".to_string(),
                    row_id: None,
                }],
            },
        };

        let json = serde_json::to_string(&payload).expect("serialize");
        assert!(json.contains("\"kind\":\"viewportBufferPush\""));
        assert!(json.contains("\"sessionId\":\"session-1\""));
        assert!(json.contains("\"graphRevision\""));
        assert!(json.contains("\"emissionSeq\":7"));
        assert!(!json.contains("viewportRevision"));
        assert!(!json.contains("bufferStartIndex"));
        assert!(!json.contains("bufferEndIndex"));
        assert!(!json.contains("layoutRowCount"));
        assert!(!json.contains("totalHeightPx"));
        assert!(!json.contains("bufferEndOffsetPx"));
        assert!(!json.contains("scrollTopTarget"));
        assert!(!json.contains("offsetsPx"));

        let restored: SessionStatePayload = serde_json::from_str(&json).expect("deserialize");
        match restored {
            SessionStatePayload::ViewportBufferPush { push } => {
                assert_eq!(push.session_id, "session-1");
                assert_eq!(push.graph_revision, SessionGraphRevision::new(3, 2, 9));
                assert_eq!(push.emission_seq, 7);
                assert_eq!(push.rows.len(), 0);
            }
            other => panic!("unexpected variant: {other:?}"),
        }
    }
}
