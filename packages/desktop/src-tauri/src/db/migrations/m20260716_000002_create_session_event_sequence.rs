use sea_orm::{ConnectionTrait, DatabaseBackend, Statement};
use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(SessionEventSequence::Table)
                    .col(
                        ColumnDef::new(SessionEventSequence::SessionId)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(SessionEventSequence::LastAssignedSeq)
                            .big_integer()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_session_event_sequence_session_id")
                            .from(SessionEventSequence::Table, SessionEventSequence::SessionId)
                            .to(SessionMetadata::Table, SessionMetadata::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .check(Expr::col(SessionEventSequence::LastAssignedSeq).gte(0))
                    .to_owned(),
            )
            .await?;

        manager
            .get_connection()
            .execute(Statement::from_string(
                DatabaseBackend::Sqlite,
                r#"
                INSERT INTO session_event_sequence (session_id, last_assigned_seq)
                SELECT
                    metadata.id,
                    MAX(
                        COALESCE(journal.max_event_seq, 0),
                        COALESCE(ledger.last_event_seq, 0)
                    )
                FROM session_metadata AS metadata
                LEFT JOIN (
                    SELECT session_id, MAX(event_seq) AS max_event_seq
                    FROM session_journal_event
                    GROUP BY session_id
                ) AS journal ON journal.session_id = metadata.id
                LEFT JOIN session_transcript_row_ledger AS ledger
                    ON ledger.session_id = metadata.id
                WHERE MAX(
                    COALESCE(journal.max_event_seq, 0),
                    COALESCE(ledger.last_event_seq, 0)
                ) > 0
                "#
                .to_string(),
            ))
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(SessionEventSequence::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum SessionEventSequence {
    Table,
    SessionId,
    LastAssignedSeq,
}

#[derive(DeriveIden)]
enum SessionMetadata {
    Table,
    Id,
}
