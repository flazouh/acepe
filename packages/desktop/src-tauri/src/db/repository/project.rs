//! Project repository.
//! Extracted verbatim from the former db/repository.rs monolith.

use crate::db::entities::prelude::*;
use crate::storage::acepe_config;
use anyhow::Result;
use chrono::Utc;
use rand::Rng;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DbConn, EntityTrait, PaginatorTrait,
    QueryFilter, QueryOrder, QuerySelect, Set, TransactionTrait,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ============================================================================
// Project Repository
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectRow {
    pub id: String,
    pub path: String,
    pub name: String,
    pub last_opened: String,
    pub created_at: String,
    pub color: String,
    pub sort_order: i32,
    pub icon_path: Option<String>,
    pub show_external_cli_sessions: bool,
}

pub struct ProjectRepository;

impl ProjectRepository {
    fn load_project_config(path: &str) -> acepe_config::AcepeConfig {
        acepe_config::read_or_default(std::path::Path::new(path))
    }

    fn display_name(path: &str, stored_name: &str) -> String {
        std::path::Path::new(path)
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.is_empty())
            .map(std::borrow::ToOwned::to_owned)
            .unwrap_or_else(|| stored_name.to_string())
    }

    fn default_show_external_cli_sessions() -> bool {
        acepe_config::AcepeConfig::default()
            .external_cli_sessions
            .show
    }

    fn row_from_model_without_config(model: crate::db::entities::project::Model) -> ProjectRow {
        let name = Self::display_name(&model.path, &model.name);

        ProjectRow {
            id: model.id,
            path: model.path,
            name,
            last_opened: model.last_opened.to_rfc3339(),
            created_at: model.created_at.to_rfc3339(),
            color: model.color,
            sort_order: model.sort_order,
            icon_path: model.icon_path,
            show_external_cli_sessions: Self::default_show_external_cli_sessions(),
        }
    }

    fn row_from_model_with_config(model: crate::db::entities::project::Model) -> ProjectRow {
        let name = Self::display_name(&model.path, &model.name);
        let show_external_cli_sessions = Self::load_project_config(&model.path)
            .external_cli_sessions
            .show;

        ProjectRow {
            id: model.id,
            path: model.path,
            name,
            last_opened: model.last_opened.to_rfc3339(),
            created_at: model.created_at.to_rfc3339(),
            color: model.color,
            sort_order: model.sort_order,
            icon_path: model.icon_path,
            show_external_cli_sessions,
        }
    }

    fn row_from_model(model: crate::db::entities::project::Model) -> ProjectRow {
        Self::row_from_model_with_config(model)
    }

    /// Create or update a project.
    /// If project exists, updates last_opened timestamp.
    /// If project doesn't exist, creates it.
    /// If color is None and project is new, assigns a random color.
    pub async fn create_or_update(
        db: &DbConn,
        path: String,
        name: String,
        color: Option<String>,
    ) -> Result<ProjectRow> {
        tracing::debug!(
            path = %path,
            name = %name,
            "Creating or updating project"
        );

        // Check if project exists
        let existing = Project::find()
            .filter(crate::db::entities::project::Column::Path.eq(&path))
            .one(db)
            .await?;

        let now = Utc::now();

        let project_row = if let Some(existing_model) = existing {
            // Update existing project
            let mut active: crate::db::entities::project::ActiveModel = existing_model.into();
            let id = active.id.as_ref().clone();
            let created_at = *active.created_at.as_ref();
            let existing_color = active.color.as_ref().clone();
            let sort_order = *active.sort_order.as_ref();
            let icon_path = active.icon_path.as_ref().clone();
            active.name = Set(name.clone());
            active.last_opened = Set(now);
            // Update color if provided, otherwise keep existing
            let final_color = color.unwrap_or(existing_color);
            active.color = Set(final_color.clone());
            active.update(db).await?;

            tracing::info!(
                path = %path,
                "Project updated"
            );
            let show_external_cli_sessions =
                Self::load_project_config(&path).external_cli_sessions.show;

            ProjectRow {
                id,
                path,
                name,
                last_opened: now.to_rfc3339(),
                created_at: created_at.to_rfc3339(),
                color: final_color,
                sort_order,
                icon_path,
                show_external_cli_sessions,
            }
        } else {
            // Create new project - assign random color if not provided
            let assigned_color = color.unwrap_or_else(|| {
                let colors = ["red", "orange", "yellow", "green", "cyan", "purple", "pink"];
                let mut rng = rand::thread_rng();
                colors[rng.gen_range(0..colors.len())].to_string()
            });

            let txn = db.begin().await?;
            txn.execute_unprepared("UPDATE projects SET sort_order = sort_order + 1")
                .await?;

            let id = Uuid::new_v4().to_string();
            let project = crate::db::entities::project::ActiveModel {
                id: Set(id.clone()),
                path: Set(path.clone()),
                name: Set(name.clone()),
                last_opened: Set(now),
                created_at: Set(now),
                color: Set(assigned_color.clone()),
                sort_order: Set(0),
                icon_path: Set(None),
            };

            Project::insert(project).exec(&txn).await?;
            txn.commit().await?;

            tracing::info!(
                id = %id,
                path = %path,
                color = %assigned_color,
                "Project created"
            );
            let show_external_cli_sessions =
                Self::load_project_config(&path).external_cli_sessions.show;

            ProjectRow {
                id,
                path,
                name,
                last_opened: now.to_rfc3339(),
                created_at: now.to_rfc3339(),
                color: assigned_color,
                sort_order: 0,
                icon_path: None,
                show_external_cli_sessions,
            }
        };

        Ok(project_row)
    }

    /// Get project by path.
    pub async fn get_by_path(db: &DbConn, path: &str) -> Result<Option<ProjectRow>> {
        tracing::debug!(
            path = %path,
            "Loading project by path"
        );

        let model = Project::find()
            .filter(crate::db::entities::project::Column::Path.eq(path))
            .one(db)
            .await?;

        match &model {
            Some(_) => tracing::debug!(
                path = %path,
                "Project found"
            ),
            None => tracing::debug!(
                path = %path,
                "Project not found"
            ),
        }

        Ok(model.map(Self::row_from_model))
    }

    /// Get all projects, ordered by persisted sidebar order.
    pub async fn get_all(db: &DbConn) -> Result<Vec<ProjectRow>> {
        tracing::debug!("Loading all projects");

        let models = Project::find()
            .order_by_asc(crate::db::entities::project::Column::SortOrder)
            .order_by_desc(crate::db::entities::project::Column::CreatedAt)
            .all(db)
            .await?;

        let count = models.len();
        tracing::debug!(
            count = %count,
            "Loaded projects"
        );

        Ok(models
            .into_iter()
            .map(Self::row_from_model_without_config)
            .collect())
    }

    /// Get all project paths without reading per-project config files.
    pub async fn get_all_paths(db: &DbConn) -> Result<Vec<String>> {
        tracing::debug!("Loading project paths");

        let paths = Project::find()
            .select_only()
            .column(crate::db::entities::project::Column::Path)
            .order_by_asc(crate::db::entities::project::Column::SortOrder)
            .order_by_desc(crate::db::entities::project::Column::CreatedAt)
            .into_tuple::<String>()
            .all(db)
            .await?;

        tracing::debug!(
            count = %paths.len(),
            "Loaded project paths"
        );

        Ok(paths)
    }

    /// Get recent projects (limit to N, ordered by last_opened).
    pub async fn get_recent(db: &DbConn, limit: u64) -> Result<Vec<ProjectRow>> {
        Self::get_recent_page(db, limit, 0).await
    }

    pub async fn get_recent_page(db: &DbConn, limit: u64, offset: u64) -> Result<Vec<ProjectRow>> {
        tracing::debug!(
            limit = %limit,
            "Loading recent projects"
        );

        let models = Project::find()
            .order_by_desc(crate::db::entities::project::Column::LastOpened)
            .limit(limit)
            .offset(offset)
            .all(db)
            .await?;

        let count = models.len();
        tracing::debug!(
            count = %count,
            "Loaded recent projects"
        );

        Ok(models
            .into_iter()
            .map(Self::row_from_model_without_config)
            .collect())
    }

    pub async fn get_recent_with_preferred_paths(
        db: &DbConn,
        limit: u64,
        offset: u64,
        preferred_paths: &[String],
    ) -> Result<Vec<ProjectRow>> {
        if offset > 0 {
            return Self::get_recent_page(db, limit, offset).await;
        }
        let mut rows = Vec::new();
        if !preferred_paths.is_empty() {
            let preferred_models = Project::find()
                .filter(crate::db::entities::project::Column::Path.is_in(preferred_paths.to_vec()))
                .all(db)
                .await?;
            let mut by_path = preferred_models
                .into_iter()
                .map(|model| (model.path.clone(), model))
                .collect::<std::collections::HashMap<_, _>>();
            for path in preferred_paths {
                if let Some(model) = by_path.remove(path) {
                    rows.push(Self::row_from_model_without_config(model));
                }
            }
        }
        let preferred = rows
            .iter()
            .map(|row| row.path.clone())
            .collect::<std::collections::HashSet<_>>();
        let recent = Self::get_recent(db, limit).await?;
        for row in recent {
            if rows.len() >= limit as usize {
                break;
            }
            if !preferred.contains(&row.path) {
                rows.push(row);
            }
        }
        rows.truncate(limit as usize);
        Ok(rows)
    }

    pub async fn get_external_hidden_paths(
        db: &DbConn,
        project_paths: &[String],
    ) -> Result<std::collections::HashSet<String>> {
        let mut hidden_paths = std::collections::HashSet::new();

        for project_path in project_paths {
            if let Some(project) = Self::get_by_path(db, project_path).await? {
                if !project.show_external_cli_sessions {
                    hidden_paths.insert(project.path);
                }
            }
        }

        Ok(hidden_paths)
    }

    pub async fn update_icon_path(
        db: &DbConn,
        path: &str,
        icon_path: Option<String>,
    ) -> Result<ProjectRow> {
        let existing = Project::find()
            .filter(crate::db::entities::project::Column::Path.eq(path))
            .one(db)
            .await?;

        let Some(existing_model) = existing else {
            anyhow::bail!("Project not found: {}", path);
        };

        let mut active: crate::db::entities::project::ActiveModel = existing_model.into();
        active.icon_path = Set(icon_path);

        let updated = active.update(db).await?;
        Ok(Self::row_from_model(updated))
    }

    pub async fn reorder(db: &DbConn, ordered_paths: &[String]) -> Result<Vec<ProjectRow>> {
        let txn = db.begin().await?;
        let existing = Project::find().all(&txn).await?;
        if existing.len() != ordered_paths.len() {
            anyhow::bail!("Project order update requires all projects");
        }

        let existing_paths = existing
            .iter()
            .map(|project| project.path.clone())
            .collect::<std::collections::BTreeSet<_>>();
        let requested_paths = ordered_paths
            .iter()
            .cloned()
            .collect::<std::collections::BTreeSet<_>>();

        if existing_paths != requested_paths {
            anyhow::bail!("Project order update paths do not match stored projects");
        }

        for (index, path) in ordered_paths.iter().enumerate() {
            let project = Project::find()
                .filter(crate::db::entities::project::Column::Path.eq(path))
                .one(&txn)
                .await?;

            let Some(project_model) = project else {
                anyhow::bail!("Project not found during reorder: {}", path);
            };

            let mut active: crate::db::entities::project::ActiveModel = project_model.into();
            active.sort_order = Set(index as i32);
            active.update(&txn).await?;
        }
        txn.commit().await?;

        Self::get_all(db).await
    }

    /// Delete a project by path.
    pub async fn delete(db: &DbConn, path: &str) -> Result<()> {
        tracing::debug!(
            path = %path,
            "Deleting project"
        );

        let txn = db.begin().await?;
        let existing = Project::find()
            .filter(crate::db::entities::project::Column::Path.eq(path))
            .one(&txn)
            .await?;

        let Some(existing_model) = existing else {
            return Ok(());
        };

        let deleted_sort_order = existing_model.sort_order;

        Project::delete_many()
            .filter(crate::db::entities::project::Column::Path.eq(path))
            .exec(&txn)
            .await?;

        let shift_statement = format!(
            "UPDATE projects SET sort_order = sort_order - 1 WHERE sort_order > {}",
            deleted_sort_order
        );
        txn.execute_unprepared(&shift_statement).await?;
        txn.commit().await?;

        tracing::info!(
            path = %path,
            "Project deleted successfully"
        );
        Ok(())
    }

    /// Get the total count of projects.
    pub async fn count(db: &DbConn) -> Result<u64> {
        tracing::debug!("Counting projects");

        let count = Project::find().count(db).await?;

        tracing::debug!(count = %count, "Project count retrieved");
        Ok(count)
    }
}
