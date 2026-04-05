//! Migration to add sequence_id column to session_metadata table
//! and backfill existing native sessions with sequential IDs per project.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
	async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
		// Step 1: Add nullable integer column
		manager
			.alter_table(
				Table::alter()
					.table(SessionMetadata::Table)
					.add_column(
						ColumnDef::new(SessionMetadata::SequenceId)
							.integer()
                            .null(),
                    )
                    .to_owned(),
            )
            .await?;

		// Step 2: Backfill native sessions (file_mtime = 0 AND file_size = 0)
		// with sequential IDs per project, ordered by created_at.
		// Uses a correlated subquery to compute row numbers since SQLite
		// doesn't support UPDATE ... FROM with window functions directly.
		let db = manager.get_connection();
		db.execute_unprepared(
			"UPDATE session_metadata SET sequence_id = (
				SELECT COUNT(*)
				FROM session_metadata AS s2
				WHERE s2.project_path = session_metadata.project_path
				  AND s2.file_mtime = 0
				  AND s2.file_size = 0
				  AND (s2.created_at < session_metadata.created_at
				       OR (s2.created_at = session_metadata.created_at AND s2.id <= session_metadata.id))
			)
			WHERE file_mtime = 0 AND file_size = 0",
		)
		.await?;

		Ok(())
	}

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        // SQLite doesn't support DROP COLUMN — leave in place
        Ok(())
    }
}

#[derive(DeriveIden)]
enum SessionMetadata {
	Table,
	SequenceId,
}
