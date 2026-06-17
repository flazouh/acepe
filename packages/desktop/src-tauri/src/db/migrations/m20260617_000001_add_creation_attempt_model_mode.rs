//! Add explicit initial model/mode columns to creation_attempts.

use sea_orm_migration::prelude::*;
use sea_orm_migration::sea_orm::Statement;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        if !model_id_exists(db).await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(CreationAttempts::Table)
                        .add_column(
                            ColumnDef::new(CreationAttempts::ModelId)
                                .string()
                                .null(),
                        )
                        .to_owned(),
                )
                .await?;
        }

        if !mode_id_exists(db).await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(CreationAttempts::Table)
                        .add_column(
                            ColumnDef::new(CreationAttempts::ModeId)
                                .string()
                                .null(),
                        )
                        .to_owned(),
                )
                .await?;
        }

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        if mode_id_exists(db).await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(CreationAttempts::Table)
                        .drop_column(CreationAttempts::ModeId)
                        .to_owned(),
                )
                .await?;
        }

        if model_id_exists(db).await? {
            manager
                .alter_table(
                    Table::alter()
                        .table(CreationAttempts::Table)
                        .drop_column(CreationAttempts::ModelId)
                        .to_owned(),
                )
                .await?;
        }

        Ok(())
    }
}

async fn model_id_exists<C>(db: &C) -> Result<bool, DbErr>
where
    C: ConnectionTrait,
{
    column_exists(db, "model_id").await
}

async fn mode_id_exists<C>(db: &C) -> Result<bool, DbErr>
where
    C: ConnectionTrait,
{
    column_exists(db, "mode_id").await
}

async fn column_exists<C>(db: &C, column_name: &str) -> Result<bool, DbErr>
where
    C: ConnectionTrait,
{
    let row = db
        .query_one(Statement::from_string(
            db.get_database_backend(),
            format!(
                "SELECT COUNT(*) AS count
                 FROM pragma_table_info('creation_attempts')
                 WHERE name = '{column_name}'"
            ),
        ))
        .await?;

    Ok(row
        .and_then(|row| row.try_get::<i64>("", "count").ok())
        .unwrap_or(0)
        > 0)
}

#[derive(DeriveIden)]
enum CreationAttempts {
    Table,
    ModelId,
    ModeId,
}
