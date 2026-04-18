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
        let short_id = session_id.chars().take(8).collect::<String>();
        Self {
            entries: vec![],
            title: format!("Session {short_id}"),
            created_at: chrono::Utc::now().to_rfc3339(),
            current_mode_id: None,
        }
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
