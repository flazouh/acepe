use std::collections::HashSet;

use anyhow::{Context, Result};
use sea_orm::DbConn;
use serde::{Deserialize, Serialize};

use super::runtime::ComputerAppWindowScope;
use crate::db::repository::AppSettingsRepository;

const COMPUTER_APP_WINDOW_ALLOWLIST_KEY: &str = "computer_app_window_allowlist_v1";

#[derive(Debug, Default, Serialize, Deserialize)]
struct PersistedComputerAppWindowPolicy {
    scopes: Vec<ComputerAppWindowScope>,
}

pub async fn load_persisted_app_window_scopes(db: &DbConn) -> Result<Vec<ComputerAppWindowScope>> {
    let Some(raw) = AppSettingsRepository::get(db, COMPUTER_APP_WINDOW_ALLOWLIST_KEY).await? else {
        return Ok(Vec::new());
    };

    let policy = serde_json::from_str::<PersistedComputerAppWindowPolicy>(&raw)
        .context("Invalid persisted computer app/window allow-list")?;
    Ok(normalize_scopes(policy.scopes))
}

pub async fn persist_app_window_scope_allowed(
    db: &DbConn,
    scope: ComputerAppWindowScope,
) -> Result<Vec<ComputerAppWindowScope>> {
    let mut scopes = load_persisted_app_window_scopes(db).await?;
    scopes.push(scope);
    let normalized_scopes = normalize_scopes(scopes);
    save_persisted_app_window_scopes(db, &normalized_scopes).await?;
    Ok(normalized_scopes)
}

pub async fn persist_app_window_scope_denied(
    db: &DbConn,
    scope: &ComputerAppWindowScope,
) -> Result<Vec<ComputerAppWindowScope>> {
    let scopes = load_persisted_app_window_scopes(db).await?;
    let normalized_scopes = normalize_scopes(
        scopes
            .into_iter()
            .filter(|persisted_scope| persisted_scope != scope)
            .collect(),
    );
    save_persisted_app_window_scopes(db, &normalized_scopes).await?;
    Ok(normalized_scopes)
}

async fn save_persisted_app_window_scopes(
    db: &DbConn,
    scopes: &[ComputerAppWindowScope],
) -> Result<()> {
    let policy = PersistedComputerAppWindowPolicy {
        scopes: scopes.to_vec(),
    };
    let serialized =
        serde_json::to_string(&policy).context("Serialize computer app/window allow-list")?;
    AppSettingsRepository::set(db, COMPUTER_APP_WINDOW_ALLOWLIST_KEY, &serialized).await?;
    Ok(())
}

fn normalize_scopes(scopes: Vec<ComputerAppWindowScope>) -> Vec<ComputerAppWindowScope> {
    let mut scopes = scopes
        .into_iter()
        .collect::<HashSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    scopes.sort();
    scopes
}

#[cfg(test)]
mod tests {
    use sea_orm::{Database, DbConn};
    use sea_orm_migration::MigratorTrait;

    use super::*;

    async fn setup_test_db() -> DbConn {
        let db = Database::connect("sqlite::memory:")
            .await
            .expect("connect to in-memory sqlite");
        crate::db::migrations::Migrator::up(&db, None)
            .await
            .expect("run migrations");
        db
    }

    #[tokio::test]
    async fn persisted_app_window_scopes_are_deduplicated_and_sorted() {
        let db = setup_test_db().await;

        persist_app_window_scope_allowed(
            &db,
            ComputerAppWindowScope {
                app: Some("Safari".to_string()),
                window: Some("GitHub".to_string()),
            },
        )
        .await
        .expect("persist first scope");
        persist_app_window_scope_allowed(
            &db,
            ComputerAppWindowScope {
                app: Some("Acepe".to_string()),
                window: Some("Main".to_string()),
            },
        )
        .await
        .expect("persist second scope");
        let scopes = persist_app_window_scope_allowed(
            &db,
            ComputerAppWindowScope {
                app: Some("Safari".to_string()),
                window: Some("GitHub".to_string()),
            },
        )
        .await
        .expect("persist duplicate scope");

        assert_eq!(
            scopes,
            vec![
                ComputerAppWindowScope {
                    app: Some("Acepe".to_string()),
                    window: Some("Main".to_string()),
                },
                ComputerAppWindowScope {
                    app: Some("Safari".to_string()),
                    window: Some("GitHub".to_string()),
                },
            ]
        );
    }

    #[tokio::test]
    async fn denied_app_window_scope_removes_persisted_scope() {
        let db = setup_test_db().await;
        let scope = ComputerAppWindowScope {
            app: Some("Safari".to_string()),
            window: Some("GitHub".to_string()),
        };
        persist_app_window_scope_allowed(&db, scope.clone())
            .await
            .expect("persist scope");

        let scopes = persist_app_window_scope_denied(&db, &scope)
            .await
            .expect("deny scope");

        assert!(scopes.is_empty());
        assert!(load_persisted_app_window_scopes(&db)
            .await
            .expect("load scopes")
            .is_empty());
    }
}
