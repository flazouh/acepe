use sea_orm::{ConnectionTrait, DatabaseBackend, Statement};
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
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
            .alter_table(
                Table::alter()
                    .table(SessionTranscriptRowLedger::Table)
                    .drop_column(SessionTranscriptRowLedger::RowCount)
                    .to_owned(),
            )
            .await?;
        manager
            .get_connection()
            .execute(Statement::from_string(
                DatabaseBackend::Sqlite,
                "UPDATE session_transcript_row_ledger \
                 SET rebuild_status = 'rebuild_needed'"
                    .to_string(),
            ))
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(SessionTranscriptRowScope::Table)
                    .col(
                        ColumnDef::new(SessionTranscriptRowScope::SessionId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SessionTranscriptRowScope::ScopeKey)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SessionTranscriptRowScope::RowCount)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SessionTranscriptRowScope::UpdatedAt)
                            .date_time()
                            .not_null(),
                    )
                    .primary_key(
                        Index::create()
                            .col(SessionTranscriptRowScope::SessionId)
                            .col(SessionTranscriptRowScope::ScopeKey),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_session_transcript_row_scope_session_id")
                            .from(
                                SessionTranscriptRowScope::Table,
                                SessionTranscriptRowScope::SessionId,
                            )
                            .to(SessionMetadata::Table, SessionMetadata::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager.create_table(scoped_row_table()).await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_session_transcript_row_session_scope_row_id")
                    .table(SessionTranscriptRow::Table)
                    .col(SessionTranscriptRow::SessionId)
                    .col(SessionTranscriptRow::ScopeKey)
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
                    .name("idx_session_transcript_row_session_scope_row_id")
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
                    .table(SessionTranscriptRowScope::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(SessionTranscriptRowLedger::Table)
                    .add_column(
                        ColumnDef::new(SessionTranscriptRowLedger::RowCount)
                            .big_integer()
                            .not_null()
                            .default(0),
                    )
                    .to_owned(),
            )
            .await?;

        manager.create_table(root_row_table()).await?;
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
}

fn scoped_row_table() -> TableCreateStatement {
    row_table(true)
}

fn root_row_table() -> TableCreateStatement {
    row_table(false)
}

fn row_table(scoped: bool) -> TableCreateStatement {
    let mut table = Table::create();
    table.table(SessionTranscriptRow::Table).col(
        ColumnDef::new(SessionTranscriptRow::SessionId)
            .string()
            .not_null(),
    );
    if scoped {
        table.col(
            ColumnDef::new(SessionTranscriptRow::ScopeKey)
                .string()
                .not_null(),
        );
    }
    table
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
        );
    let mut primary_key = Index::create();
    primary_key.col(SessionTranscriptRow::SessionId);
    if scoped {
        primary_key.col(SessionTranscriptRow::ScopeKey);
    }
    primary_key.col(SessionTranscriptRow::RowIndex);
    table
        .primary_key(&mut primary_key)
        .foreign_key(
            ForeignKey::create()
                .name("fk_session_transcript_row_session_id")
                .from(SessionTranscriptRow::Table, SessionTranscriptRow::SessionId)
                .to(SessionMetadata::Table, SessionMetadata::Id)
                .on_delete(ForeignKeyAction::Cascade),
        )
        .to_owned()
}

#[derive(DeriveIden)]
enum SessionTranscriptRowLedger {
    Table,
    RowCount,
}

#[derive(DeriveIden)]
enum SessionTranscriptRowScope {
    Table,
    SessionId,
    ScopeKey,
    RowCount,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum SessionTranscriptRow {
    Table,
    SessionId,
    ScopeKey,
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
