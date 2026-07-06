//! Persisted transcript row-ledger repository.

use crate::{
    acp::transcript_viewport::ledger::{
        SerializedTranscriptRowLedgerRow, SessionTranscriptRowLedgerMetadata,
        SessionTranscriptRowLedgerRead, SessionTranscriptRowLedgerStatus,
    },
    db::entities::{session_transcript_row, session_transcript_row_ledger},
};
use anyhow::{anyhow, Result};
use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DbConn, EntityTrait, QueryFilter, QueryOrder, QuerySelect, Set,
    TransactionTrait,
};

pub struct SessionTranscriptRowLedgerRepository;

const LEDGER_ROW_INSERT_CHUNK_SIZE: usize = 500;

impl SessionTranscriptRowLedgerRepository {
    pub async fn mark_rebuild_needed(
        db: &DbConn,
        session_id: &str,
        projection_version: &str,
        transcript_revision: i64,
        graph_revision: i64,
        last_event_seq: i64,
    ) -> Result<()> {
        let tx = db.begin().await?;
        let now = Utc::now();
        let existing = session_transcript_row_ledger::Entity::find_by_id(session_id.to_string())
            .one(&tx)
            .await?;

        if let Some(existing_model) = existing {
            let mut active: session_transcript_row_ledger::ActiveModel = existing_model.into();
            active.transcript_revision = Set(transcript_revision);
            active.graph_revision = Set(graph_revision);
            active.last_event_seq = Set(last_event_seq);
            active.projection_version = Set(projection_version.to_string());
            active.open_header_json = Set(None);
            active.rebuild_status = Set(SessionTranscriptRowLedgerStatus::RebuildNeeded
                .as_str()
                .into());
            active.updated_at = Set(now);
            active.update(&tx).await?;
        } else {
            let active = session_transcript_row_ledger::ActiveModel {
                session_id: Set(session_id.to_string()),
                row_count: Set(0),
                transcript_revision: Set(transcript_revision),
                graph_revision: Set(graph_revision),
                last_event_seq: Set(last_event_seq),
                projection_version: Set(projection_version.to_string()),
                open_header_json: Set(None),
                rebuild_status: Set(SessionTranscriptRowLedgerStatus::RebuildNeeded
                    .as_str()
                    .into()),
                updated_at: Set(now),
            };
            session_transcript_row_ledger::Entity::insert(active)
                .exec(&tx)
                .await?;
        }

        tx.commit().await?;
        Ok(())
    }

    pub async fn replace_current(
        db: &DbConn,
        session_id: &str,
        projection_version: &str,
        transcript_revision: i64,
        graph_revision: i64,
        last_event_seq: i64,
        open_header_json: Option<String>,
        rows: Vec<SerializedTranscriptRowLedgerRow>,
    ) -> Result<()> {
        for row in &rows {
            Self::validate_row(
                session_id,
                projection_version,
                transcript_revision,
                graph_revision,
                row,
            )?;
        }

        let tx = db.begin().await?;
        let now = Utc::now();

        session_transcript_row::Entity::delete_many()
            .filter(session_transcript_row::Column::SessionId.eq(session_id))
            .exec(&tx)
            .await?;

        let row_count = rows.len() as i64;
        let mut active_rows = Vec::with_capacity(LEDGER_ROW_INSERT_CHUNK_SIZE);
        for row in rows {
            active_rows.push(session_transcript_row::ActiveModel {
                session_id: Set(row.session_id),
                row_index: Set(row.row_index),
                row_id: Set(row.row_id),
                source_entry_id: Set(row.source_entry_id),
                row_kind: Set(row.row_kind),
                row_version: Set(row.row_version),
                transcript_revision: Set(row.transcript_revision),
                graph_revision: Set(row.graph_revision),
                projection_version: Set(row.projection_version),
                row_json: Set(row.row_json),
                updated_at: Set(now),
            });
            if active_rows.len() == LEDGER_ROW_INSERT_CHUNK_SIZE {
                session_transcript_row::Entity::insert_many(active_rows)
                    .exec(&tx)
                    .await?;
                active_rows = Vec::with_capacity(LEDGER_ROW_INSERT_CHUNK_SIZE);
            }
        }
        if !active_rows.is_empty() {
            session_transcript_row::Entity::insert_many(active_rows)
                .exec(&tx)
                .await?;
        }

        let existing = session_transcript_row_ledger::Entity::find_by_id(session_id.to_string())
            .one(&tx)
            .await?;
        if let Some(existing_model) = existing {
            let mut active: session_transcript_row_ledger::ActiveModel = existing_model.into();
            active.row_count = Set(row_count);
            active.transcript_revision = Set(transcript_revision);
            active.graph_revision = Set(graph_revision);
            active.last_event_seq = Set(last_event_seq);
            active.projection_version = Set(projection_version.to_string());
            active.open_header_json = Set(open_header_json.clone());
            active.rebuild_status = Set(SessionTranscriptRowLedgerStatus::Current.as_str().into());
            active.updated_at = Set(now);
            active.update(&tx).await?;
        } else {
            let active = session_transcript_row_ledger::ActiveModel {
                session_id: Set(session_id.to_string()),
                row_count: Set(row_count),
                transcript_revision: Set(transcript_revision),
                graph_revision: Set(graph_revision),
                last_event_seq: Set(last_event_seq),
                projection_version: Set(projection_version.to_string()),
                open_header_json: Set(open_header_json),
                rebuild_status: Set(SessionTranscriptRowLedgerStatus::Current.as_str().into()),
                updated_at: Set(now),
            };
            session_transcript_row_ledger::Entity::insert(active)
                .exec(&tx)
                .await?;
        }

        tx.commit().await?;
        Ok(())
    }

