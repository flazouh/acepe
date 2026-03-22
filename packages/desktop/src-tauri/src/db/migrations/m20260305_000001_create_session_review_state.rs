//! Migration to create session_review_state table.
//!
//! Stores persisted review progress per session (separate from workspace layout state).

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(SessionReviewState::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(SessionReviewState::SessionId)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(SessionReviewState::StateJson)
                            .text()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SessionReviewState::CreatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SessionReviewState::UpdatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_session_review_state_session_id")
                            .from(SessionReviewState::Table, SessionReviewState::SessionId)
                            .to(SessionMetadata::Table, SessionMetadata::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_session_review_state_updated_at")
                    .table(SessionReviewState::Table)
                    .col(SessionReviewState::UpdatedAt)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(SessionReviewState::Table).to_owned())
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum SessionReviewState {
    Table,
    SessionId,
    StateJson,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum SessionMetadata {
    Table,
    Id,
}
