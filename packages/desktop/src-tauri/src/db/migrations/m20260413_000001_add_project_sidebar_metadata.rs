use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Projects::Table)
                    .add_column(
                        ColumnDef::new(Projects::SortOrder)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .alter_table(
                Table::alter()
                    .table(Projects::Table)
                    .add_column(ColumnDef::new(Projects::IconPath).string().null())
                    .to_owned(),
            )
            .await?;

        manager
            .get_connection()
            .execute_unprepared(
                r#"
                UPDATE projects
                SET sort_order = (
                    SELECT COUNT(*)
                    FROM projects AS newer
                    WHERE newer.created_at > projects.created_at
                        OR (newer.created_at = projects.created_at AND newer.id < projects.id)
                );
                "#,
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_projects_sort_order")
                    .table(Projects::Table)
                    .col(Projects::SortOrder)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        // SQLite doesn't support DROP COLUMN — leave in place
        Ok(())
    }
}

#[derive(DeriveIden)]
enum Projects {
    Table,
    SortOrder,
    IconPath,
}
