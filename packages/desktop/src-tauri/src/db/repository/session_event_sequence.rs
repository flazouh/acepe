//! Atomic allocation for the canonical per-session event sequence.

use anyhow::{anyhow, Result};
use sea_orm::{ConnectionTrait, DatabaseBackend, DatabaseTransaction, DbConn, Statement};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct SessionEventSeq(i64);

impl SessionEventSeq {
    pub const ZERO: Self = Self(0);

    fn from_allocated(value: i64) -> Result<Self> {
        if value < 1 {
            return Err(anyhow!(
                "allocated session event sequence must be positive, got {value}"
            ));
        }
        Ok(Self(value))
    }

    #[must_use]
    pub const fn get(self) -> i64 {
        self.0
    }

    #[must_use]
    pub const fn previous(self) -> Self {
        Self(self.0.saturating_sub(1))
    }
}

pub struct SessionEventSequenceRepository;

impl SessionEventSequenceRepository {
    /// Allocate exactly one sequence inside a caller-owned transaction.
    ///
    /// This must be the transaction's first SQL statement. The upsert starts
    /// the transaction as a writer, so SQLite can wait for the current writer
    /// instead of failing a stale read transaction with `SQLITE_BUSY_SNAPSHOT`.
    pub(crate) async fn allocate_in_transaction(
        tx: &DatabaseTransaction,
        session_id: &str,
    ) -> Result<SessionEventSeq> {
        let row = tx
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Sqlite,
                r#"
                INSERT INTO session_event_sequence (session_id, last_assigned_seq)
                VALUES (?, 1)
                ON CONFLICT(session_id) DO UPDATE SET
                    last_assigned_seq = session_event_sequence.last_assigned_seq + 1
                RETURNING last_assigned_seq
                "#,
                [session_id.into()],
            ))
            .await?
            .ok_or_else(|| anyhow!("session event sequence allocation returned no row"))?;

        SessionEventSeq::from_allocated(row.try_get_by_index::<i64>(0)?)
    }

    pub async fn last_assigned_event_seq(
        db: &DbConn,
        session_id: &str,
    ) -> Result<Option<SessionEventSeq>> {
        let row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Sqlite,
                "SELECT last_assigned_seq FROM session_event_sequence WHERE session_id = ?",
                [session_id.into()],
            ))
            .await?;

        row.map(|row| {
            let value = row.try_get_by_index::<i64>(0)?;
            SessionEventSeq::from_allocated(value)
        })
        .transpose()
    }
}
