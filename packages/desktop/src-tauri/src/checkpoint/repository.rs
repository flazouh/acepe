//! Database repository for checkpoint operations.

use crate::db::entities::{checkpoint, file_snapshot};
use anyhow::Result;
use sea_orm::{
    ColumnTrait, DbConn, EntityTrait, QueryFilter, QueryOrder, QuerySelect, Set, TransactionTrait,
};
use std::collections::HashMap;
use uuid::Uuid;

use super::types::{Checkpoint, FileSnapshot};

/// Maximum number of retry attempts for checkpoint creation when hitting unique constraint.
const MAX_CHECKPOINT_RETRIES: u32 = 3;

/// File snapshot data for checkpoint creation.
/// (file_path, content_hash, content, file_size, lines_added, lines_removed)
pub type FileSnapshotData = (String, String, String, i64, Option<i32>, Option<i32>);

/// Aggregated line stats for a checkpoint.
#[derive(Debug, Default, Clone)]
struct LineStats {
    total_added: Option<i32>,
    total_removed: Option<i32>,
}

/// Repository for checkpoint database operations.
pub struct CheckpointRepository;

impl CheckpointRepository {
    /// Create a new checkpoint with file snapshots.
    ///
    /// Returns the created checkpoint with file_count populated.
    ///
    /// This method handles race conditions where concurrent checkpoint creation
    /// might result in duplicate checkpoint numbers. If a unique constraint
    /// violation occurs, it retries with the next available number.
    #[allow(clippy::too_many_arguments)]
    pub async fn create(
        db: &DbConn,
        session_id: &str,
        checkpoint_number: i32,
        name: Option<&str>,
        created_at: i64,
        tool_call_id: Option<&str>,
        is_auto: bool,
        file_snapshots: Vec<FileSnapshotData>,
    ) -> Result<Checkpoint> {
        let mut current_number = checkpoint_number;

        for attempt in 0..MAX_CHECKPOINT_RETRIES {
            tracing::debug!(
                session_id = %session_id,
                checkpoint_number = current_number,
                file_count = file_snapshots.len(),
                attempt = attempt,
                "Creating checkpoint"
            );

            match Self::try_create_checkpoint(
                db,
                session_id,
                current_number,
                name,
                created_at,
                tool_call_id,
                is_auto,
                &file_snapshots,
            )
            .await
            {
                Ok(checkpoint) => return Ok(checkpoint),
                Err(e) => {
                    // Check if this is a unique constraint violation
                    if Self::is_unique_constraint_error(&e) {
                        tracing::warn!(
                            session_id = %session_id,
                            checkpoint_number = current_number,
                            attempt = attempt,
                            "Checkpoint number conflict, retrying with next number"
                        );
                        // Get the next available number and retry
                        current_number = Self::get_next_checkpoint_number(db, session_id).await?;
                        continue;
                    }
                    return Err(e);
                }
            }
        }

        Err(anyhow::anyhow!(
            "Failed to create checkpoint after {} retries due to concurrent conflicts",
            MAX_CHECKPOINT_RETRIES
        ))
    }

    /// Check if an error is a unique constraint violation.
    fn is_unique_constraint_error(error: &anyhow::Error) -> bool {
        let error_str = error.to_string().to_lowercase();
        error_str.contains("unique constraint")
            || error_str.contains("unique index")
            || error_str.contains("duplicate")
            || error_str.contains("already exists")
    }

