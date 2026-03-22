//! Migration to create the session_metadata table.
//!
//! This table stores pre-extracted metadata from JSONL session files,
//! enabling fast O(1) lookups instead of O(files * lines) file scanning.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Create the session_metadata table
        manager
            .create_table(
                Table::create()
                    .table(SessionMetadata::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(SessionMetadata::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(SessionMetadata::Display).string().not_null())
                    .col(
                        ColumnDef::new(SessionMetadata::Timestamp)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SessionMetadata::ProjectPath)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SessionMetadata::AgentId)
                            .string()
                            .not_null()
                            .default("claude-code"),
                    )
                    .col(
                        ColumnDef::new(SessionMetadata::FilePath)
                            .string()
                            .not_null()
                            .unique_key(),
                    )
                    .col(
                        ColumnDef::new(SessionMetadata::FileMtime)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SessionMetadata::FileSize)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SessionMetadata::CreatedAt)
                            .date_time()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SessionMetadata::UpdatedAt)
                            .date_time()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;

        // Create index on timestamp for fast ordering (most recent first)
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_session_metadata_timestamp")
                    .table(SessionMetadata::Table)
                    .col(SessionMetadata::Timestamp)
                    .to_owned(),
            )
            .await?;

        // Create index on project_path for filtering by project
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_session_metadata_project_path")
                    .table(SessionMetadata::Table)
                    .col(SessionMetadata::ProjectPath)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(SessionMetadata::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum SessionMetadata {
    Table,
    Id,
    Display,
    Timestamp,
    ProjectPath,
    AgentId,
    FilePath,
    FileMtime,
    FileSize,
    CreatedAt,
    UpdatedAt,
}
