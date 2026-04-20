use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SessionGraphRevision {
    pub graph_revision: i64,
    pub transcript_revision: i64,
    pub last_event_seq: i64,
}

impl SessionGraphRevision {
    pub const fn new(graph_revision: i64, transcript_revision: i64, last_event_seq: i64) -> Self {
        Self {
            graph_revision,
            transcript_revision,
            last_event_seq,
        }
    }
}
