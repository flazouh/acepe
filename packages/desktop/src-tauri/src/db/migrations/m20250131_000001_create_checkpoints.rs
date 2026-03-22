//! Migration to create checkpoint tables for file versioning.
//!
//! This migration creates tables for the checkpoint system:
//! - checkpoints: Point-in-time snapshots of modified files in a session
//! - file_snapshots: Full file content stored at each checkpoint

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Create checkpoints table
        manager
            .create_table(
                Table::create()
                    .table(Checkpoints::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(Checkpoints::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(Checkpoints::SessionId).string().not_null())
                    .col(
                        ColumnDef::new(Checkpoints::CheckpointNumber)
                            .integer()
                            .not_null(),
                    )
                    .col(ColumnDef::new(Checkpoints::Name).string())
                    .col(
                        ColumnDef::new(Checkpoints::CreatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .col(ColumnDef::new(Checkpoints::ToolCallId).string())
                    .col(
                        ColumnDef::new(Checkpoints::IsAuto)
                            .integer()
                            .not_null()
                            .default(1),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_checkpoints_session_id")
                            .from(Checkpoints::Table, Checkpoints::SessionId)
                            .to(SessionMetadata::Table, SessionMetadata::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        // Create indexes on checkpoints table
        manager
            .create_index(
                Index::create()
                    .name("idx_checkpoints_session")
                    .table(Checkpoints::Table)
                    .col(Checkpoints::SessionId)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_checkpoints_session_number")
                    .table(Checkpoints::Table)
                    .col(Checkpoints::SessionId)
                    .col(Checkpoints::CheckpointNumber)
                    .to_owned(),
            )
            .await?;

        // Create file_snapshots table
        manager
            .create_table(
                Table::create()
                    .table(FileSnapshots::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(FileSnapshots::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(FileSnapshots::CheckpointId)
                            .string()
                            .not_null(),
                    )
                    .col(ColumnDef::new(FileSnapshots::FilePath).string().not_null())
                    .col(
                        ColumnDef::new(FileSnapshots::ContentHash)
                            .string()
                            .not_null(),
                    )
                    .col(ColumnDef::new(FileSnapshots::Content).text().not_null())
                    .col(
                        ColumnDef::new(FileSnapshots::FileSize)
                            .big_integer()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_file_snapshots_checkpoint_id")
                            .from(FileSnapshots::Table, FileSnapshots::CheckpointId)
                            .to(Checkpoints::Table, Checkpoints::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        // Create indexes on file_snapshots table
        manager
            .create_index(
                Index::create()
                    .name("idx_snapshots_checkpoint")
                    .table(FileSnapshots::Table)
                    .col(FileSnapshots::CheckpointId)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_snapshots_hash")
                    .table(FileSnapshots::Table)
                    .col(FileSnapshots::ContentHash)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_snapshots_checkpoint_path")
                    .table(FileSnapshots::Table)
                    .col(FileSnapshots::CheckpointId)
                    .col(FileSnapshots::FilePath)
                    .unique()
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(FileSnapshots::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(Checkpoints::Table).to_owned())
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum Checkpoints {
    Table,
    Id,
    SessionId,
    CheckpointNumber,
    Name,
    CreatedAt,
    ToolCallId,
    IsAuto,
}

#[derive(DeriveIden)]
enum FileSnapshots {
    Table,
    Id,
    CheckpointId,
    FilePath,
    ContentHash,
    Content,
    FileSize,
}

/// Reference to session_metadata table for foreign key
#[derive(DeriveIden)]
enum SessionMetadata {
    Table,
    Id,
}
