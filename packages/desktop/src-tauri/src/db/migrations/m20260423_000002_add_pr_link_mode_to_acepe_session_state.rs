use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(AcepeSessionState::Table)
                    .add_column(
                        ColumnDef::new(AcepeSessionState::PrLinkMode)
                            .string()
                            .null(),
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(AcepeSessionState::Table)
                    .drop_column(AcepeSessionState::PrLinkMode)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum AcepeSessionState {
    Table,
    PrLinkMode,
}
