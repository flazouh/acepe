use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(SessionTranscriptSnapshot::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(SessionTranscriptSnapshot::SessionId)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(SessionTranscriptSnapshot::SnapshotJson)
                            .text()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SessionTranscriptSnapshot::UpdatedAt)
                            .date_time()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_session_transcript_snapshot_session_id")
                            .from(
                                SessionTranscriptSnapshot::Table,
                                SessionTranscriptSnapshot::SessionId,
                            )
                            .to(SessionMetadata::Table, SessionMetadata::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(SessionThreadSnapshot::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(SessionThreadSnapshot::SessionId)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(SessionThreadSnapshot::SnapshotJson)
                            .text()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SessionThreadSnapshot::UpdatedAt)
                            .date_time()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_session_thread_snapshot_session_id")
                            .from(
                                SessionThreadSnapshot::Table,
                                SessionThreadSnapshot::SessionId,
                            )
                            .to(SessionMetadata::Table, SessionMetadata::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(SessionThreadSnapshot::Table).to_owned())
            .await?;

        manager
            .drop_table(
                Table::drop()
                    .table(SessionTranscriptSnapshot::Table)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum SessionTranscriptSnapshot {
    Table,
    SessionId,
    SnapshotJson,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum SessionThreadSnapshot {
    Table,
    SessionId,
    SnapshotJson,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum SessionMetadata {
    Table,
    Id,
}
