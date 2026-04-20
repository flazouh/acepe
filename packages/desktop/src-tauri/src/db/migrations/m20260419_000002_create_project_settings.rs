use sea_orm::{ConnectionTrait, DbBackend, Statement};
use sea_orm_migration::prelude::*;
use std::path::Path;

#[derive(DeriveMigrationName)]
pub struct Migration;

const SETTING_KEY_COLOR: &str = "color";
const SETTING_KEY_SHOW_NON_ACEPE_SESSIONS: &str = "show_non_acepe_sessions";
const SETTING_KEY_SETUP_SCRIPT: &str = "setup_script";

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(ProjectSettings::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(ProjectSettings::ProjectId)
                            .string()
                            .not_null(),
                    )
                    .col(ColumnDef::new(ProjectSettings::Key).string().not_null())
                    .col(ColumnDef::new(ProjectSettings::Value).string().not_null())
                    .primary_key(
                        Index::create()
                            .col(ProjectSettings::ProjectId)
                            .col(ProjectSettings::Key),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .if_not_exists()
                    .name("idx_project_settings_project_id")
                    .table(ProjectSettings::Table)
                    .col(ProjectSettings::ProjectId)
                    .to_owned(),
            )
            .await?;

        let backend = manager.get_database_backend();
        let project_rows = manager
            .get_connection()
            .query_all(Statement::from_string(
                backend,
                "SELECT id, path, color, show_external_cli_sessions FROM projects".to_string(),
            ))
            .await?;

        for row in project_rows {
            let project_id = row.try_get::<String>("", "id")?;
            let path = row.try_get::<String>("", "path")?;
            let color = row.try_get::<String>("", "color")?;
            let show_external_cli_sessions = row
                .try_get::<bool>("", "show_external_cli_sessions")
                .unwrap_or(true);

            insert_project_setting(manager, backend, &project_id, SETTING_KEY_COLOR, &color)
                .await?;

            insert_project_setting(
                manager,
                backend,
                &project_id,
                SETTING_KEY_SHOW_NON_ACEPE_SESSIONS,
                if show_external_cli_sessions {
                    "true"
                } else {
                    "false"
                },
            )
            .await?;

            if let Some(setup_script) = load_setup_script(Path::new(&path)) {
                insert_project_setting(
                    manager,
                    backend,
                    &project_id,
                    SETTING_KEY_SETUP_SCRIPT,
                    &setup_script,
                )
                .await?;
            }
        }

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(ProjectSettings::Table).to_owned())
            .await
    }
}

async fn insert_project_setting(
    manager: &SchemaManager<'_>,
    backend: DbBackend,
    project_id: &str,
    key: &str,
    value: &str,
) -> Result<(), DbErr> {
    manager
        .get_connection()
        .execute(Statement::from_sql_and_values(
            backend,
            "INSERT OR REPLACE INTO project_settings (project_id, key, value) VALUES (?, ?, ?)",
            [project_id.into(), key.into(), value.into()],
        ))
        .await?;

    Ok(())
}

fn load_setup_script(project_path: &Path) -> Option<String> {
    let candidates = [
        project_path.join(".acepe.json"),
        project_path.join("acepe.config.json"),
    ];

    for config_path in candidates {
        if !config_path.exists() {
            continue;
        }

        let content = std::fs::read_to_string(&config_path).ok()?;
        let parsed = serde_json::from_str::<serde_json::Value>(&content).ok()?;
        let commands = parsed
            .get("worktree")
            .and_then(|value| value.get("setupCommands"))
            .and_then(serde_json::Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .filter_map(serde_json::Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(std::borrow::ToOwned::to_owned)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        if !commands.is_empty() {
            return Some(commands.join("\n"));
        }
    }

    None
}

#[derive(DeriveIden)]
enum ProjectSettings {
    Table,
    ProjectId,
    Key,
    Value,
}
