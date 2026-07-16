//! Canonical transactional writer for sequenced session updates.

use crate::{
    acp::session_journal::{
        ProjectionJournalUpdate, SessionJournalEvent as SessionJournalRecord,
        SessionJournalEventPayload,
    },
    acp::session_update::SessionUpdate,
    db::repository::{SessionEventSequenceRepository, SessionJournalEventRepository},
};
use anyhow::Result;
use sea_orm::{DbConn, TransactionTrait};

#[derive(Debug, Clone)]
pub struct SequencedSessionUpdate {
    pub event_seq: i64,
    pub previous_event_seq: i64,
    pub record: Option<SessionJournalRecord>,
}

pub struct SessionEventWriter;

impl SessionEventWriter {
    /// Assign one durable delivery sequence and optionally store its raw
    /// journal representation in the same transaction.
    pub async fn commit_session_update(
        db: &DbConn,
        session_id: &str,
        update: &SessionUpdate,
    ) -> Result<SequencedSessionUpdate> {
        tracing::debug!(session_id = %session_id, "Committing sequenced session update");

        let tx = db.begin().await?;
        let event_seq =
            SessionEventSequenceRepository::allocate_in_transaction(&tx, session_id).await?;
        let record = ProjectionJournalUpdate::from_session_update(update)
            .map(|update| SessionJournalEventPayload::ProjectionUpdate {
                update: Box::new(update),
            })
            .map(|payload| SessionJournalRecord::new(session_id, event_seq, payload));
        if let Some(record) = record.as_ref() {
            SessionJournalEventRepository::insert_in_transaction(&tx, record).await?;
        }
        tx.commit().await?;

        Ok(SequencedSessionUpdate {
            event_seq,
            previous_event_seq: event_seq.saturating_sub(1),
            record,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::SessionEventWriter;
    use crate::db::repository::{
        SessionEventSequenceRepository, SessionJournalEventRepository, SessionMetadataRepository,
    };
    use sea_orm::{ConnectionTrait, DatabaseBackend, Statement};
    use std::sync::Arc;
    use tempfile::tempdir;
    use tokio::sync::Barrier;

    async fn ensure_session(db: &sea_orm::DbConn, session_id: &str) {
        SessionMetadataRepository::ensure_exists(db, session_id, "/test/repo", "claude-code", None)
            .await
            .expect("ensure writer test session");
    }

    fn journaled_update(
        session_id: &str,
        turn_id: &str,
    ) -> crate::acp::session_update::SessionUpdate {
        crate::acp::session_update::SessionUpdate::TurnComplete {
            session_id: Some(session_id.to_string()),
            turn_id: Some(turn_id.to_string()),
        }
    }

    fn non_journaled_update(session_id: &str) -> crate::acp::session_update::SessionUpdate {
        crate::acp::session_update::SessionUpdate::CurrentModeUpdate {
            update: crate::acp::session_update::CurrentModeData {
                current_mode_id: "plan".to_string(),
            },
            session_id: Some(session_id.to_string()),
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 8)]
    async fn concurrent_session_updates_are_serialized_per_session() {
        const UPDATE_COUNT: usize = 16;
        const SESSION_ID: &str = "concurrent-session-event-writer";

        let dir = tempdir().expect("create writer concurrency directory");
        let db = crate::db::init_db_at_path(dir.path().join("writer.db"))
            .await
            .expect("initialize file-backed WAL database");
        ensure_session(&db, SESSION_ID).await;

        let start = Arc::new(Barrier::new(UPDATE_COUNT));
        let mut tasks = Vec::with_capacity(UPDATE_COUNT);
        for index in 0..UPDATE_COUNT {
            let db = db.clone();
            let start = Arc::clone(&start);
            tasks.push(tokio::spawn(async move {
                start.wait().await;
                SessionEventWriter::commit_session_update(
                    &db,
                    SESSION_ID,
                    &journaled_update(SESSION_ID, &format!("turn-{index}")),
                )
                .await
            }));
        }

        let mut sequences = Vec::with_capacity(UPDATE_COUNT);
        let mut errors = Vec::new();
        for task in tasks {
            match task.await.expect("writer task should not panic") {
                Ok(result) => sequences.push(result.event_seq),
                Err(error) => errors.push(format!("{error:#}")),
            }
        }
        assert!(errors.is_empty(), "concurrent writes failed: {errors:#?}");
        sequences.sort_unstable();
        assert_eq!(sequences, (1..=UPDATE_COUNT as i64).collect::<Vec<_>>());
    }

    #[tokio::test]
    async fn non_journaled_update_advances_the_next_journaled_sequence() {
        const SESSION_ID: &str = "non-journal-then-journal";

        let dir = tempdir().expect("create strict sequence directory");
        let db = crate::db::init_db_at_path(dir.path().join("writer.db"))
            .await
            .expect("initialize strict sequence database");
        ensure_session(&db, SESSION_ID).await;

        let first = SessionEventWriter::commit_session_update(
            &db,
            SESSION_ID,
            &non_journaled_update(SESSION_ID),
        )
        .await
        .expect("commit non-journaled update");
        assert_eq!(first.event_seq, 1);
        assert_eq!(first.previous_event_seq, 0);
        assert!(first.record.is_none());

        let second = SessionEventWriter::commit_session_update(
            &db,
            SESSION_ID,
            &journaled_update(SESSION_ID, "turn-1"),
        )
        .await
        .expect("commit journaled update");
        assert_eq!(second.event_seq, 2);
        assert_eq!(second.previous_event_seq, 1);
        assert_eq!(
            second.record.as_ref().map(|record| record.event_seq),
            Some(2)
        );
    }

    #[tokio::test]
    async fn journal_insert_failure_rolls_back_sequence_allocation() {
        const SESSION_ID: &str = "journal-failure-rolls-back";

        let dir = tempdir().expect("create rollback test directory");
        let db = crate::db::init_db_at_path(dir.path().join("writer.db"))
            .await
            .expect("initialize rollback test database");
        ensure_session(&db, SESSION_ID).await;
        db.execute(Statement::from_string(
            DatabaseBackend::Sqlite,
            format!(
                "CREATE TRIGGER fail_session_journal_insert \
                 BEFORE INSERT ON session_journal_event \
                 WHEN NEW.session_id = '{SESSION_ID}' \
                 BEGIN SELECT RAISE(ABORT, 'forced journal failure'); END"
            ),
        ))
        .await
        .expect("install journal failure trigger");

        SessionEventWriter::commit_session_update(
            &db,
            SESSION_ID,
            &journaled_update(SESSION_ID, "turn-fails"),
        )
        .await
        .expect_err("forced journal insert must fail");
        assert_eq!(
            SessionEventSequenceRepository::last_assigned_event_seq(&db, SESSION_ID)
                .await
                .expect("read rolled-back sequence"),
            None
        );

        db.execute(Statement::from_string(
            DatabaseBackend::Sqlite,
            "DROP TRIGGER fail_session_journal_insert".to_string(),
        ))
        .await
        .expect("remove journal failure trigger");
        let committed = SessionEventWriter::commit_session_update(
            &db,
            SESSION_ID,
            &journaled_update(SESSION_ID, "turn-succeeds"),
        )
        .await
        .expect("commit after rollback");
        assert_eq!(committed.event_seq, 1);
    }

    #[tokio::test]
    async fn journal_compaction_and_reopen_preserve_the_sequence_frontier() {
        const SESSION_ID: &str = "compacted-journal-sequence";

        let dir = tempdir().expect("create reopen test directory");
        let db_path = dir.path().join("writer.db");
        let db = crate::db::init_db_at_path(db_path.clone())
            .await
            .expect("initialize reopen test database");
        ensure_session(&db, SESSION_ID).await;
        for index in 1..=2 {
            SessionEventWriter::commit_session_update(
                &db,
                SESSION_ID,
                &journaled_update(SESSION_ID, &format!("turn-{index}")),
            )
            .await
            .expect("commit before compaction");
        }
        db.execute(Statement::from_sql_and_values(
            DatabaseBackend::Sqlite,
            "DELETE FROM session_journal_event WHERE session_id = ?",
            [SESSION_ID.into()],
        ))
        .await
        .expect("compact journal rows");
        assert!(
            SessionJournalEventRepository::list_serialized(&db, SESSION_ID)
                .await
                .expect("read compacted journal")
                .is_empty()
        );
        drop(db);

        let reopened = crate::db::init_db_at_path(db_path)
            .await
            .expect("reopen compacted database");
        assert_eq!(
            SessionEventSequenceRepository::last_assigned_event_seq(&reopened, SESSION_ID)
                .await
                .expect("read reopened frontier"),
            Some(2)
        );
        let next = SessionEventWriter::commit_session_update(
            &reopened,
            SESSION_ID,
            &journaled_update(SESSION_ID, "turn-3"),
        )
        .await
        .expect("commit after reopen");
        assert_eq!(next.event_seq, 3);
    }
}
