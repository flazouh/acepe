use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared(
                "ALTER TABLE sql_connections
                 ADD COLUMN connection_kind TEXT NOT NULL DEFAULT 'sql'",
            )
            .await?;

        manager
            .get_connection()
            .execute_unprepared("ALTER TABLE sql_connections ADD COLUMN config_json TEXT")
            .await?;

        manager
            .get_connection()
            .execute_unprepared("ALTER TABLE sql_connections ADD COLUMN secret_json TEXT")
            .await?;

        manager
            .get_connection()
            .execute_unprepared(
                "UPDATE sql_connections
                 SET connection_kind = 'sql',
                     config_json = json_object(
                       'host', host,
                       'port', port,
                       'databaseName', database_name,
                       'username', username,
                       'filePath', file_path,
                       'sslMode', ssl_mode
                     ),
                     secret_json = password
                 WHERE connection_kind IS NULL OR connection_kind = ''",
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared("ALTER TABLE sql_connections DROP COLUMN secret_json")
            .await?;

        manager
            .get_connection()
            .execute_unprepared("ALTER TABLE sql_connections DROP COLUMN config_json")
            .await?;

        manager
            .get_connection()
            .execute_unprepared("ALTER TABLE sql_connections DROP COLUMN connection_kind")
            .await?;

        Ok(())
    }
}
