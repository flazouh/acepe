//! Tauri commands for the Skills Manager feature.

use sea_orm::DbConn;
use std::sync::Arc;
use tauri::{AppHandle, State};

use crate::db::repository::SkillsRepository;
use crate::skills::service::SkillsService;
use crate::skills::sync::SyncEngine;
use crate::skills::types::{
    LibrarySkill, LibrarySkillWithSync, PluginInfo, PluginSkill, Skill, SkillTreeNode, SyncResult,
    SyncTarget,
};

/// List all agents and their skills as a tree structure.
#[tauri::command]
#[specta::specta]
pub async fn skills_list_tree(
    service: State<'_, Arc<SkillsService>>,
) -> Result<Vec<SkillTreeNode>, String> {
    service.get_skills_tree().await
}

/// Get a specific skill by ID.
#[tauri::command]
#[specta::specta]
pub async fn skills_get(
    service: State<'_, Arc<SkillsService>>,
    skill_id: String,
) -> Result<Skill, String> {
    service.get_skill(&skill_id).await
}

/// Create a new skill.
#[tauri::command]
#[specta::specta]
pub async fn skills_create(
    service: State<'_, Arc<SkillsService>>,
    agent_id: String,
    folder_name: String,
    name: String,
    description: String,
) -> Result<Skill, String> {
    service
        .create_skill(&agent_id, &folder_name, &name, &description)
        .await
}

/// Update an existing skill's content.
#[tauri::command]
#[specta::specta]
pub async fn skills_update(
    service: State<'_, Arc<SkillsService>>,
    skill_id: String,
    content: String,
) -> Result<Skill, String> {
    service.update_skill(&skill_id, &content).await
}

/// Delete a skill.
#[tauri::command]
#[specta::specta]
pub async fn skills_delete(
    service: State<'_, Arc<SkillsService>>,
    skill_id: String,
) -> Result<(), String> {
    service.delete_skill(&skill_id).await
}

/// Copy a skill to another agent.
#[tauri::command]
#[specta::specta]
pub async fn skills_copy_to(
    service: State<'_, Arc<SkillsService>>,
    skill_id: String,
    target_agent_id: String,
    new_folder_name: Option<String>,
) -> Result<Skill, String> {
    service
        .copy_skill(&skill_id, &target_agent_id, new_folder_name.as_deref())
        .await
}

/// Start watching for skill file changes.
/// Emits "skills:changed" events when files are modified.
#[tauri::command]
#[specta::specta]
pub async fn skills_start_watching(
    _app: AppHandle,
    _service: State<'_, Arc<SkillsService>>,
) -> Result<(), String> {
    // File watching implementation is deferred to Phase 4
    // For now, this is a no-op placeholder
    tracing::info!("skills_start_watching called (placeholder)");
    Ok(())
}

/// Stop watching for skill file changes.
#[tauri::command]
#[specta::specta]
pub async fn skills_stop_watching(_service: State<'_, Arc<SkillsService>>) -> Result<(), String> {
    // File watching implementation is deferred to Phase 4
    tracing::info!("skills_stop_watching called (placeholder)");
    Ok(())
}

// ============================================================================
// Unified Skills Library Commands
// ============================================================================

/// Get all skills from the library.
#[tauri::command]
#[specta::specta]
pub async fn library_skills_list(db: State<'_, DbConn>) -> Result<Vec<LibrarySkill>, String> {
    let skills = SkillsRepository::get_all(&db)
        .await
        .map_err(|e| e.to_string())?;

    Ok(skills
        .into_iter()
        .map(|s| LibrarySkill {
            id: s.id,
            name: s.name,
            description: s.description,
            content: s.content,
            category: s.category,
            created_at: s.created_at,
            updated_at: s.updated_at,
        })
        .collect())
}

