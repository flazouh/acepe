//! Drop SQL Studio tables after feature removal.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(SqlQueryHistory::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(SqlConnections::Table).to_owned())
            .await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Err(DbErr::Migration(
            "Cannot restore SQL Studio tables after feature removal".to_string(),
        ))
    }
}

#[derive(DeriveIden)]
enum SqlConnections {
    Table,
}

#[derive(DeriveIden)]
enum SqlQueryHistory {
    Table,
}
