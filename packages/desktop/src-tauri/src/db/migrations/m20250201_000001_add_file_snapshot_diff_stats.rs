//! Migration to add diff stats columns to file_snapshots table.
//!
//! Adds lines_added and lines_removed columns to track diff statistics
//! for each file snapshot, enabling visual diff display in the UI.

use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Add lines_added column (nullable for backwards compatibility)
        manager
            .alter_table(
                Table::alter()
                    .table(FileSnapshots::Table)
                    .add_column(ColumnDef::new(FileSnapshots::LinesAdded).integer().null())
                    .to_owned(),
            )
            .await?;

        // Add lines_removed column (nullable for backwards compatibility)
        manager
            .alter_table(
                Table::alter()
                    .table(FileSnapshots::Table)
                    .add_column(ColumnDef::new(FileSnapshots::LinesRemoved).integer().null())
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(FileSnapshots::Table)
                    .drop_column(FileSnapshots::LinesAdded)
                    .to_owned(),
            )
            .await?;

        manager
            .alter_table(
                Table::alter()
                    .table(FileSnapshots::Table)
                    .drop_column(FileSnapshots::LinesRemoved)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }
}

#[derive(DeriveIden)]
enum FileSnapshots {
    Table,
    LinesAdded,
    LinesRemoved,
}