/// Get all skills with their sync status.
#[tauri::command]
#[specta::specta]
pub async fn library_skills_list_with_sync(
    db: State<'_, DbConn>,
) -> Result<Vec<LibrarySkillWithSync>, String> {
    let sync_engine = SyncEngine::new();
    let skills = SkillsRepository::get_all(&db)
        .await
        .map_err(|e| e.to_string())?;

    let mut result = Vec::with_capacity(skills.len());

    for skill in skills {
        let sync_targets = sync_engine
            .get_sync_targets(&db, &skill.id)
            .await
            .map_err(|e| e.to_string())?;

        let has_pending_changes = sync_targets
            .iter()
            .any(|t| t.enabled && t.status == "pending");

        result.push(LibrarySkillWithSync {
            skill: LibrarySkill {
                id: skill.id,
                name: skill.name,
                description: skill.description,
                content: skill.content,
                category: skill.category,
                created_at: skill.created_at,
                updated_at: skill.updated_at,
            },
            sync_targets,
            has_pending_changes,
        });
    }

    Ok(result)
}

/// Get a single skill with its sync status.
#[tauri::command]
#[specta::specta]
pub async fn library_skill_get(
    db: State<'_, DbConn>,
    skill_id: String,
) -> Result<LibrarySkillWithSync, String> {
    let sync_engine = SyncEngine::new();

    let skill = SkillsRepository::get_by_id(&db, &skill_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Skill not found: {}", skill_id))?;

    let sync_targets = sync_engine
        .get_sync_targets(&db, &skill_id)
        .await
        .map_err(|e| e.to_string())?;

    let has_pending_changes = sync_targets
        .iter()
        .any(|t| t.enabled && t.status == "pending");

    Ok(LibrarySkillWithSync {
        skill: LibrarySkill {
            id: skill.id,
            name: skill.name,
            description: skill.description,
            content: skill.content,
            category: skill.category,
            created_at: skill.created_at,
            updated_at: skill.updated_at,
        },
        sync_targets,
        has_pending_changes,
    })
}

/// Create a new skill in the library.
#[tauri::command]
#[specta::specta]
pub async fn library_skill_create(
    _app: AppHandle,
    db: State<'_, DbConn>,
    name: String,
    description: Option<String>,
    content: String,
    category: Option<String>,
) -> Result<LibrarySkill, String> {
    let skill = SkillsRepository::create(&db, name, description, content, category)
        .await
        .map_err(|e| e.to_string())?;

    Ok(LibrarySkill {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        content: skill.content,
        category: skill.category,
        created_at: skill.created_at,
        updated_at: skill.updated_at,
    })
}

/// Update a skill in the library.
#[tauri::command]
#[specta::specta]
pub async fn library_skill_update(
    db: State<'_, DbConn>,
    skill_id: String,
    name: Option<String>,
    description: Option<Option<String>>,
    content: Option<String>,
    category: Option<Option<String>>,
) -> Result<LibrarySkill, String> {
    let skill = SkillsRepository::update(&db, &skill_id, name, description, content, category)
        .await
        .map_err(|e| e.to_string())?;

    Ok(LibrarySkill {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        content: skill.content,
        category: skill.category,
        created_at: skill.created_at,
        updated_at: skill.updated_at,
    })
}

/// Delete a skill from the library.
#[tauri::command]
#[specta::specta]
pub async fn library_skill_delete(db: State<'_, DbConn>, skill_id: String) -> Result<(), String> {
    SkillsRepository::delete(&db, &skill_id)
        .await
        .map_err(|e| e.to_string())
}

/// Get sync targets for a skill.
#[tauri::command]
#[specta::specta]
pub async fn library_skill_get_sync_targets(
    db: State<'_, DbConn>,
    skill_id: String,
) -> Result<Vec<SyncTarget>, String> {
    let sync_engine = SyncEngine::new();
    sync_engine
        .get_sync_targets(&db, &skill_id)
        .await
        .map_err(|e| e.to_string())
}

/// Set sync target enabled/disabled for a skill.
#[tauri::command]
#[specta::specta]
pub async fn library_skill_set_sync_target(
    db: State<'_, DbConn>,
    skill_id: String,
    agent_id: String,
    enabled: bool,
) -> Result<(), String> {
    SkillsRepository::set_sync_target(&db, &skill_id, &agent_id, enabled)
        .await
        .map_err(|e| e.to_string())
}

/// Sync a single skill to all enabled agents.
#[tauri::command]
#[specta::specta]
pub async fn library_skill_sync(
    db: State<'_, DbConn>,
    skill_id: String,
) -> Result<Vec<crate::skills::types::SkillSyncResult>, String> {
    let sync_engine = SyncEngine::new();
    sync_engine
        .sync_skill(&db, &skill_id)
        .await
        .map_err(|e| e.to_string())
}

/// Sync all skills to all enabled agents.
#[tauri::command]
#[specta::specta]
pub async fn library_sync_all(db: State<'_, DbConn>) -> Result<SyncResult, String> {
    let sync_engine = SyncEngine::new();
    sync_engine.sync_all(&db).await.map_err(|e| e.to_string())
}

/// Check if the library is empty (first run detection).
#[tauri::command]
#[specta::specta]
pub async fn library_is_empty(db: State<'_, DbConn>) -> Result<bool, String> {
    SkillsRepository::is_empty(&db)
        .await
        .map_err(|e| e.to_string())
}

/// Import existing skills from agent directories into the library.
#[tauri::command]
#[specta::specta]
pub async fn library_import_existing(db: State<'_, DbConn>) -> Result<Vec<LibrarySkill>, String> {
    let sync_engine = SyncEngine::new();
    let imported = sync_engine
        .import_existing_skills(&db)
        .await
        .map_err(|e| e.to_string())?;

    Ok(imported
        .into_iter()
        .map(|s| LibrarySkill {
            id: s.id,
            name: s.name,
            description: s.description,
            content: s.content,
            category: s.category,
            created_at: s.created_at,
            updated_at: s.updated_at,
        })
        .collect())
}

/// Get the skill folder path for a specific agent.
#[tauri::command]
#[specta::specta]
pub async fn library_skill_get_folder_path(
    agent_id: String,
    skill_name: String,
) -> Result<Option<String>, String> {
    Ok(crate::skills::sync::get_skill_folder_path(
        &agent_id,
        &skill_name,
    ))
}

/// Delete skill files from specified agent directories.
#[tauri::command]
#[specta::specta]
pub async fn library_skill_delete_from_agents(
    db: State<'_, DbConn>,
    skill_name: String,
    agent_ids: Vec<String>,
) -> Result<Vec<crate::skills::types::SkillSyncResult>, String> {
    let sync_engine = SyncEngine::new();
    sync_engine
        .delete_skill_from_agents(&db, &skill_name, &agent_ids)
        .await
        .map_err(|e| e.to_string())
}

// ============================================================================
// Plugin Skills Commands
// ============================================================================

/// List all discovered plugins with skills.
#[tauri::command]
#[specta::specta]
pub async fn skills_list_plugins(
    service: State<'_, Arc<SkillsService>>,
) -> Result<Vec<PluginInfo>, String> {
    service.get_plugins().await
}

/// List all skills for a specific plugin.
#[tauri::command]
#[specta::specta]
pub async fn skills_list_plugin_skills(
    service: State<'_, Arc<SkillsService>>,
    plugin_id: String,
) -> Result<Vec<PluginSkill>, String> {
    service.get_plugin_skills(&plugin_id).await
}

/// Get a specific plugin skill by ID.
#[tauri::command]
#[specta::specta]
pub async fn skills_get_plugin_skill(
    service: State<'_, Arc<SkillsService>>,
    skill_id: String,
) -> Result<PluginSkill, String> {
    service.get_plugin_skill(&skill_id).await
}

/// Copy a plugin skill to a user's agent directory.
#[tauri::command]
#[specta::specta]
pub async fn skills_copy_plugin_skill_to_agent(
    service: State<'_, Arc<SkillsService>>,
    skill_id: String,
    target_agent_id: String,
) -> Result<Skill, String> {
    service
        .copy_plugin_skill_to_library(&skill_id, &target_agent_id)
        .await
}
