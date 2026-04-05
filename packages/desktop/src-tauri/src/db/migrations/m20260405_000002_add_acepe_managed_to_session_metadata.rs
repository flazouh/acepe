//! Migration to track which sessions are managed by Acepe.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
	async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
		manager
			.alter_table(
				Table::alter()
					.table(SessionMetadata::Table)
					.add_column(
						ColumnDef::new(SessionMetadata::IsAcepeManaged)
							.integer()
							.not_null()
							.default(0),
					)
					.to_owned(),
			)
			.await?;

		let db = manager.get_connection();
		db.execute_unprepared(
			"UPDATE session_metadata
			 SET is_acepe_managed = 1
			 WHERE file_path LIKE '__session_registry__/%'
			   AND file_path NOT LIKE '__session_registry__/%/%'
			    OR file_path LIKE '__worktree__/%'",
		)
		.await?;

		db.execute_unprepared(
			"UPDATE session_metadata
			 SET sequence_id = NULL
			 WHERE is_acepe_managed = 0",
		)
		.await?;

		manager
			.create_index(
				Index::create()
					.name("idx_session_metadata_project_sequence_managed")
					.table(SessionMetadata::Table)
					.col(SessionMetadata::ProjectPath)
					.col(SessionMetadata::SequenceId)
					.unique()
					.to_owned(),
			)
			.await?;

		Ok(())
	}

	async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
		Ok(())
	}
}

#[derive(DeriveIden)]
enum SessionMetadata {
	Table,
	ProjectPath,
	SequenceId,
	IsAcepeManaged,
}
