//! Session journal-event repository.
//! Extracted verbatim from the former db/repository.rs monolith.

use crate::{
    acp::session_journal::{
        ProjectionJournalUpdate, SessionJournalEvent as SessionJournalRecord,
        SessionJournalEventPayload,
    },
    db::entities::session_journal_event,
};
use anyhow::Result;
use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DbConn, EntityTrait, QueryFilter, QueryOrder, QuerySelect,
    Set, TransactionTrait,
};

// ============================================================================
// Session Journal Event Repository
// ============================================================================

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SerializedSessionJournalEventRow {
    pub event_id: String,
    pub session_id: String,
    pub event_seq: i64,
    pub event_kind: String,
    pub event_json: String,
    pub created_at_ms: i64,
}

pub struct SessionJournalEventRepository;

impl SessionJournalEventRepository {
    pub async fn list_serialized(
        db: &DbConn,
        session_id: &str,
    ) -> Result<Vec<SerializedSessionJournalEventRow>> {
        tracing::debug!(session_id = %session_id, "Loading serialized session journal events");

        let rows = crate::db::entities::session_journal_event::Entity::find()
            .filter(session_journal_event::Column::SessionId.eq(session_id))
            .order_by_asc(session_journal_event::Column::EventSeq)
            .all(db)
            .await?
            .into_iter()
            .map(|row| SerializedSessionJournalEventRow {
                event_id: row.event_id,
                session_id: row.session_id,
                event_seq: row.event_seq,
                event_kind: row.event_kind,
                event_json: row.event_json,
                created_at_ms: row.created_at.timestamp_millis().max(0),
            })
            .collect::<Vec<_>>();

        Ok(rows)
    }

    pub async fn append_session_update(
        db: &DbConn,
        session_id: &str,
        update: &crate::acp::session_update::SessionUpdate,
    ) -> Result<Option<SessionJournalRecord>> {
        let Some(update) = ProjectionJournalUpdate::from_session_update(update) else {
            return Ok(None);
        };

        Self::append(
            db,
            session_id,
            SessionJournalEventPayload::ProjectionUpdate {
                update: Box::new(update),
            },
        )
        .await
        .map(Some)
    }

    pub async fn append_interaction_transition(
        db: &DbConn,
        session_id: &str,
        interaction_id: &str,
        state: crate::acp::projections::InteractionState,
        response: crate::acp::projections::InteractionResponse,
    ) -> Result<SessionJournalRecord> {
        Self::append(
            db,
            session_id,
            SessionJournalEventPayload::InteractionTransition {
                interaction_id: interaction_id.to_string(),
                state,
                response,
            },
        )
        .await
    }

    pub async fn append_interaction_snapshot(
        db: &DbConn,
        session_id: &str,
        interaction: crate::acp::projections::InteractionSnapshot,
    ) -> Result<SessionJournalRecord> {
        Self::append(
            db,
            session_id,
            SessionJournalEventPayload::InteractionSnapshot { interaction },
        )
        .await
    }

    pub async fn append_materialization_barrier(
        db: &DbConn,
        session_id: &str,
    ) -> Result<SessionJournalRecord> {
        Self::append(
            db,
            session_id,
            SessionJournalEventPayload::MaterializationBarrier,
        )
        .await
    }

    async fn append(
        db: &DbConn,
        session_id: &str,
        payload: SessionJournalEventPayload,
    ) -> Result<SessionJournalRecord> {
        tracing::debug!(session_id = %session_id, "Appending session journal event");

        let tx = db.begin().await?;
        let max_seq: Option<i64> = crate::db::entities::session_journal_event::Entity::find()
            .select_only()
            .column_as(session_journal_event::Column::EventSeq.max(), "max_seq")
            .filter(session_journal_event::Column::SessionId.eq(session_id))
            .into_tuple::<Option<i64>>()
            .one(&tx)
            .await?
            .flatten();
        let event =
            SessionJournalRecord::new(session_id, max_seq.map_or(1, |seq| seq + 1), payload);
        let active = crate::db::entities::session_journal_event::ActiveModel {
            event_id: Set(event.event_id.clone()),
            session_id: Set(event.session_id.clone()),
            event_seq: Set(event.event_seq),
            event_kind: Set(event.event_kind().to_string()),
            event_json: Set(serde_json::to_string(&event.payload)?),
            created_at: Set(Utc::now()),
        };
        crate::db::entities::session_journal_event::Entity::insert(active)
            .exec(&tx)
            .await?;
        tx.commit().await?;

        Ok(event)
    }

    /// Return the maximum `event_seq` persisted for `session_id`, or `None`
    /// when no events exist yet (i.e. `last_event_seq = 0` for a fresh
    /// session).
    pub async fn max_event_seq(db: &DbConn, session_id: &str) -> Result<Option<i64>> {
        let max_seq: Option<i64> = crate::db::entities::session_journal_event::Entity::find()
            .select_only()
            .column_as(session_journal_event::Column::EventSeq.max(), "max_seq")
            .filter(session_journal_event::Column::SessionId.eq(session_id))
            .into_tuple::<Option<i64>>()
            .one(db)
            .await?
            .flatten();
        Ok(max_seq)
    }
}

// ============================================================================
// Session Metadata Repository
// ============================================================================

