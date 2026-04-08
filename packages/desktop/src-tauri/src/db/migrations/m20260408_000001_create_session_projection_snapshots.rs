use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(SessionProjectionSnapshot::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(SessionProjectionSnapshot::SessionId)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(SessionProjectionSnapshot::SnapshotJson)
                            .text()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SessionProjectionSnapshot::UpdatedAt)
                            .date_time()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_session_projection_snapshot_session_id")
                            .from(
                                SessionProjectionSnapshot::Table,
                                SessionProjectionSnapshot::SessionId,
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
            .drop_table(
                Table::drop()
                    .table(SessionProjectionSnapshot::Table)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum SessionProjectionSnapshot {
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
