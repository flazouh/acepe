use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(SessionHistoryEnrichment::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(SessionHistoryEnrichment::SessionId)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(SessionHistoryEnrichment::TotalMessages)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SessionHistoryEnrichment::UserMessages)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SessionHistoryEnrichment::AssistantMessages)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SessionHistoryEnrichment::TotalInputTokens)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SessionHistoryEnrichment::TotalOutputTokens)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SessionHistoryEnrichment::SourceMtime)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SessionHistoryEnrichment::SourceSize)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SessionHistoryEnrichment::SchemaVersion)
                            .integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SessionHistoryEnrichment::UpdatedAt)
                            .date_time()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_session_history_enrichment_session")
                            .from(
                                SessionHistoryEnrichment::Table,
                                SessionHistoryEnrichment::SessionId,
                            )
                            .to(SessionMetadata::Table, SessionMetadata::Id)
                            .on_update(ForeignKeyAction::Cascade)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(SessionHistoryEnrichment::Table)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum SessionHistoryEnrichment {
    Table,
    SessionId,
    TotalMessages,
    UserMessages,
    AssistantMessages,
    TotalInputTokens,
    TotalOutputTokens,
    SourceMtime,
    SourceSize,
    SchemaVersion,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum SessionMetadata {
    Table,
    Id,
}
