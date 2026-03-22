//! Sync engine for unified skills library.
//!
//! Handles syncing skills from SQLite database to agent directories.

use std::collections::HashMap;
use std::path::PathBuf;

use anyhow::{Context, Result};
use sea_orm::DbConn;
use sha2::{Digest, Sha256};

use crate::db::repository::{SkillRow, SkillsRepository};
use crate::skills::types::{AgentConfig, SkillSyncResult, SyncResult, SyncTarget};

/// Get the list of supported agents with their configurations.
pub fn get_agent_configs() -> Vec<AgentConfig> {
    vec![
        AgentConfig {
            id: "claude-code".to_string(),
            name: "Claude Code".to_string(),
            skills_dir_pattern: "~/.claude/skills".to_string(),
            skill_filename: "SKILL.md".to_string(),
        },
        AgentConfig {
            id: "cursor".to_string(),
            name: "Cursor".to_string(),
            skills_dir_pattern: "~/.cursor/skills".to_string(),
            skill_filename: "SKILL.md".to_string(),
        },
        AgentConfig {
            id: "codex".to_string(),
            name: "Codex".to_string(),
            skills_dir_pattern: "~/.codex/skills".to_string(),
            skill_filename: "SKILL.md".to_string(),
        },
        AgentConfig {
            id: "opencode".to_string(),
            name: "OpenCode".to_string(),
            skills_dir_pattern: "~/.opencode/skills".to_string(),
            skill_filename: "SKILL.md".to_string(),
        },
    ]
}

/// Resolve a path pattern (expanding ~) to an absolute path.
fn resolve_path(pattern: &str) -> Option<PathBuf> {
    if pattern.starts_with("~/") {
        dirs::home_dir().map(|home| home.join(&pattern[2..]))
    } else {
        Some(PathBuf::from(pattern))
    }
}

