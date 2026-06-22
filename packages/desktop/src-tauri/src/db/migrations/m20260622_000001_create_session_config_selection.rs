use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(SessionConfigSelection::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(SessionConfigSelection::SessionId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SessionConfigSelection::ConfigId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SessionConfigSelection::Value)
                            .text()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SessionConfigSelection::CreatedAt)
                            .date_time()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SessionConfigSelection::UpdatedAt)
                            .date_time()
                            .not_null(),
                    )
                    .primary_key(
                        Index::create()
                            .col(SessionConfigSelection::SessionId)
                            .col(SessionConfigSelection::ConfigId),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_session_config_selection_session_id")
                            .from(
                                SessionConfigSelection::Table,
                                SessionConfigSelection::SessionId,
                            )
                            .to(SessionMetadata::Table, SessionMetadata::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_session_config_selection_session_id")
                    .table(SessionConfigSelection::Table)
                    .col(SessionConfigSelection::SessionId)
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name("idx_session_config_selection_session_id")
                    .table(SessionConfigSelection::Table)
                    .to_owned(),
            )
            .await?;

        manager
            .drop_table(
                Table::drop()
                    .table(SessionConfigSelection::Table)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum SessionConfigSelection {
    Table,
    SessionId,
    ConfigId,
    Value,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum SessionMetadata {
    Table,
    Id,
}
