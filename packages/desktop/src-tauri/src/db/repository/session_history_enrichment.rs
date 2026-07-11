use std::collections::HashMap;

use chrono::Utc;
use sea_orm::{ActiveModelTrait, ColumnTrait, DbConn, EntityTrait, QueryFilter, Set};

use crate::db::entities::session_history_enrichment;
use crate::session_jsonl::types::HistoryUsageStats;

pub const SESSION_HISTORY_ENRICHMENT_SCHEMA_VERSION: i32 = 1;

#[derive(Debug, Clone)]
pub struct SessionHistoryEnrichmentRecord {
    pub session_id: String,
    pub usage_stats: HistoryUsageStats,
    pub source_mtime: i64,
    pub source_size: i64,
}

pub struct SessionHistoryEnrichmentRepository;

impl SessionHistoryEnrichmentRepository {
    pub async fn upsert(
        db: &DbConn,
        record: SessionHistoryEnrichmentRecord,
    ) -> Result<(), sea_orm::DbErr> {
        let existing = session_history_enrichment::Entity::find_by_id(&record.session_id)
            .one(db)
            .await?;
        let active = session_history_enrichment::ActiveModel {
            session_id: Set(record.session_id),
            total_messages: Set(record.usage_stats.total_messages as i64),
            user_messages: Set(record.usage_stats.user_messages as i64),
            assistant_messages: Set(record.usage_stats.assistant_messages as i64),
            total_input_tokens: Set(record.usage_stats.total_input_tokens),
            total_output_tokens: Set(record.usage_stats.total_output_tokens),
            source_mtime: Set(record.source_mtime),
            source_size: Set(record.source_size),
            schema_version: Set(SESSION_HISTORY_ENRICHMENT_SCHEMA_VERSION),
            updated_at: Set(Utc::now()),
        };
        if existing.is_some() {
            active.update(db).await?;
        } else {
            active.insert(db).await?;
        }
        Ok(())
    }

    pub async fn get_usage_for_session_ids(
        db: &DbConn,
        session_ids: &[String],
    ) -> anyhow::Result<HashMap<String, HistoryUsageStats>> {
        if session_ids.is_empty() {
            return Ok(HashMap::new());
        }
        let rows = session_history_enrichment::Entity::find()
            .filter(session_history_enrichment::Column::SessionId.is_in(session_ids.to_vec()))
            .filter(
                session_history_enrichment::Column::SchemaVersion
                    .eq(SESSION_HISTORY_ENRICHMENT_SCHEMA_VERSION),
            )
            .all(db)
            .await?;
        let metadata =
            super::SessionMetadataRepository::get_for_session_ids(db, session_ids).await?;
        let fingerprints = metadata
            .into_iter()
            .map(|row| (row.id, (row.file_mtime, row.file_size)))
            .collect::<HashMap<_, _>>();
        let mut usage = HashMap::new();
        for row in rows {
            if fingerprints.get(&row.session_id) != Some(&(row.source_mtime, row.source_size)) {
                continue;
            }
            usage.insert(
                row.session_id,
                HistoryUsageStats {
                    total_messages: row.total_messages.max(0) as usize,
                    user_messages: row.user_messages.max(0) as usize,
                    assistant_messages: row.assistant_messages.max(0) as usize,
                    total_input_tokens: row.total_input_tokens,
                    total_output_tokens: row.total_output_tokens,
                },
            );
        }
        Ok(usage)
    }
}
