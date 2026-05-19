use crate::acp::transcript_projection::snapshot::{
    TranscriptEntry, TranscriptEntryRole, TranscriptSegment, TranscriptSnapshot,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptDelta {
    pub event_seq: i64,
    pub session_id: String,
    pub snapshot_revision: i64,
    pub operations: Vec<TranscriptDeltaOperation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TranscriptDeltaOperation {
    AppendEntry {
        entry: TranscriptEntry,
    },
    #[serde(rename_all = "camelCase")]
    AppendSegment {
        entry_id: String,
        role: TranscriptEntryRole,
        segment: TranscriptSegment,
    },
    ReplaceSnapshot {
        snapshot: TranscriptSnapshot,
    },
}

#[cfg(test)]
mod tests {
    use super::{TranscriptDelta, TranscriptDeltaOperation};
    use crate::acp::transcript_projection::{TranscriptEntryRole, TranscriptSegment};

    #[test]
    fn transcript_delta_serializes_append_segment_wire_fields_as_camel_case() {
        let delta = TranscriptDelta {
            event_seq: 7,
            session_id: "session-1".to_string(),
            snapshot_revision: 7,
            operations: vec![TranscriptDeltaOperation::AppendSegment {
                entry_id: "assistant-1".to_string(),
                role: TranscriptEntryRole::Assistant,
                segment: TranscriptSegment::Text {
                    segment_id: "assistant-1:part-1".to_string(),
                    text: "hello".to_string(),
                },
            }],
        };

        let json = serde_json::to_value(delta).expect("serialize transcript delta");
        let operation = &json["operations"][0];
        let segment = &operation["segment"];

        assert_eq!(operation["entryId"], "assistant-1");
        assert!(operation.get("entry_id").is_none());
        assert_eq!(segment["segmentId"], "assistant-1:part-1");
        assert!(segment.get("segment_id").is_none());
    }
}