    pub async fn replace_current_suffix(
        db: &DbConn,
        session_id: &str,
        projection_version: &str,
        transcript_revision: i64,
        graph_revision: i64,
        last_event_seq: i64,
        open_header_json: Option<String>,
        total_row_count: i64,
        start_row_index: i64,
        rows: Vec<SerializedTranscriptRowLedgerRow>,
    ) -> Result<bool> {
        if start_row_index == 0 {
            Self::replace_current(
                db,
                session_id,
                projection_version,
                transcript_revision,
                graph_revision,
                last_event_seq,
                open_header_json,
                rows,
            )
            .await?;
            return Ok(true);
        }
        if start_row_index < 0 || total_row_count < start_row_index {
            return Err(anyhow!(
                "transcript row ledger suffix range is invalid: start {}, total {}",
                start_row_index,
                total_row_count
            ));
        }
        let expected_total = start_row_index.saturating_add(rows.len() as i64);
        if expected_total != total_row_count {
            return Err(anyhow!(
                "transcript row ledger suffix row count is invalid: start {} + rows {} != total {}",
                start_row_index,
                rows.len(),
                total_row_count
            ));
        }
        for (offset, row) in rows.iter().enumerate() {
            Self::validate_row(
                session_id,
                projection_version,
                transcript_revision,
                graph_revision,
                row,
            )?;
            let expected_index = start_row_index.saturating_add(offset as i64);
            if row.row_index != expected_index {
                return Err(anyhow!(
                    "transcript row ledger suffix row index {}, expected {}",
                    row.row_index,
                    expected_index
                ));
            }
        }

        let Some(metadata) = Self::load_metadata(db, session_id).await? else {
            return Ok(false);
        };
        if !metadata.is_current_for(projection_version) || metadata.row_count < start_row_index {
            return Ok(false);
        }

        let tx = db.begin().await?;
        let now = Utc::now();

        session_transcript_row::Entity::delete_many()
            .filter(session_transcript_row::Column::SessionId.eq(session_id))
            .filter(session_transcript_row::Column::RowIndex.gte(start_row_index))
            .exec(&tx)
            .await?;

        let mut active_rows = Vec::with_capacity(LEDGER_ROW_INSERT_CHUNK_SIZE);
        for row in rows {
            active_rows.push(session_transcript_row::ActiveModel {
                session_id: Set(row.session_id),
                row_index: Set(row.row_index),
                row_id: Set(row.row_id),
                source_entry_id: Set(row.source_entry_id),
                row_kind: Set(row.row_kind),
                row_version: Set(row.row_version),
                transcript_revision: Set(row.transcript_revision),
                graph_revision: Set(row.graph_revision),
                projection_version: Set(row.projection_version),
                row_json: Set(row.row_json),
                updated_at: Set(now),
            });
            if active_rows.len() == LEDGER_ROW_INSERT_CHUNK_SIZE {
                session_transcript_row::Entity::insert_many(active_rows)
                    .exec(&tx)
                    .await?;
                active_rows = Vec::with_capacity(LEDGER_ROW_INSERT_CHUNK_SIZE);
            }
        }
        if !active_rows.is_empty() {
            session_transcript_row::Entity::insert_many(active_rows)
                .exec(&tx)
                .await?;
        }

        let existing = session_transcript_row_ledger::Entity::find_by_id(session_id.to_string())
            .one(&tx)
            .await?;
        let Some(existing_model) = existing else {
            return Ok(false);
        };
        let mut active: session_transcript_row_ledger::ActiveModel = existing_model.into();
        active.row_count = Set(total_row_count);
        active.transcript_revision = Set(transcript_revision);
        active.graph_revision = Set(graph_revision);
        active.last_event_seq = Set(last_event_seq);
        active.projection_version = Set(projection_version.to_string());
        active.open_header_json = Set(open_header_json);
        active.rebuild_status = Set(SessionTranscriptRowLedgerStatus::Current.as_str().into());
        active.updated_at = Set(now);
        active.update(&tx).await?;

        tx.commit().await?;
        Ok(true)
    }

