//! Migration to add provider_session_id column to session_metadata table.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(SessionMetadata::Table)
                    .add_column(
                        ColumnDef::new(SessionMetadata::ProviderSessionId)
                            .string()
                            .null(),
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        // SQLite doesn't support DROP COLUMN — leave in place
        Ok(())
    }
}

#[derive(DeriveIden)]
enum SessionMetadata {
    Table,
    ProviderSessionId,
}