    /// Try to create a checkpoint, returning an error if it fails.
    #[allow(clippy::too_many_arguments)]
    async fn try_create_checkpoint(
        db: &DbConn,
        session_id: &str,
        checkpoint_number: i32,
        name: Option<&str>,
        created_at: i64,
        tool_call_id: Option<&str>,
        is_auto: bool,
        file_snapshots: &[FileSnapshotData],
    ) -> Result<Checkpoint> {
        let txn = db.begin().await?;

        let checkpoint_id = Uuid::new_v4().to_string();

        // Create checkpoint record
        let checkpoint_model = checkpoint::ActiveModel {
            id: Set(checkpoint_id.clone()),
            session_id: Set(session_id.to_string()),
            checkpoint_number: Set(checkpoint_number),
            name: Set(name.map(|s| s.to_string())),
            created_at: Set(created_at),
            tool_call_id: Set(tool_call_id.map(|s| s.to_string())),
            is_auto: Set(if is_auto { 1 } else { 0 }),
        };

        Checkpoint_entity::insert(checkpoint_model)
            .exec(&txn)
            .await
            .map_err(|e| anyhow::anyhow!("{}", e))?;

        // Create file snapshot records using batch insert for performance
        let file_count = file_snapshots.len() as i32;
        if !file_snapshots.is_empty() {
            let snapshot_models: Vec<file_snapshot::ActiveModel> = file_snapshots
                .iter()
                .map(
                    |(file_path, content_hash, content, file_size, lines_added, lines_removed)| {
                        file_snapshot::ActiveModel {
                            id: Set(Uuid::new_v4().to_string()),
                            checkpoint_id: Set(checkpoint_id.clone()),
                            file_path: Set(file_path.clone()),
                            content_hash: Set(content_hash.clone()),
                            content: Set(content.clone()),
                            file_size: Set(*file_size),
                            lines_added: Set(*lines_added),
                            lines_removed: Set(*lines_removed),
                        }
                    },
                )
                .collect();

            FileSnapshot_entity::insert_many(snapshot_models)
                .exec(&txn)
                .await
                .map_err(|e| anyhow::anyhow!("{}", e))?;
        }

        txn.commit().await?;

        // Compute total line stats from file snapshots
        let (total_added, total_removed) = Self::compute_line_totals(file_snapshots);

        tracing::info!(
            checkpoint_id = %checkpoint_id,
            session_id = %session_id,
            checkpoint_number = checkpoint_number,
            file_count = file_count,
            "Checkpoint created"
        );

        Ok(Checkpoint {
            id: checkpoint_id,
            session_id: session_id.to_string(),
            checkpoint_number,
            name: name.map(|s| s.to_string()),
            created_at,
            tool_call_id: tool_call_id.map(|s| s.to_string()),
            is_auto,
            file_count,
            total_lines_added: total_added,
            total_lines_removed: total_removed,
        })
    }

    /// Compute total line stats from file snapshot data.
    fn compute_line_totals(file_snapshots: &[FileSnapshotData]) -> (Option<i32>, Option<i32>) {
        let mut total_added: Option<i32> = None;
        let mut total_removed: Option<i32> = None;

        for (_, _, _, _, lines_added, lines_removed) in file_snapshots {
            if let Some(added) = lines_added {
                total_added = Some(total_added.unwrap_or(0) + added);
            }
            if let Some(removed) = lines_removed {
                total_removed = Some(total_removed.unwrap_or(0) + removed);
            }
        }

        (total_added, total_removed)
    }

    /// Get all checkpoints for a session, ordered by checkpoint_number DESC.
    ///
    /// Uses batch queries to avoid N+1 performance issue for file counts and line stats.
    pub async fn list_for_session(db: &DbConn, session_id: &str) -> Result<Vec<Checkpoint>> {
        tracing::debug!(session_id = %session_id, "Listing checkpoints for session");

        let models = Checkpoint_entity::find()
            .filter(checkpoint::Column::SessionId.eq(session_id))
            .order_by_desc(checkpoint::Column::CheckpointNumber)
            .all(db)
            .await?;

        if models.is_empty() {
            return Ok(vec![]);
        }

        // Get all checkpoint IDs
        let checkpoint_ids: Vec<String> = models.iter().map(|m| m.id.clone()).collect();

        // Batch fetch file counts and line stats in a single query using GROUP BY
        // Returns: (checkpoint_id, count, sum_lines_added, sum_lines_removed)
        let stats_results: Vec<(String, i64, Option<i64>, Option<i64>)> =
            FileSnapshot_entity::find()
                .filter(file_snapshot::Column::CheckpointId.is_in(&checkpoint_ids))
                .select_only()
                .column(file_snapshot::Column::CheckpointId)
                .column_as(file_snapshot::Column::Id.count(), "count")
                .column_as(file_snapshot::Column::LinesAdded.sum(), "sum_added")
                .column_as(file_snapshot::Column::LinesRemoved.sum(), "sum_removed")
                .group_by(file_snapshot::Column::CheckpointId)
                .into_tuple()
                .all(db)
                .await?;

        // Build a map of checkpoint_id -> (file_count, line_stats)
        let stats_map: HashMap<String, (i32, LineStats)> = stats_results
            .into_iter()
            .map(|(id, count, sum_added, sum_removed)| {
                let line_stats = LineStats {
                    total_added: sum_added.map(|v| v as i32),
                    total_removed: sum_removed.map(|v| v as i32),
                };
                (id, (count as i32, line_stats))
            })
            .collect();

        // Map models to checkpoints with file counts and line stats
        let result: Vec<Checkpoint> = models
            .into_iter()
            .map(|model| {
                let (file_count, line_stats) = stats_map
                    .get(&model.id)
                    .cloned()
                    .unwrap_or((0, LineStats::default()));
                Self::model_to_checkpoint(model, file_count, line_stats)
            })
            .collect();

        tracing::debug!(
            session_id = %session_id,
            count = result.len(),
            "Listed checkpoints"
        );

        Ok(result)
    }

