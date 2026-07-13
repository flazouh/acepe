//! Cursor history ingress — provider-owned transcript/store formats → ordered `ProviderEvent` stream.

pub mod cursor_history;
pub mod cursor_sqlite_parser;
mod discovery;
mod sqlite;

use async_trait::async_trait;
use std::path::PathBuf;

use crate::acp::parsers::AgentType;
use crate::acp::session::ingress::canonical_events::full_session_to_provider_events;
use crate::acp::session::ingress::event::ProviderEvent;
use crate::acp::session::ingress::source::{HistoryError, HistoryInput, HistorySource};
use crate::acp::types::CanonicalAgentId;

use discovery::get_sqlite_store_db_path_for_session;
use sqlite::parse_cursor_store_db;

/// Reads Cursor history into provider-agnostic ingress events.
pub struct CursorHistorySource;

#[async_trait]
impl HistorySource for CursorHistorySource {
    async fn read(&self, input: HistoryInput) -> Result<Vec<ProviderEvent>, HistoryError> {
        if let Some(source_path) = explicit_transcript_path(&input) {
            let project_path = cursor_history::parser::extract_workspace_from_transcript_path(
                source_path.as_path(),
            );
            if source_path
                .extension()
                .and_then(|extension| extension.to_str())
                == Some("jsonl")
            {
                return cursor_history::parser::parse_jsonl_provider_events(
                    source_path,
                    &input.session_id,
                    &project_path,
                )
                .await
                .map_err(|error| HistoryError::InvalidFormat(error.to_string()));
            }
            let session = cursor_history::parser::parse_transcript_file(
                source_path,
                &input.session_id,
                &project_path,
            )
            .await
            .map_err(|error| HistoryError::InvalidFormat(error.to_string()))?;

            return Ok(full_session_to_provider_events(
                &session,
                CanonicalAgentId::Cursor,
                AgentType::Cursor,
            ));
        }

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

fn explicit_transcript_path(input: &HistoryInput) -> Option<&PathBuf> {
    input.workspace_root.as_ref().filter(|path| {
        path.is_file()
            && matches!(
                path.extension().and_then(|extension| extension.to_str()),
                Some("json") | Some("jsonl") | Some("txt")
            )
    })
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
    use std::path::PathBuf;

    #[test]
    fn explicit_transcript_path_ignores_directory_with_transcript_extension() {
        let temp = tempfile::tempdir().expect("create fixture root");
        let workspace = temp.path().join("workspace.jsonl");
        std::fs::create_dir(&workspace).expect("create extension-shaped workspace directory");
        let input = HistoryInput {
            session_id: "cursor-session".to_string(),
            workspace_root: Some(workspace),
        };

        assert!(explicit_transcript_path(&input).is_none());
    }

    #[tokio::test]
    async fn cursor_history_source_reads_explicit_nested_agent_transcript_jsonl() {
        let temp = tempfile::tempdir().expect("create fixture root");
        let session_id = "256480a0-51fb-47fc-9b63-acbb5b308004";
        let transcript_dir = temp.path().join("agent-transcripts").join(session_id);
        std::fs::create_dir_all(&transcript_dir).expect("create nested transcript directory");
        let transcript_path = transcript_dir.join(format!("{session_id}.jsonl"));
        std::fs::write(
            &transcript_path,
            concat!(
                "{\"role\":\"user\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"<timestamp>Saturday, Jul 11, 2026, 12:31 AM (UTC+2)</timestamp>\\n<user_query>\\n\\nReply with exactly OPUS_CURSOR_OK\\n</user_query>\"}]}}\n",
                "{\"type\":\"turn_ended\",\"status\":\"error\",\"error\":\"[invalid_argument] Error\"}\n",
                "{\"role\":\"user\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"<user_query>\\nTry again\\n</user_query>\"}]}}\n"
            ),
        )
        .expect("write Cursor JSONL fixture");

        let events = CursorHistorySource
            .read(HistoryInput {
                session_id: session_id.to_string(),
                workspace_root: Some(transcript_path),
            })
            .await
            .expect("read explicit Cursor JSONL transcript");

        assert_eq!(events.len(), 3);
        assert_eq!(events[0].source, CanonicalAgentId::Cursor);
        assert_eq!(events[0].provider_seq, 0);
        assert!(matches!(
            &events[0].kind,
            ProviderEventKind::UserText { text, .. } if text == "Reply with exactly OPUS_CURSOR_OK"
        ));
        assert_eq!(events[1].source, CanonicalAgentId::Cursor);
        assert_eq!(events[1].provider_seq, 1);
        assert!(matches!(
            &events[1].kind,
            ProviderEventKind::TurnFailure {
                error: crate::acp::session_update::TurnErrorData::Legacy(error),
                turn_id: None,
            } if error == "[invalid_argument] Error"
        ));
        assert_eq!(events[2].provider_seq, 2);
        assert!(matches!(
            &events[2].kind,
            ProviderEventKind::UserText { text, .. } if text == "Try again"
        ));
    }

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

        let materialized_events =
            full_session_to_provider_events(&session, CanonicalAgentId::Cursor, AgentType::Cursor);
        let first_materialized_user = materialized_events
            .iter()
            .find(|event| {
                matches!(
                    &event.kind,
                    ProviderEventKind::UserText { .. }
                        | ProviderEventKind::UserPastedContent { .. }
                )
            })
            .expect("expected materialized user event");

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
            first_user_provider.provider_seq, first_materialized_user.provider_seq,
            "provider_seq must match the provider-event materializer order"
        );
    }
}
