use crate::acp::projections::{
    InteractionSnapshot, OperationSnapshot, SessionTurnState, TurnFailureSnapshot,
};
use crate::acp::session_state_engine::graph::{ActiveStreamingTail, SessionStateGraph};
use crate::acp::session_state_engine::revision::SessionGraphRevision;
use crate::acp::session_state_engine::selectors::{
    SessionGraphActivity, SessionGraphCapabilities, SessionGraphLifecycle,
};
use crate::acp::session_update::{PlanData, UsageTelemetryData};
use crate::acp::transcript_projection::TranscriptDeltaOperation;
use crate::acp::transcript_viewport::{TranscriptViewportRow, ViewportMode};
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
    Plan {
        plan: PlanData,
        revision: SessionGraphRevision,
    },
    AssistantTextDelta {
        delta: AssistantTextDeltaPayload,
    },
    VisibleTranscriptWindow {
        window: VisibleTranscriptWindowPayload,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AssistantTextDeltaPayload {
    pub turn_id: String,
    pub row_id: String,
    pub char_offset: u32,
    pub delta_text: String,
    pub produced_at_monotonic_ms: u64,
    pub revision: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VisibleTranscriptWindowPayload {
    pub session_id: String,
    pub graph_revision: SessionGraphRevision,
    pub viewport_revision: i64,
    pub total_height_px: u64,
    pub viewport_offset_px: u64,
    pub visible_start_index: usize,
    pub visible_end_index: usize,
    pub rows: Vec<TranscriptViewportRow>,
    pub row_offsets_px: Vec<u64>,
    pub mode: ViewportMode,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub diagnostics: Vec<VisibleTranscriptWindowDiagnostic>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VisibleTranscriptWindowDiagnostic {
    pub code: String,
    pub row_id: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::{
        AssistantTextDeltaPayload, SessionStatePayload, VisibleTranscriptWindowDiagnostic,
        VisibleTranscriptWindowPayload,
    };
    use crate::acp::session_state_engine::revision::SessionGraphRevision;
    use crate::acp::transcript_viewport::{TranscriptViewportRow, ViewportMode};

    #[test]
    fn assistant_text_delta_round_trip_preserves_all_fields() {
        let payload = SessionStatePayload::AssistantTextDelta {
            delta: AssistantTextDeltaPayload {
                turn_id: "turn-7".to_string(),
                row_id: "row-3".to_string(),
                char_offset: 42,
                delta_text: "Hello".to_string(),
                produced_at_monotonic_ms: 12_345,
                revision: 9,
            },
        };

        let json = serde_json::to_string(&payload).expect("serialize");
        assert!(json.contains("\"kind\":\"assistantTextDelta\""));
        assert!(json.contains("\"turnId\":\"turn-7\""));
        assert!(json.contains("\"rowId\":\"row-3\""));
        assert!(json.contains("\"charOffset\":42"));
        assert!(json.contains("\"deltaText\":\"Hello\""));
        assert!(json.contains("\"producedAtMonotonicMs\":12345"));
        assert!(json.contains("\"revision\":9"));

        let restored: SessionStatePayload = serde_json::from_str(&json).expect("deserialize");
        match restored {
            SessionStatePayload::AssistantTextDelta { delta } => {
                assert_eq!(delta.turn_id, "turn-7");
                assert_eq!(delta.row_id, "row-3");
                assert_eq!(delta.char_offset, 42);
                assert_eq!(delta.delta_text, "Hello");
                assert_eq!(delta.produced_at_monotonic_ms, 12_345);
                assert_eq!(delta.revision, 9);
            }
            other => panic!("unexpected variant: {other:?}"),
        }
    }

    #[test]
    fn assistant_text_delta_allows_empty_delta_text() {
        let payload = SessionStatePayload::AssistantTextDelta {
            delta: AssistantTextDeltaPayload {
                turn_id: "t".to_string(),
                row_id: "r".to_string(),
                char_offset: 0,
                delta_text: String::new(),
                produced_at_monotonic_ms: 0,
                revision: 0,
            },
        };
        let json = serde_json::to_string(&payload).expect("serialize");
        let restored: SessionStatePayload = serde_json::from_str(&json).expect("deserialize");
        match restored {
            SessionStatePayload::AssistantTextDelta { delta } => {
                assert!(delta.delta_text.is_empty());
                assert_eq!(delta.char_offset, 0);
            }
            other => panic!("unexpected variant: {other:?}"),
        }
    }

    #[test]
    fn assistant_text_delta_missing_produced_at_fails_deserialize() {
        let bad = r#"{
            "kind":"assistantTextDelta",
            "delta":{"turnId":"t","rowId":"r","charOffset":0,"deltaText":"hi","revision":1}
        }"#;
        let result: Result<SessionStatePayload, _> = serde_json::from_str(bad);
        assert!(
            result.is_err(),
            "expected deserialize error, got {result:?}"
        );
    }

    #[test]
    fn visible_transcript_window_round_trip_uses_camel_case_wire_fields() {
        let payload = SessionStatePayload::VisibleTranscriptWindow {
            window: VisibleTranscriptWindowPayload {
                session_id: "session-1".to_string(),
                graph_revision: SessionGraphRevision::new(3, 2, 9),
                viewport_revision: 4,
                total_height_px: 240,
                viewport_offset_px: 120,
                visible_start_index: 1,
                visible_end_index: 2,
                rows: Vec::<TranscriptViewportRow>::new(),
                row_offsets_px: Vec::new(),
                mode: ViewportMode::FollowingTail,
                diagnostics: vec![VisibleTranscriptWindowDiagnostic {
                    code: "empty_window".to_string(),
                    row_id: None,
                }],
            },
        };

        let json = serde_json::to_string(&payload).expect("serialize");
        assert!(json.contains("\"kind\":\"visibleTranscriptWindow\""));
        assert!(json.contains("\"sessionId\":\"session-1\""));
        assert!(json.contains("\"graphRevision\""));
        assert!(json.contains("\"viewportRevision\":4"));
        assert!(json.contains("\"totalHeightPx\":240"));
        assert!(json.contains("\"viewportOffsetPx\":120"));
        assert!(json.contains("\"visibleStartIndex\":1"));
        assert!(json.contains("\"visibleEndIndex\":2"));
        assert!(json.contains("\"rowOffsetsPx\":[]"));

        let restored: SessionStatePayload = serde_json::from_str(&json).expect("deserialize");
        match restored {
            SessionStatePayload::VisibleTranscriptWindow { window } => {
                assert_eq!(window.session_id, "session-1");
                assert_eq!(window.graph_revision, SessionGraphRevision::new(3, 2, 9));
                assert_eq!(window.viewport_revision, 4);
                assert_eq!(window.total_height_px, 240);
                assert_eq!(window.rows.len(), 0);
            }
            other => panic!("unexpected variant: {other:?}"),
        }
    }
}