    /// Get a checkpoint by ID.
    pub async fn get_by_id(db: &DbConn, checkpoint_id: &str) -> Result<Option<Checkpoint>> {
        tracing::debug!(checkpoint_id = %checkpoint_id, "Getting checkpoint by ID");

        let model = Checkpoint_entity::find_by_id(checkpoint_id).one(db).await?;

        match model {
            Some(m) => {
                let (file_count, line_stats) =
                    Self::get_checkpoint_stats(db, checkpoint_id).await?;
                Ok(Some(Self::model_to_checkpoint(m, file_count, line_stats)))
            }
            None => Ok(None),
        }
    }

    /// Helper to get file count and line stats for a single checkpoint.
    async fn get_checkpoint_stats(db: &DbConn, checkpoint_id: &str) -> Result<(i32, LineStats)> {
        let stats: Option<(i64, Option<i64>, Option<i64>)> = FileSnapshot_entity::find()
            .filter(file_snapshot::Column::CheckpointId.eq(checkpoint_id))
            .select_only()
            .column_as(file_snapshot::Column::Id.count(), "count")
            .column_as(file_snapshot::Column::LinesAdded.sum(), "sum_added")
            .column_as(file_snapshot::Column::LinesRemoved.sum(), "sum_removed")
            .into_tuple()
            .one(db)
            .await?;

        match stats {
            Some((count, sum_added, sum_removed)) => Ok((
                count as i32,
                LineStats {
                    total_added: sum_added.map(|v| v as i32),
                    total_removed: sum_removed.map(|v| v as i32),
                },
            )),
            None => Ok((0, LineStats::default())),
        }
    }

    /// Get the latest checkpoint for a session.
    pub async fn get_latest_for_session(
        db: &DbConn,
        session_id: &str,
    ) -> Result<Option<Checkpoint>> {
        tracing::debug!(session_id = %session_id, "Getting latest checkpoint");

        let model = Checkpoint_entity::find()
            .filter(checkpoint::Column::SessionId.eq(session_id))
            .order_by_desc(checkpoint::Column::CheckpointNumber)
            .one(db)
            .await?;

        match model {
            Some(m) => {
                let (file_count, line_stats) = Self::get_checkpoint_stats(db, &m.id).await?;
                Ok(Some(Self::model_to_checkpoint(m, file_count, line_stats)))
            }
            None => Ok(None),
        }
    }

    /// Get the next checkpoint number for a session.
    pub async fn get_next_checkpoint_number(db: &DbConn, session_id: &str) -> Result<i32> {
        let latest = Self::get_latest_for_session(db, session_id).await?;
        Ok(latest.map(|c| c.checkpoint_number + 1).unwrap_or(1))
    }

