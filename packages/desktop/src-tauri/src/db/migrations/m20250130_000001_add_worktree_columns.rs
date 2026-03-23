//! Migration to add worktree columns to session_metadata table.
//!
//! Adds columns for tracking git worktree associations:
//! - worktree_path: Full path to the worktree directory
//! - worktree_branch: Git branch name (e.g., "acepe/clever-falcon")
//! - worktree_name: Short name (e.g., "clever-falcon")

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Add worktree_path column (nullable - not all sessions use worktrees)
        manager
            .alter_table(
                Table::alter()
                    .table(SessionMetadata::Table)
                    .add_column(
                        ColumnDef::new(SessionMetadata::WorktreePath)
                            .string()
                            .null(),
                    )
                    .to_owned(),
            )
            .await?;

        // Add worktree_branch column
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

        // Add worktree_name column
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

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        // SQLite doesn't support DROP COLUMN, so we need to recreate the table
        // For simplicity, we'll just leave the columns in place during rollback
        // This is acceptable for development purposes
        Ok(())
    }
}

#[derive(DeriveIden)]
enum SessionMetadata {
    Table,
    WorktreePath,
    WorktreeBranch,
    WorktreeName,
}
