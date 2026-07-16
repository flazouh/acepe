//! Phase 4 compat-only snapshot envelope (`StoredEntry` rows + metadata).
//!
//! Production truth is `SessionStateGraph` via fold; this type remains for provider-owned
//! export boundaries, session list/index commands, and legacy open/reconnect hydration.
//! Delete only after all callers consume fold materialization directly.

use crate::acp::session_update::ToolCallUpdateData;
use crate::acp::transcript_projection::CanonicalTranscriptEvent;
use crate::session_jsonl::types::StoredEntry;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionThreadSnapshot {
    pub entries: Vec<StoredEntry>,
    pub title: String,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_mode_id: Option<String>,
}

impl SessionThreadSnapshot {
    #[must_use]
    pub fn empty(session_id: &str) -> Self {
        Self {
            entries: vec![],
            title: crate::acp::session::fold_export::default_session_title(session_id),
            created_at: chrono::Utc::now().to_rfc3339(),
            current_mode_id: None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ProviderOwnedSessionSnapshot {
    pub(crate) thread_snapshot: SessionThreadSnapshot,
    pub(crate) canonical_transcript_events: Vec<CanonicalTranscriptEvent>,
    pub(crate) canonical_tool_call_updates: Vec<ToolCallUpdateData>,
}

impl ProviderOwnedSessionSnapshot {
    #[must_use]
    pub(crate) fn from_thread_snapshot(thread_snapshot: SessionThreadSnapshot) -> Self {
        Self {
            thread_snapshot,
            canonical_transcript_events: Vec::new(),
            canonical_tool_call_updates: Vec::new(),
        }
    }

    #[must_use]
    pub(crate) fn with_canonical_transcript_events(
        thread_snapshot: SessionThreadSnapshot,
        canonical_transcript_events: Vec<CanonicalTranscriptEvent>,
    ) -> Self {
        Self {
            thread_snapshot,
            canonical_transcript_events,
            canonical_tool_call_updates: Vec::new(),
        }
    }

    pub(crate) fn set_canonical_tool_call_updates(
        &mut self,
        canonical_tool_call_updates: Vec<ToolCallUpdateData>,
    ) {
        self.canonical_tool_call_updates = canonical_tool_call_updates;
    }
}

#[cfg(test)]
mod tests {
    use super::SessionThreadSnapshot;

    #[test]
    fn empty_truncates_session_id_on_char_boundary() {
        let snapshot = SessionThreadSnapshot::empty("ééééééééé");

        assert_eq!(snapshot.title, "Session éééééééé");
    }
}