    /// Get file snapshots for a checkpoint.
    pub async fn get_file_snapshots(db: &DbConn, checkpoint_id: &str) -> Result<Vec<FileSnapshot>> {
        tracing::debug!(checkpoint_id = %checkpoint_id, "Getting file snapshots");

        let models = FileSnapshot_entity::find()
            .filter(file_snapshot::Column::CheckpointId.eq(checkpoint_id))
            .all(db)
            .await?;

        Ok(models
            .into_iter()
            .map(Self::model_to_file_snapshot)
            .collect())
    }

    /// Get a specific file's content from a checkpoint.
    pub async fn get_file_content(
        db: &DbConn,
        checkpoint_id: &str,
        file_path: &str,
    ) -> Result<Option<String>> {
        tracing::debug!(
            checkpoint_id = %checkpoint_id,
            file_path = %file_path,
            "Getting file content from checkpoint"
        );

        let model = FileSnapshot_entity::find()
            .filter(file_snapshot::Column::CheckpointId.eq(checkpoint_id))
            .filter(file_snapshot::Column::FilePath.eq(file_path))
            .one(db)
            .await?;

        Ok(model.map(|m| m.content))
    }

    /// Get the first (initial) checkpoint for a session.
    pub async fn get_first_for_session(
        db: &DbConn,
        session_id: &str,
    ) -> Result<Option<Checkpoint>> {
        tracing::debug!(session_id = %session_id, "Getting first checkpoint");

        let model = Checkpoint_entity::find()
            .filter(checkpoint::Column::SessionId.eq(session_id))
            .order_by_asc(checkpoint::Column::CheckpointNumber)
            .one(db)
            .await?;

        match model {
            Some(m) => {
                let (file_count, line_stats) = Self::get_checkpoint_stats(db, &m.id).await?;
                Ok(Some(Self::model_to_checkpoint(m, file_count, line_stats)))
            }
            None => Ok(None),
        }
    }

    /// Delete all checkpoints for a session.
    pub async fn delete_for_session(db: &DbConn, session_id: &str) -> Result<()> {
        tracing::debug!(session_id = %session_id, "Deleting checkpoints for session");

        // Get all checkpoint IDs first
        let checkpoints = Checkpoint_entity::find()
            .filter(checkpoint::Column::SessionId.eq(session_id))
            .select_only()
            .column(checkpoint::Column::Id)
            .into_tuple::<String>()
            .all(db)
            .await?;

        let txn = db.begin().await?;

        // Delete file snapshots for all checkpoints
        for checkpoint_id in &checkpoints {
            FileSnapshot_entity::delete_many()
                .filter(file_snapshot::Column::CheckpointId.eq(checkpoint_id))
                .exec(&txn)
                .await?;
        }

        // Delete checkpoints
        Checkpoint_entity::delete_many()
            .filter(checkpoint::Column::SessionId.eq(session_id))
            .exec(&txn)
            .await?;

        txn.commit().await?;

        tracing::info!(
            session_id = %session_id,
            deleted_count = checkpoints.len(),
            "Deleted checkpoints for session"
        );

        Ok(())
    }

    fn model_to_checkpoint(
        model: checkpoint::Model,
        file_count: i32,
        line_stats: LineStats,
    ) -> Checkpoint {
        Checkpoint {
            id: model.id,
            session_id: model.session_id,
            checkpoint_number: model.checkpoint_number,
            name: model.name,
            created_at: model.created_at,
            tool_call_id: model.tool_call_id,
            is_auto: model.is_auto != 0,
            file_count,
            total_lines_added: line_stats.total_added,
            total_lines_removed: line_stats.total_removed,
        }
    }

    fn model_to_file_snapshot(model: file_snapshot::Model) -> FileSnapshot {
        FileSnapshot {
            id: model.id,
            checkpoint_id: model.checkpoint_id,
            file_path: model.file_path,
            content_hash: model.content_hash,
            file_size: model.file_size,
            lines_added: model.lines_added,
            lines_removed: model.lines_removed,
        }
    }

