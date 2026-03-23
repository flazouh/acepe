use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Projects::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(Projects::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(Projects::Path)
                            .string()
                            .not_null()
                            .unique_key(),
                    )
                    .col(ColumnDef::new(Projects::Name).string().not_null())
                    .col(ColumnDef::new(Projects::LastOpened).date_time().not_null())
                    .col(ColumnDef::new(Projects::CreatedAt).date_time().not_null())
                    .col(
                        ColumnDef::new(Projects::Color)
                            .string()
                            .not_null()
                            .default("red"),
                    )
                    .to_owned(),
            )
            .await?;

        // Create unique index on path
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_projects_path")
                    .table(Projects::Table)
                    .col(Projects::Path)
                    .unique()
                    .to_owned(),
            )
            .await?;

        // Create index on last_opened for sorting recent projects
        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_projects_last_opened")
                    .table(Projects::Table)
                    .col(Projects::LastOpened)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(Projects::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum Projects {
    Table,
    Id,
    Path,
    Name,
    LastOpened,
    CreatedAt,
    Color,
}
