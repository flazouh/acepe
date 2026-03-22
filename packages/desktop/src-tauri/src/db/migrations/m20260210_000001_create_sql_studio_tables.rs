use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(SqlConnections::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(SqlConnections::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(SqlConnections::Name).string().not_null())
                    .col(ColumnDef::new(SqlConnections::Engine).string().not_null())
                    .col(ColumnDef::new(SqlConnections::Host).string())
                    .col(ColumnDef::new(SqlConnections::Port).integer())
                    .col(ColumnDef::new(SqlConnections::DatabaseName).string())
                    .col(ColumnDef::new(SqlConnections::Username).string())
                    .col(ColumnDef::new(SqlConnections::Password).string())
                    .col(ColumnDef::new(SqlConnections::FilePath).string())
                    .col(ColumnDef::new(SqlConnections::SslMode).string())
                    .col(
                        ColumnDef::new(SqlConnections::CreatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SqlConnections::UpdatedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_sql_connections_name")
                    .table(SqlConnections::Table)
                    .col(SqlConnections::Name)
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(SqlQueryHistory::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(SqlQueryHistory::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(SqlQueryHistory::ConnectionId)
                            .string()
                            .not_null(),
                    )
                    .col(ColumnDef::new(SqlQueryHistory::SqlText).text().not_null())
                    .col(
                        ColumnDef::new(SqlQueryHistory::ExecutedAt)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SqlQueryHistory::DurationMs)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SqlQueryHistory::RowCount)
                            .big_integer()
                            .not_null(),
                    )
                    .col(ColumnDef::new(SqlQueryHistory::Status).string().not_null())
                    .col(ColumnDef::new(SqlQueryHistory::ErrorSummary).string())
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_sql_query_history_connection_id")
                            .from(SqlQueryHistory::Table, SqlQueryHistory::ConnectionId)
                            .to(SqlConnections::Table, SqlConnections::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_sql_query_history_connection_executed")
                    .table(SqlQueryHistory::Table)
                    .col(SqlQueryHistory::ConnectionId)
                    .col(SqlQueryHistory::ExecutedAt)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(SqlQueryHistory::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(SqlConnections::Table).to_owned())
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum SqlConnections {
    Table,
    Id,
    Name,
    Engine,
    Host,
    Port,
    DatabaseName,
    Username,
    Password,
    FilePath,
    SslMode,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum SqlQueryHistory {
    Table,
    Id,
    ConnectionId,
    SqlText,
    ExecutedAt,
    DurationMs,
    RowCount,
    Status,
    ErrorSummary,
}