    /// Get the content of a file from the most recent previous checkpoint.
    /// Returns None if no previous checkpoint exists for this file.
    pub async fn get_previous_file_content(
        db: &DbConn,
        session_id: &str,
        file_path: &str,
        before_checkpoint_number: i32,
    ) -> Result<Option<String>> {
        // Find the most recent checkpoint before the given number that has this file
        let result = Checkpoint_entity::find()
            .filter(checkpoint::Column::SessionId.eq(session_id))
            .filter(checkpoint::Column::CheckpointNumber.lt(before_checkpoint_number))
            .order_by_desc(checkpoint::Column::CheckpointNumber)
            .all(db)
            .await?;

        // Search through checkpoints from newest to oldest to find the file
        for cp in result {
            let snapshot = FileSnapshot_entity::find()
                .filter(file_snapshot::Column::CheckpointId.eq(&cp.id))
                .filter(file_snapshot::Column::FilePath.eq(file_path))
                .one(db)
                .await?;

            if let Some(s) = snapshot {
                return Ok(Some(s.content));
            }
        }

        Ok(None)
    }

    /// Get the content of multiple files from their most recent previous checkpoints.
    /// Returns a HashMap mapping file paths to their previous content.
    /// Files without previous content are not included in the result.
    ///
    /// This is a batched version of `get_previous_file_content` that reduces
    /// N+1 queries to 2 queries for better performance.
    pub async fn get_previous_file_contents_batch(
        db: &DbConn,
        session_id: &str,
        file_paths: &[String],
        before_checkpoint_number: i32,
    ) -> Result<HashMap<String, String>> {
        if file_paths.is_empty() {
            return Ok(HashMap::new());
        }

        // Get all previous checkpoints ordered by checkpoint number descending
        let checkpoints = Checkpoint_entity::find()
            .filter(checkpoint::Column::SessionId.eq(session_id))
            .filter(checkpoint::Column::CheckpointNumber.lt(before_checkpoint_number))
            .order_by_desc(checkpoint::Column::CheckpointNumber)
            .all(db)
            .await?;

        if checkpoints.is_empty() {
            return Ok(HashMap::new());
        }

        // Collect checkpoint IDs
        let checkpoint_ids: Vec<&str> = checkpoints.iter().map(|cp| cp.id.as_str()).collect();

        // Get all file snapshots for these checkpoints that match our file paths
        let snapshots = FileSnapshot_entity::find()
            .filter(file_snapshot::Column::CheckpointId.is_in(checkpoint_ids))
            .filter(file_snapshot::Column::FilePath.is_in(file_paths.to_vec()))
            .all(db)
            .await?;

        // Build a map of (checkpoint_id, file_path) -> content
        let mut snapshot_map: HashMap<(&str, &str), &str> = HashMap::new();
        for snapshot in &snapshots {
            snapshot_map.insert(
                (snapshot.checkpoint_id.as_str(), snapshot.file_path.as_str()),
                snapshot.content.as_str(),
            );
        }

        // For each file, find the most recent content by checking checkpoints in order
        let mut result: HashMap<String, String> = HashMap::new();
        for file_path in file_paths {
            for cp in &checkpoints {
                if let Some(content) = snapshot_map.get(&(cp.id.as_str(), file_path.as_str())) {
                    result.insert(file_path.clone(), (*content).to_string());
                    break; // Found the most recent, move to next file
                }
            }
        }

        Ok(result)
    }
}

// Use type aliases to avoid name collisions with our types
use crate::db::entities::checkpoint::Entity as Checkpoint_entity;
use crate::db::entities::file_snapshot::Entity as FileSnapshot_entity;

#[cfg(test)]
mod tests {
    // Tests will be run with an in-memory SQLite database
    // For now, just verify the module compiles
    #[test]
    fn test_revert_result_constructors() {
        let success = super::super::types::RevertResult::success(vec!["a.ts".to_string()]);
        assert!(success.success);
        assert_eq!(success.reverted_files.len(), 1);
        assert!(success.failed_files.is_empty());

        let failed =
            super::super::types::RevertResult::failed(vec![super::super::types::RevertError::new(
                "b.ts",
                "file not found",
            )]);
        assert!(!failed.success);
        assert!(failed.reverted_files.is_empty());
        assert_eq!(failed.failed_files.len(), 1);
    }
}
