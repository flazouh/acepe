use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        // Some project paths may be unavailable during the .acepe.json backfill migration
        // (external drives, network mounts, disconnected worktrees). Keep the legacy SQLite
        // settings in place so those values remain recoverable until cleanup can be proven safe.
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Err(DbErr::Migration("m20260419_000004 is not reversible".to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::Migration;
    use sea_orm::{ConnectionTrait, Database, DbBackend, Statement};
    use sea_orm_migration::{MigrationTrait, SchemaManager};

    #[tokio::test]
    async fn keeps_legacy_project_settings_storage_in_place() {
        let db = Database::connect("sqlite::memory:")
            .await
            .expect("connect sqlite");
        db.execute_unprepared(
            "CREATE TABLE projects (
                id TEXT PRIMARY KEY NOT NULL,
                path TEXT NOT NULL,
                show_external_cli_sessions BOOLEAN NOT NULL,
                color TEXT NOT NULL
            )",
        )
        .await
        .expect("create projects");
        db.execute_unprepared(
            "CREATE TABLE project_settings (
                project_id TEXT NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                PRIMARY KEY (project_id, key)
            )",
        )
        .await
        .expect("create project_settings");

        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.expect("run migration");

        let project_settings_table = db
            .query_one(Statement::from_string(
                DbBackend::Sqlite,
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_settings'"
                    .to_string(),
            ))
            .await
            .expect("query sqlite_master");
        assert!(project_settings_table.is_some());

        let table_info = db
            .query_all(Statement::from_string(
                DbBackend::Sqlite,
                "PRAGMA table_info(projects)".to_string(),
            ))
            .await
            .expect("load table info");
        let column_names = table_info
            .into_iter()
            .map(|row| row.try_get::<String>("", "name").expect("column name"))
            .collect::<Vec<_>>();

        assert!(column_names.contains(&"id".to_string()));
        assert!(column_names.contains(&"path".to_string()));
        assert!(column_names.contains(&"color".to_string()));
        assert!(column_names.contains(&"show_external_cli_sessions".to_string()));
    }
}