/// Calculate SHA256 hash of content.
fn content_hash(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// Convert skill name to folder name (kebab-case).
pub fn skill_name_to_folder(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

/// Get the skill folder path for a specific agent.
/// Returns None if the agent doesn't exist or the path can't be resolved.
pub fn get_skill_folder_path(agent_id: &str, skill_name: &str) -> Option<String> {
    let configs = get_agent_configs();
    let agent = configs.iter().find(|c| c.id == agent_id)?;
    let base_path = resolve_path(&agent.skills_dir_pattern)?;
    let folder_name = skill_name_to_folder(skill_name);
    let skill_path = base_path.join(&folder_name);
    skill_path.to_str().map(|s| s.to_string())
}

/// Sync engine for skills.
pub struct SyncEngine {
    agents: HashMap<String, AgentConfig>,
}

impl SyncEngine {
    /// Create a new sync engine.
    pub fn new() -> Self {
        let configs = get_agent_configs();
        let agents = configs.into_iter().map(|c| (c.id.clone(), c)).collect();
        Self { agents }
    }

    /// Get sync targets for a skill (all agents with their enabled/status info).
    pub async fn get_sync_targets(&self, db: &DbConn, skill_id: &str) -> Result<Vec<SyncTarget>> {
        let skill = SkillsRepository::get_by_id(db, skill_id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Skill not found: {}", skill_id))?;

        let db_targets = SkillsRepository::get_sync_targets(db, skill_id).await?;
        let db_history = SkillsRepository::get_sync_history(db, skill_id).await?;

        let current_hash = content_hash(&skill.content);

        let mut targets = Vec::new();

        for agent in self.agents.values() {
            let db_target = db_targets.iter().find(|t| t.agent_id == agent.id);
            let db_hist = db_history.iter().find(|h| h.agent_id == agent.id);

            let enabled = db_target.map(|t| t.enabled).unwrap_or(false);

            let (status, synced_at) = match db_hist {
                Some(h) => {
                    if h.content_hash == current_hash {
                        ("synced".to_string(), Some(h.synced_at))
                    } else {
                        ("pending".to_string(), Some(h.synced_at))
                    }
                }
                None => ("never".to_string(), None),
            };

            targets.push(SyncTarget {
                agent_id: agent.id.clone(),
                agent_name: agent.name.clone(),
                enabled,
                status,
                synced_at,
            });
        }

        // Sort by agent name for consistent ordering
        targets.sort_by(|a, b| a.agent_name.cmp(&b.agent_name));

        Ok(targets)
    }

    /// Sync a single skill to a single agent.
    pub async fn sync_skill_to_agent(
        &self,
        db: &DbConn,
        skill: &SkillRow,
        agent_id: &str,
    ) -> Result<SkillSyncResult> {
        let agent = self
            .agents
            .get(agent_id)
            .ok_or_else(|| anyhow::anyhow!("Unknown agent: {}", agent_id))?;

        let skills_dir = resolve_path(&agent.skills_dir_pattern)
            .ok_or_else(|| anyhow::anyhow!("Cannot resolve skills directory for {}", agent_id))?;

        // Ensure skills directory exists
        if !skills_dir.exists() {
            tokio::fs::create_dir_all(&skills_dir)
                .await
                .context("Failed to create skills directory")?;
        }

        // Generate folder name from skill name
        let folder_name = skill_name_to_folder(&skill.name);
        let skill_dir = skills_dir.join(&folder_name);

        // Create skill directory
        if !skill_dir.exists() {
            tokio::fs::create_dir(&skill_dir)
                .await
                .context("Failed to create skill directory")?;
        }

        // Write SKILL.md file
        let skill_file = skill_dir.join(&agent.skill_filename);
        tokio::fs::write(&skill_file, &skill.content)
            .await
            .context("Failed to write skill file")?;

        // Record sync in database
        let hash = content_hash(&skill.content);
        SkillsRepository::record_sync(db, &skill.id, agent_id, &hash).await?;

        tracing::info!(
            skill_id = %skill.id,
            skill_name = %skill.name,
            agent_id = %agent_id,
            path = %skill_file.display(),
            "Skill synced to agent"
        );

        Ok(SkillSyncResult {
            skill_id: skill.id.clone(),
            agent_id: agent_id.to_string(),
            success: true,
            error: None,
        })
    }

    /// Sync a skill to all enabled agents.
    pub async fn sync_skill(&self, db: &DbConn, skill_id: &str) -> Result<Vec<SkillSyncResult>> {
        let skill = SkillsRepository::get_by_id(db, skill_id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Skill not found: {}", skill_id))?;

        let targets = SkillsRepository::get_sync_targets(db, skill_id).await?;

        let mut results = Vec::new();

        for target in targets {
            if !target.enabled {
                continue;
            }

            match self.sync_skill_to_agent(db, &skill, &target.agent_id).await {
                Ok(result) => results.push(result),
                Err(e) => {
                    tracing::error!(
                        skill_id = %skill_id,
                        agent_id = %target.agent_id,
                        error = %e,
                        "Failed to sync skill to agent"
                    );
                    results.push(SkillSyncResult {
                        skill_id: skill_id.to_string(),
                        agent_id: target.agent_id,
                        success: false,
                        error: Some(e.to_string()),
                    });
                }
            }
        }

        Ok(results)
    }

    /// Delete a skill's files from specified agent directories.
    pub async fn delete_skill_from_agents(
        &self,
        _db: &DbConn,
        skill_name: &str,
        agent_ids: &[String],
    ) -> Result<Vec<SkillSyncResult>> {
        let mut results = Vec::new();

        for agent_id in agent_ids {
            let agent = match self.agents.get(agent_id) {
                Some(a) => a,
                None => {
                    results.push(SkillSyncResult {
                        skill_id: String::new(),
                        agent_id: agent_id.clone(),
                        success: false,
                        error: Some(format!("Unknown agent: {}", agent_id)),
                    });
                    continue;
                }
            };

            let skills_dir = match resolve_path(&agent.skills_dir_pattern) {
                Some(p) => p,
                None => {
                    results.push(SkillSyncResult {
                        skill_id: String::new(),
                        agent_id: agent_id.clone(),
                        success: false,
                        error: Some("Cannot resolve skills directory".to_string()),
                    });
                    continue;
                }
            };

            let folder_name = skill_name_to_folder(skill_name);
            let skill_dir = skills_dir.join(&folder_name);

            if skill_dir.exists() {
                match tokio::fs::remove_dir_all(&skill_dir).await {
                    Ok(_) => {
                        tracing::info!(
                            skill_name = %skill_name,
                            agent_id = %agent_id,
                            path = %skill_dir.display(),
                            "Skill deleted from agent"
                        );
                        results.push(SkillSyncResult {
                            skill_id: String::new(),
                            agent_id: agent_id.clone(),
                            success: true,
                            error: None,
                        });
                    }
                    Err(e) => {
                        results.push(SkillSyncResult {
                            skill_id: String::new(),
                            agent_id: agent_id.clone(),
                            success: false,
                            error: Some(e.to_string()),
                        });
                    }
                }
            } else {
                // Directory doesn't exist, consider it a success
                results.push(SkillSyncResult {
                    skill_id: String::new(),
                    agent_id: agent_id.clone(),
                    success: true,
                    error: None,
                });
            }
        }

        Ok(results)
    }

    /// Sync all skills to all enabled agents.
    pub async fn sync_all(&self, db: &DbConn) -> Result<SyncResult> {
        let skills = SkillsRepository::get_all(db).await?;

        let mut all_results = Vec::new();
        let mut synced_count = 0;
        let mut failed_count = 0;

        for skill in skills {
            let targets = SkillsRepository::get_sync_targets(db, &skill.id).await?;

            for target in targets {
                if !target.enabled {
                    continue;
                }

                match self.sync_skill_to_agent(db, &skill, &target.agent_id).await {
                    Ok(result) => {
                        synced_count += 1;
                        all_results.push(result);
                    }
                    Err(e) => {
                        failed_count += 1;
                        all_results.push(SkillSyncResult {
                            skill_id: skill.id.clone(),
                            agent_id: target.agent_id,
                            success: false,
                            error: Some(e.to_string()),
                        });
                    }
                }
            }
        }

        Ok(SyncResult {
            synced_count,
            failed_count,
            results: all_results,
        })
    }

    /// Import existing skills from agent directories into the database.
    /// Used on first run to migrate existing skills.
    pub async fn import_existing_skills(&self, db: &DbConn) -> Result<Vec<SkillRow>> {
        let mut imported = Vec::new();
        let mut seen_names: HashMap<String, bool> = HashMap::new();

        for agent in self.agents.values() {
            let skills_dir = match resolve_path(&agent.skills_dir_pattern) {
                Some(p) if p.exists() => p,
                _ => continue,
            };

            let mut entries = match tokio::fs::read_dir(&skills_dir).await {
                Ok(e) => e,
                Err(_) => continue,
            };

            while let Some(entry) = entries.next_entry().await? {
                let path = entry.path();

                if !path.is_dir() {
                    continue;
                }

                let _folder_name = match path.file_name().and_then(|n| n.to_str()) {
                    Some(n) if !n.starts_with('.') => n.to_string(),
                    _ => continue,
                };

                let skill_file = path.join(&agent.skill_filename);
                if !skill_file.exists() {
                    continue;
                }

                let content = match tokio::fs::read_to_string(&skill_file).await {
                    Ok(c) => c,
                    Err(_) => continue,
                };

                // Parse frontmatter to get name and description
                let (metadata, _) = match crate::skills::parser::parse_skill_content(&content) {
                    Ok(m) => m,
                    Err(_) => continue,
                };

                // Skip if we've already imported a skill with this name
                if seen_names.contains_key(&metadata.name) {
                    tracing::debug!(
                        name = %metadata.name,
                        agent = %agent.id,
                        "Skipping duplicate skill"
                    );
                    continue;
                }

                seen_names.insert(metadata.name.clone(), true);

                // Create skill in database
                let skill = SkillsRepository::create(
                    db,
                    metadata.name.clone(),
                    Some(metadata.description),
                    content,
                    None,
                )
                .await?;

                // Enable sync target for the source agent
                SkillsRepository::set_sync_target(db, &skill.id, &agent.id, true).await?;

                // Record initial sync (content is already there)
                let hash = content_hash(&skill.content);
                SkillsRepository::record_sync(db, &skill.id, &agent.id, &hash).await?;

                tracing::info!(
                    skill_id = %skill.id,
                    skill_name = %skill.name,
                    source_agent = %agent.id,
                    "Imported skill from agent directory"
                );

                imported.push(skill);
            }
        }

        Ok(imported)
    }
}

impl Default for SyncEngine {
    fn default() -> Self {
        Self::new()
    }
}