    pub async fn read_tail_page(
        db: &DbConn,
        session_id: &str,
        expected_projection_version: &str,
        limit: u64,
    ) -> Result<SessionTranscriptRowLedgerRead> {
        let Some(metadata) = Self::load_metadata(db, session_id).await? else {
            return Ok(SessionTranscriptRowLedgerRead::Missing);
        };

        if !metadata.is_current_for(expected_projection_version) {
            return Ok(SessionTranscriptRowLedgerRead::Stale { metadata });
        }

        let limit_i64 = i64::try_from(limit).unwrap_or(i64::MAX);
        let start_index = metadata.row_count.saturating_sub(limit_i64);
        let rows = Self::load_rows_from(db, session_id, start_index, limit).await?;

        Ok(SessionTranscriptRowLedgerRead::Current { metadata, rows })
    }

    pub async fn read_range_page(
        db: &DbConn,
        session_id: &str,
        expected_projection_version: &str,
        start_index: i64,
        limit: u64,
    ) -> Result<SessionTranscriptRowLedgerRead> {
        let Some(metadata) = Self::load_metadata(db, session_id).await? else {
            return Ok(SessionTranscriptRowLedgerRead::Missing);
        };

        if !metadata.is_current_for(expected_projection_version) {
            return Ok(SessionTranscriptRowLedgerRead::Stale { metadata });
        }

        let rows = Self::load_rows_from(db, session_id, start_index.max(0), limit).await?;

        Ok(SessionTranscriptRowLedgerRead::Current { metadata, rows })
    }

    pub async fn read_metadata(
        db: &DbConn,
        session_id: &str,
    ) -> Result<Option<SessionTranscriptRowLedgerMetadata>> {
        Self::load_metadata(db, session_id).await
    }

    async fn load_metadata(
        db: &DbConn,
        session_id: &str,
    ) -> Result<Option<SessionTranscriptRowLedgerMetadata>> {
        session_transcript_row_ledger::Entity::find_by_id(session_id.to_string())
            .one(db)
            .await?
            .map(Self::metadata_from_model)
            .transpose()
    }

    async fn load_rows_from(
        db: &DbConn,
        session_id: &str,
        start_index: i64,
        limit: u64,
    ) -> Result<Vec<SerializedTranscriptRowLedgerRow>> {
        let rows = session_transcript_row::Entity::find()
            .filter(session_transcript_row::Column::SessionId.eq(session_id))
            .filter(session_transcript_row::Column::RowIndex.gte(start_index))
            .order_by_asc(session_transcript_row::Column::RowIndex)
            .limit(limit)
            .all(db)
            .await?
            .into_iter()
            .map(Self::row_from_model)
            .collect::<Vec<_>>();
        Ok(rows)
    }

    fn metadata_from_model(
        model: session_transcript_row_ledger::Model,
    ) -> Result<SessionTranscriptRowLedgerMetadata> {
        let rebuild_status = SessionTranscriptRowLedgerStatus::from_persisted(
            &model.rebuild_status,
        )
        .ok_or_else(|| {
            anyhow!(
                "unknown transcript row ledger status: {}",
                model.rebuild_status
            )
        })?;
        Ok(SessionTranscriptRowLedgerMetadata {
            session_id: model.session_id,
            row_count: model.row_count,
            transcript_revision: model.transcript_revision,
            graph_revision: model.graph_revision,
            last_event_seq: model.last_event_seq,
            projection_version: model.projection_version,
            open_header_json: model.open_header_json,
            rebuild_status,
            updated_at_ms: model.updated_at.timestamp_millis().max(0),
        })
    }

    fn row_from_model(model: session_transcript_row::Model) -> SerializedTranscriptRowLedgerRow {
        SerializedTranscriptRowLedgerRow {
            session_id: model.session_id,
            row_index: model.row_index,
            row_id: model.row_id,
            source_entry_id: model.source_entry_id,
            row_kind: model.row_kind,
            row_version: model.row_version,
            transcript_revision: model.transcript_revision,
            graph_revision: model.graph_revision,
            projection_version: model.projection_version,
            row_json: model.row_json,
        }
    }

    fn validate_row(
        session_id: &str,
        projection_version: &str,
        transcript_revision: i64,
        graph_revision: i64,
        row: &SerializedTranscriptRowLedgerRow,
    ) -> Result<()> {
        if row.session_id != session_id {
            return Err(anyhow!(
                "transcript row ledger row belongs to session {}, expected {}",
                row.session_id,
                session_id
            ));
        }
        if row.projection_version != projection_version {
            return Err(anyhow!(
                "transcript row ledger row has projection version {}, expected {}",
                row.projection_version,
                projection_version
            ));
        }
        if row.transcript_revision != transcript_revision {
            return Err(anyhow!(
                "transcript row ledger row has transcript revision {}, expected {}",
                row.transcript_revision,
                transcript_revision
            ));
        }
        if row.graph_revision != graph_revision {
            return Err(anyhow!(
                "transcript row ledger row has graph revision {}, expected {}",
                row.graph_revision,
                graph_revision
            ));
        }
        Ok(())
    }
}

impl SessionTranscriptRowLedgerMetadata {
    fn is_current_for(&self, projection_version: &str) -> bool {
        self.rebuild_status == SessionTranscriptRowLedgerStatus::Current
            && self.projection_version == projection_version
    }
}
