use crate::session_jsonl::types::{ConvertedSession, SessionStats, StoredEntry};
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
        let short_id = &session_id[..8.min(session_id.len())];
        Self {
            entries: vec![],
            title: format!("Session {short_id}"),
            created_at: chrono::Utc::now().to_rfc3339(),
            current_mode_id: None,
        }
    }

    #[must_use]
    pub fn into_converted_session(self) -> ConvertedSession {
        ConvertedSession {
            entries: self.entries,
            stats: SessionStats::default(),
            title: self.title,
            created_at: self.created_at,
            current_mode_id: self.current_mode_id,
        }
    }
}

impl From<ConvertedSession> for SessionThreadSnapshot {
    fn from(value: ConvertedSession) -> Self {
        Self {
            entries: value.entries,
            title: value.title,
            created_at: value.created_at,
            current_mode_id: value.current_mode_id,
        }
    }
}
