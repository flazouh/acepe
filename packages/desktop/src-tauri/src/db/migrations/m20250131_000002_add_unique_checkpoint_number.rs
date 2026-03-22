//! Migration to add unique constraint on (session_id, checkpoint_number).
//!
//! This prevents race conditions where concurrent checkpoint creation
//! could result in duplicate checkpoint numbers for the same session.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Drop the existing non-unique index
        manager
            .drop_index(
                Index::drop()
                    .name("idx_checkpoints_session_number")
                    .table(Checkpoints::Table)
                    .to_owned(),
            )
            .await?;

        // Create a unique index to prevent duplicate checkpoint numbers per session
        manager
            .create_index(
                Index::create()
                    .name("idx_checkpoints_session_number_unique")
                    .table(Checkpoints::Table)
                    .col(Checkpoints::SessionId)
                    .col(Checkpoints::CheckpointNumber)
                    .unique()
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Drop the unique index
        manager
            .drop_index(
                Index::drop()
                    .name("idx_checkpoints_session_number_unique")
                    .table(Checkpoints::Table)
                    .to_owned(),
            )
            .await?;

        // Recreate the non-unique index
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

        Ok(())
    }
}

#[derive(DeriveIden)]
enum Checkpoints {
    Table,
    SessionId,
    CheckpointNumber,
}
