//! Persisted transcript row-ledger repository.

use crate::{
    acp::transcript_projection::TranscriptScope,
    acp::transcript_viewport::ledger::{
        SerializedTranscriptRowLedgerRow, SerializedTranscriptRowLedgerScope,
        SessionTranscriptRowLedgerMetadata, SessionTranscriptRowLedgerRead,
        SessionTranscriptRowLedgerStatus,
    },
    db::entities::{
        session_transcript_row, session_transcript_row_ledger, session_transcript_row_scope,
    },
};
use anyhow::{anyhow, Result};
use chrono::{DateTime, Utc};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DbConn, EntityTrait, QueryFilter, QueryOrder, QuerySelect, Set,
    TransactionTrait,
};
use std::collections::{BTreeMap, BTreeSet};

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
        Self::write_session_header(
            &tx,
            session_id,
            projection_version,
            transcript_revision,
            graph_revision,
            last_event_seq,
            None,
            SessionTranscriptRowLedgerStatus::RebuildNeeded,
            now,
        )
        .await?;
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
        Self::replace_current_scopes(
            db,
            session_id,
            projection_version,
            transcript_revision,
            graph_revision,
            last_event_seq,
            open_header_json,
            vec![SerializedTranscriptRowLedgerScope {
                scope: TranscriptScope::Root,
                rows,
            }],
        )
        .await
    }

    pub async fn replace_current_scopes(
        db: &DbConn,
        session_id: &str,
        projection_version: &str,
        transcript_revision: i64,
        graph_revision: i64,
        last_event_seq: i64,
        open_header_json: Option<String>,
        scopes: Vec<SerializedTranscriptRowLedgerScope>,
    ) -> Result<()> {
        for scope_rows in &scopes {
            Self::validate_scope(&scope_rows.scope)?;
            for (index, row) in scope_rows.rows.iter().enumerate() {
                Self::validate_row(
                    session_id,
                    projection_version,
                    transcript_revision,
                    graph_revision,
                    &scope_rows.scope,
                    index as i64,
                    row,
                )?;
            }
        }

        let tx = db.begin().await?;
        let now = Utc::now();
        session_transcript_row::Entity::delete_many()
            .filter(session_transcript_row::Column::SessionId.eq(session_id))
            .exec(&tx)
            .await?;
        session_transcript_row_scope::Entity::delete_many()
            .filter(session_transcript_row_scope::Column::SessionId.eq(session_id))
            .exec(&tx)
            .await?;

        for scope_rows in scopes {
            let scope_key = scope_rows.scope.ledger_key();
            let row_count = scope_rows.rows.len() as i64;
            Self::insert_rows(&tx, scope_rows.rows, now).await?;
            session_transcript_row_scope::Entity::insert(
                session_transcript_row_scope::ActiveModel {
                    session_id: Set(session_id.to_string()),
                    scope_key: Set(scope_key),
                    row_count: Set(row_count),
                    updated_at: Set(now),
                },
            )
            .exec(&tx)
            .await?;
        }

        Self::write_session_header(
            &tx,
            session_id,
            projection_version,
            transcript_revision,
            graph_revision,
            last_event_seq,
            open_header_json,
            SessionTranscriptRowLedgerStatus::Current,
            now,
        )
        .await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn replace_changed_scopes(
        db: &DbConn,
        session_id: &str,
        projection_version: &str,
        transcript_revision: i64,
        graph_revision: i64,
        last_event_seq: i64,
        open_header_json: Option<String>,
        scopes: Vec<SerializedTranscriptRowLedgerScope>,
    ) -> Result<Vec<TranscriptScope>> {
        for scope_rows in &scopes {
            Self::validate_scope(&scope_rows.scope)?;
            for (index, row) in scope_rows.rows.iter().enumerate() {
                Self::validate_row(
                    session_id,
                    projection_version,
                    transcript_revision,
                    graph_revision,
                    &scope_rows.scope,
                    index as i64,
                    row,
                )?;
            }
        }

        let tx = db.begin().await?;
        let now = Utc::now();
        let persisted_scope_models = session_transcript_row_scope::Entity::find()
            .filter(session_transcript_row_scope::Column::SessionId.eq(session_id))
            .all(&tx)
            .await?;
        let persisted_row_models = session_transcript_row::Entity::find()
            .filter(session_transcript_row::Column::SessionId.eq(session_id))
            .order_by_asc(session_transcript_row::Column::ScopeKey)
            .order_by_asc(session_transcript_row::Column::RowIndex)
            .all(&tx)
            .await?;
        let mut persisted_scopes = BTreeMap::new();
        let mut scope_models_by_key = BTreeMap::new();
        let mut row_models_by_scope_key = BTreeMap::<String, Vec<_>>::new();
        for scope_model in persisted_scope_models {
            let scope = Self::parse_persisted_scope_key(&scope_model.scope_key)?;
            persisted_scopes.insert(scope_model.scope_key.clone(), scope);
            scope_models_by_key.insert(scope_model.scope_key.clone(), scope_model);
        }
        for row_model in persisted_row_models {
            let scope = Self::parse_persisted_scope_key(&row_model.scope_key)?;
            persisted_scopes.insert(row_model.scope_key.clone(), scope);
            row_models_by_scope_key
                .entry(row_model.scope_key.clone())
                .or_default()
                .push(row_model);
        }

        let mut incoming_scope_keys = BTreeSet::new();
        let mut changed_scopes = Vec::new();
        for scope_rows in scopes {
            let scope_key = scope_rows.scope.ledger_key();
            if !incoming_scope_keys.insert(scope_key.clone()) {
                return Err(anyhow!(
                    "duplicate incoming transcript row scope key: {scope_key}"
                ));
            }
            let existing_scope = scope_models_by_key.get(&scope_key);
            let existing_rows = row_models_by_scope_key
                .get(&scope_key)
                .map(Vec::as_slice)
                .unwrap_or_default();
            let row_count = scope_rows.rows.len() as i64;
            let unchanged = existing_scope.is_some_and(|model| model.row_count == row_count)
                && existing_rows.len() == scope_rows.rows.len()
                && existing_rows
                    .iter()
                    .zip(&scope_rows.rows)
                    .all(|(existing, incoming)| {
                        existing.row_id == incoming.row_id
                            && existing.row_version == incoming.row_version
                    });
            if unchanged {
                continue;
            }

            session_transcript_row::Entity::delete_many()
                .filter(session_transcript_row::Column::SessionId.eq(session_id))
                .filter(session_transcript_row::Column::ScopeKey.eq(&scope_key))
                .exec(&tx)
                .await?;
            Self::insert_rows(&tx, scope_rows.rows, now).await?;
            if let Some(existing_scope) = existing_scope {
                let mut active: session_transcript_row_scope::ActiveModel =
                    existing_scope.clone().into();
                active.row_count = Set(row_count);
                active.updated_at = Set(now);
                active.update(&tx).await?;
            } else {
                session_transcript_row_scope::Entity::insert(
                    session_transcript_row_scope::ActiveModel {
                        session_id: Set(session_id.to_string()),
                        scope_key: Set(scope_key),
                        row_count: Set(row_count),
                        updated_at: Set(now),
                    },
                )
                .exec(&tx)
                .await?;
            }
            changed_scopes.push(scope_rows.scope);
        }

        for (scope_key, scope) in persisted_scopes {
            if incoming_scope_keys.contains(&scope_key) {
                continue;
            }
            session_transcript_row::Entity::delete_many()
                .filter(session_transcript_row::Column::SessionId.eq(session_id))
                .filter(session_transcript_row::Column::ScopeKey.eq(&scope_key))
                .exec(&tx)
                .await?;
            session_transcript_row_scope::Entity::delete_by_id((session_id.to_string(), scope_key))
                .exec(&tx)
                .await?;
            changed_scopes.push(scope);
        }

        Self::write_session_header(
            &tx,
            session_id,
            projection_version,
            transcript_revision,
            graph_revision,
            last_event_seq,
            open_header_json,
            SessionTranscriptRowLedgerStatus::Current,
            now,
        )
        .await?;
        tx.commit().await?;
        Ok(changed_scopes)
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
        if start_row_index.saturating_add(rows.len() as i64) != total_row_count {
            return Err(anyhow!("transcript row ledger suffix row count is invalid"));
        }
        for (offset, row) in rows.iter().enumerate() {
            Self::validate_row(
                session_id,
                projection_version,
                transcript_revision,
                graph_revision,
                &TranscriptScope::Root,
                start_row_index.saturating_add(offset as i64),
                row,
            )?;
        }

        let Some(metadata) =
            Self::load_metadata_for_scope(db, session_id, &TranscriptScope::Root).await?
        else {
            return Ok(false);
        };
        if !metadata.is_current_for(projection_version) || metadata.row_count < start_row_index {
            return Ok(false);
        }

        let tx = db.begin().await?;
        let now = Utc::now();
        session_transcript_row::Entity::delete_many()
            .filter(session_transcript_row::Column::SessionId.eq(session_id))
            .filter(session_transcript_row::Column::ScopeKey.eq(TranscriptScope::Root.ledger_key()))
            .filter(session_transcript_row::Column::RowIndex.gte(start_row_index))
            .exec(&tx)
            .await?;
        Self::insert_rows(&tx, rows, now).await?;

        let scope_model = session_transcript_row_scope::Entity::find_by_id((
            session_id.to_string(),
            TranscriptScope::Root.ledger_key(),
        ))
        .one(&tx)
        .await?;
        let Some(scope_model) = scope_model else {
            return Ok(false);
        };
        let mut scope_active: session_transcript_row_scope::ActiveModel = scope_model.into();
        scope_active.row_count = Set(total_row_count);
        scope_active.updated_at = Set(now);
        scope_active.update(&tx).await?;
        Self::write_session_header(
            &tx,
            session_id,
            projection_version,
            transcript_revision,
            graph_revision,
            last_event_seq,
            open_header_json,
            SessionTranscriptRowLedgerStatus::Current,
            now,
        )
        .await?;
        tx.commit().await?;
        Ok(true)
    }

    pub async fn read_tail_page(
        db: &DbConn,
        session_id: &str,
        expected_projection_version: &str,
        limit: u64,
    ) -> Result<SessionTranscriptRowLedgerRead> {
        Self::read_tail_page_for_scope(
            db,
            session_id,
            expected_projection_version,
            &TranscriptScope::Root,
            limit,
        )
        .await
    }

    pub async fn read_tail_page_for_scope(
        db: &DbConn,
        session_id: &str,
        expected_projection_version: &str,
        scope: &TranscriptScope,
        limit: u64,
    ) -> Result<SessionTranscriptRowLedgerRead> {
        let Some(metadata) = Self::load_metadata_for_scope(db, session_id, scope).await? else {
            return Ok(SessionTranscriptRowLedgerRead::Missing);
        };
        if !metadata.is_current_for(expected_projection_version) {
            return Ok(SessionTranscriptRowLedgerRead::Stale { metadata });
        }
        let limit_i64 = i64::try_from(limit).unwrap_or(i64::MAX);
        let start_index = metadata.row_count.saturating_sub(limit_i64);
        let rows = Self::load_rows_from(db, session_id, scope, start_index, limit).await?;
        Ok(SessionTranscriptRowLedgerRead::Current { metadata, rows })
    }

    pub async fn read_range_page(
        db: &DbConn,
        session_id: &str,
        expected_projection_version: &str,
        start_index: i64,
        limit: u64,
    ) -> Result<SessionTranscriptRowLedgerRead> {
        Self::read_range_page_for_scope(
            db,
            session_id,
            expected_projection_version,
            &TranscriptScope::Root,
            start_index,
            limit,
        )
        .await
    }

    pub async fn read_range_page_for_scope(
        db: &DbConn,
        session_id: &str,
        expected_projection_version: &str,
        scope: &TranscriptScope,
        start_index: i64,
        limit: u64,
    ) -> Result<SessionTranscriptRowLedgerRead> {
        let Some(metadata) = Self::load_metadata_for_scope(db, session_id, scope).await? else {
            return Ok(SessionTranscriptRowLedgerRead::Missing);
        };
        if !metadata.is_current_for(expected_projection_version) {
            return Ok(SessionTranscriptRowLedgerRead::Stale { metadata });
        }
        let rows = Self::load_rows_from(db, session_id, scope, start_index.max(0), limit).await?;
        Ok(SessionTranscriptRowLedgerRead::Current { metadata, rows })
    }

    pub async fn read_metadata(
        db: &DbConn,
        session_id: &str,
    ) -> Result<Option<SessionTranscriptRowLedgerMetadata>> {
        Self::load_metadata_for_scope(db, session_id, &TranscriptScope::Root).await
    }

    async fn load_metadata_for_scope(
        db: &DbConn,
        session_id: &str,
        scope: &TranscriptScope,
    ) -> Result<Option<SessionTranscriptRowLedgerMetadata>> {
        let Some(header) =
            session_transcript_row_ledger::Entity::find_by_id(session_id.to_string())
                .one(db)
                .await?
        else {
            return Ok(None);
        };
        let scope_model = session_transcript_row_scope::Entity::find_by_id((
            session_id.to_string(),
            scope.ledger_key(),
        ))
        .one(db)
        .await?;
        let persisted_scope = scope_model
            .as_ref()
            .map(|model| Self::parse_persisted_scope_key(&model.scope_key))
            .transpose()?;
        if scope_model.is_none()
            && header.rebuild_status == SessionTranscriptRowLedgerStatus::Current.as_str()
        {
            return Ok(None);
        }
        let metadata_scope = persisted_scope.unwrap_or_else(|| scope.clone());
        Self::metadata_from_models(header, scope_model, metadata_scope).map(Some)
    }

    async fn load_rows_from(
        db: &DbConn,
        session_id: &str,
        scope: &TranscriptScope,
        start_index: i64,
        limit: u64,
    ) -> Result<Vec<SerializedTranscriptRowLedgerRow>> {
        session_transcript_row::Entity::find()
            .filter(session_transcript_row::Column::SessionId.eq(session_id))
            .filter(session_transcript_row::Column::ScopeKey.eq(scope.ledger_key()))
            .filter(session_transcript_row::Column::RowIndex.gte(start_index))
            .order_by_asc(session_transcript_row::Column::RowIndex)
            .limit(limit)
            .all(db)
            .await?
            .into_iter()
            .map(Self::row_from_model)
            .collect()
    }

    async fn insert_rows(
        db: &impl sea_orm::ConnectionTrait,
        rows: Vec<SerializedTranscriptRowLedgerRow>,
        now: DateTime<Utc>,
    ) -> Result<()> {
        let mut active_rows = Vec::with_capacity(LEDGER_ROW_INSERT_CHUNK_SIZE);
        for row in rows {
            active_rows.push(session_transcript_row::ActiveModel {
                session_id: Set(row.session_id),
                scope_key: Set(row.scope.ledger_key()),
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
                    .exec(db)
                    .await?;
                active_rows = Vec::with_capacity(LEDGER_ROW_INSERT_CHUNK_SIZE);
            }
        }
        if !active_rows.is_empty() {
            session_transcript_row::Entity::insert_many(active_rows)
                .exec(db)
                .await?;
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    async fn write_session_header(
        db: &impl sea_orm::ConnectionTrait,
        session_id: &str,
        projection_version: &str,
        transcript_revision: i64,
        graph_revision: i64,
        last_event_seq: i64,
        open_header_json: Option<String>,
        status: SessionTranscriptRowLedgerStatus,
        now: DateTime<Utc>,
    ) -> Result<()> {
        let existing = session_transcript_row_ledger::Entity::find_by_id(session_id.to_string())
            .one(db)
            .await?;
        if let Some(existing) = existing {
            let mut active: session_transcript_row_ledger::ActiveModel = existing.into();
            active.transcript_revision = Set(transcript_revision);
            active.graph_revision = Set(graph_revision);
            active.last_event_seq = Set(last_event_seq);
            active.projection_version = Set(projection_version.to_string());
            active.open_header_json = Set(open_header_json);
            active.rebuild_status = Set(status.as_str().to_string());
            active.updated_at = Set(now);
            active.update(db).await?;
        } else {
            session_transcript_row_ledger::Entity::insert(
                session_transcript_row_ledger::ActiveModel {
                    session_id: Set(session_id.to_string()),
                    transcript_revision: Set(transcript_revision),
                    graph_revision: Set(graph_revision),
                    last_event_seq: Set(last_event_seq),
                    projection_version: Set(projection_version.to_string()),
                    open_header_json: Set(open_header_json),
                    rebuild_status: Set(status.as_str().to_string()),
                    updated_at: Set(now),
                },
            )
            .exec(db)
            .await?;
        }
        Ok(())
    }

    fn metadata_from_models(
        header: session_transcript_row_ledger::Model,
        scope_model: Option<session_transcript_row_scope::Model>,
        scope: TranscriptScope,
    ) -> Result<SessionTranscriptRowLedgerMetadata> {
        let rebuild_status = SessionTranscriptRowLedgerStatus::from_persisted(
            &header.rebuild_status,
        )
        .ok_or_else(|| {
            anyhow!(
                "unknown transcript row ledger status: {}",
                header.rebuild_status
            )
        })?;
        Ok(SessionTranscriptRowLedgerMetadata {
            session_id: header.session_id,
            scope,
            row_count: scope_model.as_ref().map_or(0, |model| model.row_count),
            transcript_revision: header.transcript_revision,
            graph_revision: header.graph_revision,
            last_event_seq: header.last_event_seq,
            projection_version: header.projection_version,
            open_header_json: header.open_header_json,
            rebuild_status,
            updated_at_ms: header.updated_at.timestamp_millis().max(0),
        })
    }

    fn row_from_model(
        model: session_transcript_row::Model,
    ) -> Result<SerializedTranscriptRowLedgerRow> {
        let scope = Self::parse_persisted_scope_key(&model.scope_key)?;
        Ok(SerializedTranscriptRowLedgerRow {
            scope,
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
        })
    }

    fn parse_persisted_scope_key(scope_key: &str) -> Result<TranscriptScope> {
        TranscriptScope::from_ledger_key(scope_key)
            .ok_or_else(|| anyhow!("invalid persisted transcript row scope key: {scope_key}"))
    }

    fn validate_scope(scope: &TranscriptScope) -> Result<()> {
        let scope_key = scope.ledger_key();
        if TranscriptScope::from_ledger_key(&scope_key).as_ref() != Some(scope) {
            return Err(anyhow!("invalid transcript row scope key: {scope_key}"));
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn validate_row(
        session_id: &str,
        projection_version: &str,
        transcript_revision: i64,
        graph_revision: i64,
        scope: &TranscriptScope,
        row_index: i64,
        row: &SerializedTranscriptRowLedgerRow,
    ) -> Result<()> {
        if row.session_id != session_id || &row.scope != scope || row.row_index != row_index {
            return Err(anyhow!(
                "transcript row ledger row identity does not match its scope"
            ));
        }
        if row.projection_version != projection_version
            || row.transcript_revision != transcript_revision
            || row.graph_revision != graph_revision
        {
            return Err(anyhow!(
                "transcript row ledger row revision does not match its ledger"
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
