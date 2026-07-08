use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(SessionTranscriptRowLedger::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(SessionTranscriptRowLedger::SessionId)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(SessionTranscriptRowLedger::RowCount)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SessionTranscriptRowLedger::TranscriptRevision)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SessionTranscriptRowLedger::GraphRevision)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SessionTranscriptRowLedger::LastEventSeq)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SessionTranscriptRowLedger::ProjectionVersion)
                            .string()
                            .not_null(),
                    )
                    .col(ColumnDef::new(SessionTranscriptRowLedger::OpenHeaderJson).text())
                    .col(
                        ColumnDef::new(SessionTranscriptRowLedger::RebuildStatus)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SessionTranscriptRowLedger::UpdatedAt)
                            .date_time()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_session_transcript_row_ledger_session_id")
                            .from(
                                SessionTranscriptRowLedger::Table,
                                SessionTranscriptRowLedger::SessionId,
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
                    .table(SessionTranscriptRow::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(SessionTranscriptRow::SessionId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SessionTranscriptRow::RowIndex)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SessionTranscriptRow::RowId)
                            .string()
                            .not_null(),
                    )
                    .col(ColumnDef::new(SessionTranscriptRow::SourceEntryId).string())
                    .col(
                        ColumnDef::new(SessionTranscriptRow::RowKind)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SessionTranscriptRow::RowVersion)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SessionTranscriptRow::TranscriptRevision)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SessionTranscriptRow::GraphRevision)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SessionTranscriptRow::ProjectionVersion)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SessionTranscriptRow::RowJson)
                            .text()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SessionTranscriptRow::UpdatedAt)
                            .date_time()
                            .not_null(),
                    )
                    .primary_key(
                        Index::create()
                            .col(SessionTranscriptRow::SessionId)
                            .col(SessionTranscriptRow::RowIndex),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_session_transcript_row_session_id")
                            .from(SessionTranscriptRow::Table, SessionTranscriptRow::SessionId)
                            .to(SessionMetadata::Table, SessionMetadata::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_session_transcript_row_session_row_id")
                    .table(SessionTranscriptRow::Table)
                    .col(SessionTranscriptRow::SessionId)
                    .col(SessionTranscriptRow::RowId)
                    .unique()
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name("idx_session_transcript_row_session_row_id")
                    .table(SessionTranscriptRow::Table)
                    .to_owned(),
            )
            .await?;

        manager
            .drop_table(Table::drop().table(SessionTranscriptRow::Table).to_owned())
            .await?;

        manager
            .drop_table(
                Table::drop()
                    .table(SessionTranscriptRowLedger::Table)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum SessionTranscriptRowLedger {
    Table,
    SessionId,
    RowCount,
    TranscriptRevision,
    GraphRevision,
    LastEventSeq,
    ProjectionVersion,
    OpenHeaderJson,
    RebuildStatus,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum SessionTranscriptRow {
    Table,
    SessionId,
    RowIndex,
    RowId,
    SourceEntryId,
    RowKind,
    RowVersion,
    TranscriptRevision,
    GraphRevision,
    ProjectionVersion,
    RowJson,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum SessionMetadata {
    Table,
    Id,
}
