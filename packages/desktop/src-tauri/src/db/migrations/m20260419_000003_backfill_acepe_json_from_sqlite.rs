use sea_orm::{ConnectionTrait, DbBackend, Statement};
use sea_orm_migration::prelude::*;
use std::collections::HashMap;
use std::path::Path;

use crate::storage::acepe_config;

#[derive(DeriveMigrationName)]
pub struct Migration;

const KEY_SHOW_NON_ACEPE_SESSIONS: &str = "show_non_acepe_sessions";
const KEY_SETUP_SCRIPT: &str = "setup_script";
const KEY_RUN_SCRIPT: &str = "run_script";

#[derive(Debug)]
struct ProjectRow {
    id: String,
    path: String,
    show_external_cli_sessions: bool,
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let backend = manager.get_database_backend();
        let projects = load_projects(manager, backend).await?;
        let settings = load_project_settings(manager, backend).await?;

        for project in projects {
            let project_path = Path::new(&project.path);
            if !project_path.is_dir() {
                tracing::warn!(
                    project_id = %project.id,
                    project_path = %project.path,
                    "Skipping .acepe.json backfill for missing project path"
                );
                continue;
            }

            let existing = acepe_config::read(project_path).map_err(|error| {
                DbErr::Migration(format!(
                    "Failed to read existing .acepe.json for {}: {}",
                    project.path, error
                ))
            })?;

            let merged = merge_project_config(
                existing,
                settings.get(&project.id),
                project.show_external_cli_sessions,
            );

            acepe_config::write(project_path, &merged).map_err(|error| {
                DbErr::Migration(format!(
                    "Failed to write .acepe.json for {}: {}",
                    project.path, error
                ))
            })?;
        }

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Err(DbErr::Migration(
            "m20260419_000003 is not reversible".to_string(),
        ))
    }
}

fn merge_project_config(
    mut existing: acepe_config::AcepeConfig,
    sqlite_settings: Option<&HashMap<String, String>>,
    show_external_cli_sessions: bool,
) -> acepe_config::AcepeConfig {
    if let Some(settings) = sqlite_settings {
        if let Some(setup_script) = settings.get(KEY_SETUP_SCRIPT) {
            existing.scripts.setup = setup_script.clone();
        }

        if let Some(run_script) = settings.get(KEY_RUN_SCRIPT) {
            existing.scripts.run = run_script.clone();
        }

        if let Some(show_non_acepe_sessions) = settings.get(KEY_SHOW_NON_ACEPE_SESSIONS) {
            if let Ok(parsed) = show_non_acepe_sessions.parse::<bool>() {
                existing.external_cli_sessions.show = parsed;
                return existing;
            }
        }
    }

    if !show_external_cli_sessions {
        existing.external_cli_sessions.show = false;
    }

    existing
}

async fn load_projects(
    manager: &SchemaManager<'_>,
    backend: DbBackend,
) -> Result<Vec<ProjectRow>, DbErr> {
    let rows = manager
        .get_connection()
        .query_all(Statement::from_string(
            backend,
            "SELECT id, path, show_external_cli_sessions FROM projects".to_string(),
        ))
        .await?;

    let mut projects = Vec::with_capacity(rows.len());
    for row in rows {
        projects.push(ProjectRow {
            id: row.try_get("", "id")?,
            path: row.try_get("", "path")?,
            show_external_cli_sessions: row
                .try_get::<bool>("", "show_external_cli_sessions")
                .unwrap_or(true),
        });
    }

    Ok(projects)
}

async fn load_project_settings(
    manager: &SchemaManager<'_>,
    backend: DbBackend,
) -> Result<HashMap<String, HashMap<String, String>>, DbErr> {
    let rows = manager
        .get_connection()
        .query_all(Statement::from_string(
            backend,
            "SELECT project_id, key, value FROM project_settings".to_string(),
        ))
        .await?;

    let mut settings = HashMap::new();
    for row in rows {
        let project_id: String = row.try_get("", "project_id")?;
        let key: String = row.try_get("", "key")?;
        let value: String = row.try_get("", "value")?;
        settings
            .entry(project_id)
            .or_insert_with(HashMap::new)
            .insert(key, value);
    }

    Ok(settings)
}

#[cfg(test)]
mod tests {
    use super::Migration;
    use sea_orm::{ConnectionTrait, Database, DbBackend, Statement};
    use sea_orm_migration::{MigrationTrait, SchemaManager};
    use tempfile::tempdir;

    #[tokio::test]
    async fn backfills_and_merges_sqlite_settings_into_acepe_json() {
        let db = Database::connect("sqlite::memory:")
            .await
            .expect("connect sqlite");
        db.execute_unprepared(
            "CREATE TABLE projects (
                id TEXT PRIMARY KEY NOT NULL,
                path TEXT NOT NULL,
                show_external_cli_sessions BOOLEAN NOT NULL
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

        let directory = tempdir().expect("tempdir");
        let project_path = directory.path().join("project-a");
        std::fs::create_dir(&project_path).expect("create project directory");
        std::fs::write(
            project_path.join(".acepe.json"),
            "{\n  \"version\": 1,\n  \"scripts\": {\n    \"run\": \"pnpm dev\"\n  },\n  \"externalCliSessions\": {\n    \"show\": true\n  },\n  \"futureTopLevel\": 9,\n  \"worktree\": {\n    \"setupCommands\": [\"legacy setup\"]\n  }\n}\n",
        )
        .expect("seed config");

        db.execute(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "INSERT INTO projects (id, path, show_external_cli_sessions) VALUES (?, ?, ?)",
            [
                "project-1".into(),
                project_path.to_string_lossy().to_string().into(),
                false.into(),
            ],
        ))
        .await
        .expect("insert project");
        db.execute(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "INSERT INTO project_settings (project_id, key, value) VALUES (?, ?, ?), (?, ?, ?)",
            [
                "project-1".into(),
                "setup_script".into(),
                "bun install\nbun test".into(),
                "project-1".into(),
                "show_non_acepe_sessions".into(),
                "false".into(),
            ],
        ))
        .await
        .expect("insert settings");

        let manager = SchemaManager::new(&db);
        Migration.up(&manager).await.expect("run migration");

        let written = std::fs::read_to_string(project_path.join(".acepe.json"))
            .expect("read migrated config");
        assert!(written.contains("\"setup\": \"bun install\\nbun test\""));
        assert!(written.contains("\"run\": \"pnpm dev\""));
        assert!(written.contains("\"show\": false"));
        assert!(written.contains("\"futureTopLevel\": 9"));
        assert!(!written.contains("\"worktree\""));
    }
}
