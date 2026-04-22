use std::collections::HashSet;

use sea_orm::DbConn;

use crate::db::repository::ProjectRepository;

pub async fn load_external_hidden_paths_or_empty(
    db: &DbConn,
    project_paths: &[String],
    operation: &str,
) -> HashSet<String> {
    match ProjectRepository::get_external_hidden_paths(db, project_paths).await {
        Ok(paths) => paths,
        Err(error) => {
            tracing::warn!(
                error = %error,
                operation,
                "Failed to load project session visibility settings; using legacy visibility fallback"
            );
            HashSet::new()
        }
    }
}
