//! Cursor history ingress — store.db bytes → ordered `ProviderEvent` stream.

pub mod cursor_history;
pub mod cursor_sqlite_parser;
mod discovery;
mod sqlite;

use async_trait::async_trait;
use std::path::PathBuf;

use crate::acp::parsers::AgentType;
use crate::acp::session::ingress::canonical_events::full_session_to_provider_events;
#[cfg(test)]
use crate::acp::session::ingress::canonical_events::materialize_canonical_transcript_events;
use crate::acp::session::ingress::event::ProviderEvent;
use crate::acp::session::ingress::source::{HistoryError, HistoryInput, HistorySource};
use crate::acp::types::CanonicalAgentId;

use discovery::get_sqlite_store_db_path_for_session;
use sqlite::parse_cursor_store_db;

/// Reads Cursor `store.db` history into provider-agnostic ingress events.
pub struct CursorHistorySource;

#[async_trait]
impl HistorySource for CursorHistorySource {
    async fn read(&self, input: HistoryInput) -> Result<Vec<ProviderEvent>, HistoryError> {
        let (db_path, workspace_path) = resolve_store_db_path(&input).await?;
        let session = parse_cursor_store_db(&db_path, &input.session_id, workspace_path.as_deref())
            .await
            .map_err(|error| HistoryError::InvalidFormat(error.to_string()))?;

        Ok(full_session_to_provider_events(
            &session,
            CanonicalAgentId::Cursor,
            AgentType::Cursor,
        ))
    }
}

/// Resolve `store.db` from history input.
///
/// Test fixtures: `workspace_root` may be a directory containing
/// `{session_id_prefix}-junk-session.db` (see golden fixture layout).
async fn resolve_store_db_path(
    input: &HistoryInput,
) -> Result<(PathBuf, Option<String>), HistoryError> {
    if let Some(root) = &input.workspace_root {
        if root.extension().is_some_and(|ext| ext == "db") && root.exists() {
            return Ok((root.clone(), None));
        }

        let prefix = input
            .session_id
            .split('-')
            .next()
            .unwrap_or(input.session_id.as_str());
        let fixture_db = root.join(format!("{prefix}-junk-session.db"));
        if fixture_db.exists() {
            return Ok((fixture_db, None));
        }

        let nested_db = root.join(&input.session_id).join("store.db");
        if nested_db.exists() {
            return Ok((nested_db, Some(root.display().to_string())));
        }
    }

    let db_path = get_sqlite_store_db_path_for_session(&input.session_id)
        .await
        .map_err(|error| HistoryError::Io(error.to_string()))?
        .ok_or_else(|| {
            HistoryError::NotFound(format!(
                "Cursor store.db not found for session {}",
                input.session_id
            ))
        })?;

    let workspace_path = input
        .workspace_root
        .as_ref()
        .map(|path| path.display().to_string());

    Ok((db_path, workspace_path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::session::ingress::event::ProviderEventKind;
    use crate::acp::transcript_projection::CanonicalTranscriptEventKind;
    use std::path::PathBuf;

    #[tokio::test]
    async fn cursor_history_source_reads_inside_active_tokio_runtime() {
        const SESSION_ID: &str = "c2a34686-f99a-4632-90e2-e036b96124c2";
        let fixture_dir =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/cursor_sessions");
        assert!(
            fixture_dir.join("c2a34686-junk-session.db").exists(),
            "fixture not found under {}",
            fixture_dir.display()
        );

        let source = CursorHistorySource;
        let events = source
            .read(HistoryInput {
                session_id: SESSION_ID.to_string(),
                workspace_root: Some(fixture_dir),
            })
            .await
            .expect("read cursor junk fixture");

        let has_hi = events.iter().any(|event| {
            matches!(
                &event.kind,
                ProviderEventKind::UserText { text, .. } if text == "hi"
            )
        });
        assert!(has_hi, "expected UserText hi event, got {events:?}");
    }

    #[tokio::test]
    async fn cursor_history_source_first_user_event_provider_seq_matches_transcript_seq() {
        const SESSION_ID: &str = "c2a34686-f99a-4632-90e2-e036b96124c2";
        let fixture_dir =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/cursor_sessions");
        let db_path = fixture_dir.join("c2a34686-junk-session.db");

        let session = parse_cursor_store_db(&db_path, SESSION_ID, None)
            .await
            .expect("parse junk fixture");

        let canonical_events = materialize_canonical_transcript_events(&session, AgentType::Cursor);
        let first_user_canonical = canonical_events
            .iter()
            .find(|event| {
                matches!(
                    &event.kind,
                    CanonicalTranscriptEventKind::UserText { .. }
                        | CanonicalTranscriptEventKind::UserPastedContent { .. }
                )
            })
            .expect("expected canonical user event");

        let source = CursorHistorySource;
        let provider_events = source
            .read(HistoryInput {
                session_id: SESSION_ID.to_string(),
                workspace_root: Some(fixture_dir),
            })
            .await
            .expect("read cursor junk fixture");

        let first_user_provider = provider_events
            .iter()
            .find(|event| {
                matches!(
                    &event.kind,
                    ProviderEventKind::UserText { .. }
                        | ProviderEventKind::UserPastedContent { .. }
                )
            })
            .expect("expected provider user event");

        assert_eq!(
            first_user_provider.provider_seq, first_user_canonical.transcript_seq,
            "provider_seq must match materialize_canonical_transcript_events transcript_seq"
        );
    }
}
