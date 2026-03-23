//! Drop worktree_branch and worktree_name columns from session_metadata.
//!
//! These columns were added in m20250130_000001_add_worktree_columns but were
//! never populated (always NULL). The frontend derives worktree name/branch
//! from live git state, not the database.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // SQLite 3.35+ supports DROP COLUMN when the column is not referenced
        // by indexes, triggers, or foreign keys — which these nullable columns are not.
        manager
            .alter_table(
                Table::alter()
                    .table(SessionMetadata::Table)
                    .drop_column(SessionMetadata::WorktreeBranch)
                    .to_owned(),
            )
            .await?;

        manager
            .alter_table(
                Table::alter()
                    .table(SessionMetadata::Table)
                    .drop_column(SessionMetadata::WorktreeName)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(SessionMetadata::Table)
                    .add_column(
                        ColumnDef::new(SessionMetadata::WorktreeBranch)
                            .string()
                            .null(),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .alter_table(
                Table::alter()
                    .table(SessionMetadata::Table)
                    .add_column(
                        ColumnDef::new(SessionMetadata::WorktreeName)
                            .string()
                            .null(),
                    )
                    .to_owned(),
            )
            .await?;

        Ok(())
    }
}

#[derive(DeriveIden)]
enum SessionMetadata {
    Table,
    WorktreeBranch,
    WorktreeName,
}
