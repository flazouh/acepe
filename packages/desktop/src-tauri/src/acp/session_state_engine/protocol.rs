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
    ViewportBufferPush {
        push: ViewportBufferPush,
    },
    ViewportBufferDelta {
        delta: ViewportBufferDelta,
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

/// Diagnostic emitted alongside a buffer push/delta (e.g. a rejected height
/// confirmation or a shrunk buffer).
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ViewportBufferDiagnostic {
    pub code: String,
    pub row_id: Option<String>,
}

/// Full buffered slice of the canonical layout pushed to the WebView. The
/// WebView resolves in-buffer scroll offsets locally (no IPC per frame) and
/// only requests a refill when scrolling near/outside `[buffer_start_index,
/// buffer_end_index)`. `request_generation` echoes the generation of a refill
/// request so the store can reject stale command responses; live (unsolicited)
/// pushes carry `None`.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ViewportBufferPush {
    pub session_id: String,
    pub graph_revision: SessionGraphRevision,
    pub viewport_revision: i64,
    /// Per-session monotonic emission sequence (the total-order authority for
    /// the buffer protocol). A push resets the consumer's sequence baseline to
    /// this value; subsequent deltas must chain contiguously from it. Because
    /// `viewport_revision` does NOT advance on streaming row appends, it cannot
    /// sequence the two independent delivery channels (command-reply vs live
    /// event stream); `emission_seq` can, turning any out-of-order arrival into
    /// a detectable gap (→ fresh push) instead of silent buffer corruption.
    pub emission_seq: u64,
    pub buffer_start_index: usize,
    pub buffer_end_index: usize,
    /// Total number of rows in the full canonical layout. Lets the WebView tell
    /// whether a buffer edge is also the layout extreme (so it must NOT request
    /// a refill past it).
    pub layout_row_count: usize,
    pub total_height_px: u64,
    /// Absolute pixel offset of the bottom of the last buffered row
    /// (= `offset_at_index(buffer_end_index)`). Equals `total_height_px` only
    /// when the buffer reaches the layout end. Lets the WebView compute the
    /// buffered pixel span `[offsets_px[0], buffer_end_offset_px)` without
    /// per-row heights.
    pub buffer_end_offset_px: u64,
    pub rows: Vec<TranscriptViewportRow>,
    pub offsets_px: Vec<u64>,
    pub mode: ViewportMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_generation: Option<u64>,
    /// Absolute scrollTop the WebView should adopt when this push repositions the
    /// viewport (initial open, reveal, follow-tail). `None` for a pure refill,
    /// where the user's current scrollTop is authoritative and must be preserved.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scroll_top_target: Option<u64>,
    pub diagnostics: Vec<ViewportBufferDiagnostic>,
}

/// Incremental buffer mutation. Applies iff `emission_seq` chains contiguously
/// from the consumer's last applied sequence (`emission_seq == current + 1`);
/// an older `emission_seq` is a stale duplicate (dropped), a newer-than-next
/// one is a gap that forces a fresh `ViewportBufferPush`. `emission_seq` — not
/// `from_viewport_revision` — is the apply-ordering authority, because pure
/// streaming appends do not advance `viewport_revision`. The revision fields
/// remain for diagnostics and snapshot newer-wins on pushes. Exactly one of
/// `scroll_top_target` (absolute) or `scroll_anchor_correction_px` (relative)
/// should be set to avoid double-applying a scroll correction.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ViewportBufferDelta {
    pub session_id: String,
    pub graph_revision: SessionGraphRevision,
    /// Per-session monotonic emission sequence; see [`ViewportBufferPush::emission_seq`].
    pub emission_seq: u64,
    pub from_viewport_revision: i64,
    pub to_viewport_revision: i64,
    pub prepended_rows: Vec<TranscriptViewportRow>,
    pub prepended_offsets_px: Vec<u64>,
    pub appended_rows: Vec<TranscriptViewportRow>,
    pub appended_offsets_px: Vec<u64>,
    pub removed_row_ids: Vec<String>,
    /// Total rows in the canonical layout after this delta. Lets the consumer
    /// re-evaluate `needsRefill`'s "has content below" edge as streaming grows
    /// the transcript, without a fresh push.
    pub layout_row_count: usize,
    pub total_height_px: u64,
    /// Absolute pixel bottom of the last buffered row after this delta (top of
    /// the row past `buffer_end_index`). Equals `total_height_px` only when the
    /// buffer reaches the layout end. Required so the consumer can maintain the
    /// bottom-edge refill math without per-row heights.
    pub buffer_end_offset_px: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scroll_anchor_correction_px: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scroll_top_target: Option<u64>,
    pub diagnostics: Vec<ViewportBufferDiagnostic>,
}

#[cfg(test)]
mod tests {
    use super::{
        AssistantTextDeltaPayload, SessionStatePayload, ViewportBufferDiagnostic, ViewportBufferPush,
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
    fn viewport_buffer_push_round_trip_uses_camel_case_wire_fields() {
        let payload = SessionStatePayload::ViewportBufferPush {
            push: ViewportBufferPush {
                session_id: "session-1".to_string(),
                graph_revision: SessionGraphRevision::new(3, 2, 9),
                viewport_revision: 4,
                emission_seq: 7,
                buffer_start_index: 1,
                buffer_end_index: 2,
                layout_row_count: 12,
                total_height_px: 240,
                buffer_end_offset_px: 220,
                rows: Vec::<TranscriptViewportRow>::new(),
                offsets_px: Vec::new(),
                mode: ViewportMode::FollowingTail,
                request_generation: None,
                scroll_top_target: Some(120),
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
        assert!(json.contains("\"viewportRevision\":4"));
        assert!(json.contains("\"emissionSeq\":7"));
        assert!(json.contains("\"bufferStartIndex\":1"));
        assert!(json.contains("\"bufferEndIndex\":2"));
        assert!(json.contains("\"layoutRowCount\":12"));
        assert!(json.contains("\"totalHeightPx\":240"));
        assert!(json.contains("\"bufferEndOffsetPx\":220"));
        assert!(json.contains("\"scrollTopTarget\":120"));
        assert!(json.contains("\"offsetsPx\":[]"));

        let restored: SessionStatePayload = serde_json::from_str(&json).expect("deserialize");
        match restored {
            SessionStatePayload::ViewportBufferPush { push } => {
                assert_eq!(push.session_id, "session-1");
                assert_eq!(push.graph_revision, SessionGraphRevision::new(3, 2, 9));
                assert_eq!(push.viewport_revision, 4);
                assert_eq!(push.emission_seq, 7);
                assert_eq!(push.total_height_px, 240);
                assert_eq!(push.rows.len(), 0);
            }
            other => panic!("unexpected variant: {other:?}"),
        }
    }
}
