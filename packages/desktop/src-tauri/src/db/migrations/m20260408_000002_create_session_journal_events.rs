use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(SessionJournalEvent::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(SessionJournalEvent::EventId)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(SessionJournalEvent::SessionId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SessionJournalEvent::EventSeq)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SessionJournalEvent::EventKind)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SessionJournalEvent::EventJson)
                            .text()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SessionJournalEvent::CreatedAt)
                            .date_time()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_session_journal_event_session_id")
                            .from(SessionJournalEvent::Table, SessionJournalEvent::SessionId)
                            .to(SessionMetadata::Table, SessionMetadata::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_session_journal_event_session_seq")
                    .table(SessionJournalEvent::Table)
                    .col(SessionJournalEvent::SessionId)
                    .col(SessionJournalEvent::EventSeq)
                    .unique()
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_session_journal_event_session_id")
                    .table(SessionJournalEvent::Table)
                    .col(SessionJournalEvent::SessionId)
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name("idx_session_journal_event_session_seq")
                    .table(SessionJournalEvent::Table)
                    .to_owned(),
            )
            .await?;

        manager
            .drop_index(
                Index::drop()
                    .name("idx_session_journal_event_session_id")
                    .table(SessionJournalEvent::Table)
                    .to_owned(),
            )
            .await?;

        manager
            .drop_table(Table::drop().table(SessionJournalEvent::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum SessionJournalEvent {
    Table,
    EventId,
    SessionId,
    EventSeq,
    EventKind,
    EventJson,
    CreatedAt,
}

#[derive(DeriveIden)]
enum SessionMetadata {
    Table,
    Id,
}
