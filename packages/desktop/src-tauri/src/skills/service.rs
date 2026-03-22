//! Skills service for file system operations.
//!
//! Manages reading, writing, and watching skill files across multiple
//! AI agent directories (Claude Code, Cursor, Codex, OpenCode).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::skills::parser::{generate_skill_content, parse_skill_content};
use crate::skills::plugins::PluginDiscovery;
use crate::skills::types::{PluginInfo, PluginSkill, Skill, SkillAgent, SkillTreeNode};

/// Agent configuration with ID, name, and skills directory path.
#[derive(Debug, Clone)]
struct AgentConfig {
    id: String,
    name: String,
    skills_dir: PathBuf,
}

/// Service for managing skills across AI agents.
pub struct SkillsService {
    /// Cached agent configurations
    agents: HashMap<String, AgentConfig>,
    /// File watcher state (managed externally via commands)
    #[allow(dead_code)]
    watcher_active: Arc<Mutex<bool>>,
    /// Plugin discovery service
    plugin_discovery: PluginDiscovery,
}

impl SkillsService {
    /// Create a new SkillsService with default agent configurations.
    pub fn new() -> Self {
        let mut agents = HashMap::new();

        if let Some(home) = dirs::home_dir() {
            // Claude Code: ~/.claude/skills/
            agents.insert(
                "claude-code".to_string(),
                AgentConfig {
                    id: "claude-code".to_string(),
                    name: "Claude Code".to_string(),
                    skills_dir: home.join(".claude").join("skills"),
                },
            );

            // Cursor: ~/.cursor/skills/
            agents.insert(
                "cursor".to_string(),
                AgentConfig {
                    id: "cursor".to_string(),
                    name: "Cursor".to_string(),
                    skills_dir: home.join(".cursor").join("skills"),
                },
            );

            // Codex: ~/.codex/skills/
            agents.insert(
                "codex".to_string(),
                AgentConfig {
                    id: "codex".to_string(),
                    name: "Codex".to_string(),
                    skills_dir: home.join(".codex").join("skills"),
                },
            );

            // OpenCode: ~/.opencode/skills/
            agents.insert(
                "opencode".to_string(),
                AgentConfig {
                    id: "opencode".to_string(),
                    name: "OpenCode".to_string(),
                    skills_dir: home.join(".opencode").join("skills"),
                },
            );
        }

        Self {
            agents,
            watcher_active: Arc::new(Mutex::new(false)),
            plugin_discovery: PluginDiscovery::new(),
        }
    }

    /// Get the list of configured agents with their existence status.
    pub fn get_agents(&self) -> Vec<SkillAgent> {
        self.agents
            .values()
            .map(|config| SkillAgent {
                id: config.id.clone(),
                name: config.name.clone(),
                skills_dir: config.skills_dir.to_string_lossy().to_string(),
                exists: config.skills_dir.exists(),
            })
            .collect()
    }

    /// Get skills directory paths for file watching.
    pub fn get_watch_paths(&self) -> Vec<PathBuf> {
        self.agents
            .values()
            .map(|config| config.skills_dir.clone())
            .filter(|path| path.exists())
            .collect()
    }

    /// Build a tree structure of agents and their skills.
    pub async fn get_skills_tree(&self) -> Result<Vec<SkillTreeNode>, String> {
        let mut tree = Vec::new();

        // Add plugins section first
        let plugins = self.plugin_discovery.discover_plugins().await?;
        if !plugins.is_empty() {
            let mut plugin_children = Vec::new();

            for plugin in plugins {
                let skills = self.plugin_discovery.list_plugin_skills(&plugin.id).await?;

                let skill_children: Vec<SkillTreeNode> = skills
                    .into_iter()
                    .map(|skill| SkillTreeNode {
                        id: skill.id.clone(),
                        label: skill.name.clone(),
                        node_type: "plugin-skill".to_string(),
                        agent_id: plugin.id.clone(), // Reuse field for plugin_id
                        children: vec![],
                        is_expandable: false,
                    })
                    .collect();

                plugin_children.push(SkillTreeNode {
                    id: plugin.id.clone(),
                    label: format!("{} (v{})", plugin.name, plugin.version),
                    node_type: "plugin".to_string(),
                    agent_id: plugin.id.clone(),
                    children: skill_children,
                    is_expandable: true,
                });
            }

            tree.push(SkillTreeNode {
                id: "plugins".to_string(),
                label: "Plugins".to_string(),
                node_type: "plugins-section".to_string(),
                agent_id: "plugins".to_string(),
                children: plugin_children,
                is_expandable: true,
            });
        }

        // Sort agents by name for consistent ordering
        let mut agent_configs: Vec<_> = self.agents.values().collect();
        agent_configs.sort_by(|a, b| a.name.cmp(&b.name));

        for config in agent_configs {
            let skills = self.list_skills_for_agent(&config.id).await?;

            let children: Vec<SkillTreeNode> = skills
                .into_iter()
                .map(|skill| SkillTreeNode {
                    id: skill.id.clone(),
                    label: skill.name.clone(),
                    node_type: "skill".to_string(),
                    agent_id: config.id.clone(),
                    children: vec![],
                    is_expandable: false,
                })
                .collect();

            tree.push(SkillTreeNode {
                id: config.id.clone(),
                label: config.name.clone(),
                node_type: "agent".to_string(),
                agent_id: config.id.clone(),
                children,
                is_expandable: true,
            });
        }

        Ok(tree)
    }

    /// List all skills for a specific agent.
    pub async fn list_skills_for_agent(&self, agent_id: &str) -> Result<Vec<Skill>, String> {
        let config = self
            .agents
            .get(agent_id)
            .ok_or_else(|| format!("Unknown agent: {}", agent_id))?;

        if !config.skills_dir.exists() {
            return Ok(vec![]);
        }

        let mut skills = Vec::new();

        // Read the skills directory
        let entries = tokio::fs::read_dir(&config.skills_dir)
            .await
            .map_err(|e| format!("Failed to read skills directory: {}", e))?;

        // Collect entries into a Vec
        let mut dir_entries = Vec::new();
        let mut entries = entries;
        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|e| format!("Failed to read directory entry: {}", e))?
        {
            dir_entries.push(entry);
        }

        // Sort entries alphabetically
        dir_entries.sort_by_key(|a| a.file_name());

        for entry in dir_entries {
            let path = entry.path();

            // Skip non-directories and hidden folders
            if !path.is_dir() {
                continue;
            }

            let folder_name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();

            if folder_name.starts_with('.') {
                continue;
            }

            // Look for SKILL.md in the folder
            let skill_md_path = path.join("SKILL.md");
            if !skill_md_path.exists() {
                continue;
            }

            match self
                .load_skill_from_path(&skill_md_path, agent_id, &folder_name)
                .await
            {
                Ok(skill) => skills.push(skill),
                Err(e) => {
                    tracing::warn!(
                        agent_id = %agent_id,
                        folder = %folder_name,
                        error = %e,
                        "Failed to load skill"
                    );
                }
            }
        }

        Ok(skills)
    }

    /// Load a skill from a SKILL.md file path.
    async fn load_skill_from_path(
        &self,
        path: &PathBuf,
        agent_id: &str,
        folder_name: &str,
    ) -> Result<Skill, String> {
        let content = tokio::fs::read_to_string(path)
            .await
            .map_err(|e| format!("Failed to read skill file: {}", e))?;

        let (metadata, _body) = parse_skill_content(&content)?;

        let modified_at = tokio::fs::metadata(path)
            .await
            .map(|m| {
                m.modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0)
            })
            .unwrap_or(0);

        Ok(Skill {
            id: format!("{}::{}", agent_id, folder_name),
            agent_id: agent_id.to_string(),
            folder_name: folder_name.to_string(),
            path: path.to_string_lossy().to_string(),
            name: metadata.name,
            description: metadata.description,
            content,
            modified_at,
        })
    }

    /// Get a specific skill by ID.
    pub async fn get_skill(&self, skill_id: &str) -> Result<Skill, String> {
        let parts: Vec<&str> = skill_id.split("::").collect();
        if parts.len() != 2 {
            return Err(format!("Invalid skill ID format: {}", skill_id));
        }

        let agent_id = parts[0];
        let folder_name = parts[1];

        let config = self
            .agents
            .get(agent_id)
            .ok_or_else(|| format!("Unknown agent: {}", agent_id))?;

        let skill_md_path = config.skills_dir.join(folder_name).join("SKILL.md");

        if !skill_md_path.exists() {
            return Err(format!("Skill not found: {}", skill_id));
        }

        self.load_skill_from_path(&skill_md_path, agent_id, folder_name)
            .await
    }

    /// Create a new skill.
    pub async fn create_skill(
        &self,
        agent_id: &str,
        folder_name: &str,
        name: &str,
        description: &str,
    ) -> Result<Skill, String> {
        let config = self
            .agents
            .get(agent_id)
            .ok_or_else(|| format!("Unknown agent: {}", agent_id))?;

        // Ensure skills directory exists
        if !config.skills_dir.exists() {
            tokio::fs::create_dir_all(&config.skills_dir)
                .await
                .map_err(|e| format!("Failed to create skills directory: {}", e))?;
        }

        let skill_dir = config.skills_dir.join(folder_name);

        // Check if skill already exists
        if skill_dir.exists() {
            return Err(format!("Skill already exists: {}", folder_name));
        }

        // Create skill directory
        tokio::fs::create_dir(&skill_dir)
            .await
            .map_err(|e| format!("Failed to create skill directory: {}", e))?;

        // Generate initial content
        let body = format!("# {}\n\nAdd your skill instructions here...", name);
        let content = generate_skill_content(name, description, &body);

        // Write SKILL.md
        let skill_md_path = skill_dir.join("SKILL.md");
        tokio::fs::write(&skill_md_path, &content)
            .await
            .map_err(|e| format!("Failed to write SKILL.md: {}", e))?;

        // Return the created skill
        self.load_skill_from_path(&skill_md_path, agent_id, folder_name)
            .await
    }

    /// Update an existing skill's content.
    pub async fn update_skill(&self, skill_id: &str, content: &str) -> Result<Skill, String> {
        let parts: Vec<&str> = skill_id.split("::").collect();
        if parts.len() != 2 {
            return Err(format!("Invalid skill ID format: {}", skill_id));
        }

        let agent_id = parts[0];
        let folder_name = parts[1];

        let config = self
            .agents
            .get(agent_id)
            .ok_or_else(|| format!("Unknown agent: {}", agent_id))?;

        let skill_md_path = config.skills_dir.join(folder_name).join("SKILL.md");

        if !skill_md_path.exists() {
            return Err(format!("Skill not found: {}", skill_id));
        }

        // Validate content has valid frontmatter
        parse_skill_content(content)?;

        // Write updated content
        tokio::fs::write(&skill_md_path, content)
            .await
            .map_err(|e| format!("Failed to write SKILL.md: {}", e))?;

        // Return updated skill
        self.load_skill_from_path(&skill_md_path, agent_id, folder_name)
            .await
    }

    /// Delete a skill.
    pub async fn delete_skill(&self, skill_id: &str) -> Result<(), String> {
        let parts: Vec<&str> = skill_id.split("::").collect();
        if parts.len() != 2 {
            return Err(format!("Invalid skill ID format: {}", skill_id));
        }

        let agent_id = parts[0];
        let folder_name = parts[1];

        let config = self
            .agents
            .get(agent_id)
            .ok_or_else(|| format!("Unknown agent: {}", agent_id))?;

        let skill_dir = config.skills_dir.join(folder_name);

        if !skill_dir.exists() {
            return Err(format!("Skill not found: {}", skill_id));
        }

        // Remove the entire skill directory
        tokio::fs::remove_dir_all(&skill_dir)
            .await
            .map_err(|e| format!("Failed to delete skill: {}", e))?;

        Ok(())
    }

    /// Copy a skill to another agent.
    pub async fn copy_skill(
        &self,
        skill_id: &str,
        target_agent_id: &str,
        new_folder_name: Option<&str>,
    ) -> Result<Skill, String> {
        // Get the source skill
        let source_skill = self.get_skill(skill_id).await?;

        // Determine target folder name
        let folder_name = new_folder_name.unwrap_or(&source_skill.folder_name);

        let target_config = self
            .agents
            .get(target_agent_id)
            .ok_or_else(|| format!("Unknown agent: {}", target_agent_id))?;

        // Ensure target skills directory exists
        if !target_config.skills_dir.exists() {
            tokio::fs::create_dir_all(&target_config.skills_dir)
                .await
                .map_err(|e| format!("Failed to create skills directory: {}", e))?;
        }

        let target_skill_dir = target_config.skills_dir.join(folder_name);

        // Check if target already exists
        if target_skill_dir.exists() {
            return Err(format!(
                "Skill already exists in {}: {}",
                target_agent_id, folder_name
            ));
        }

        // Create target skill directory
        tokio::fs::create_dir(&target_skill_dir)
            .await
            .map_err(|e| format!("Failed to create skill directory: {}", e))?;

        // Copy SKILL.md
        let target_skill_md = target_skill_dir.join("SKILL.md");
        tokio::fs::write(&target_skill_md, &source_skill.content)
            .await
            .map_err(|e| format!("Failed to write SKILL.md: {}", e))?;

        // Return the new skill
        self.load_skill_from_path(&target_skill_md, target_agent_id, folder_name)
            .await
    }

    // ========================================================================
    // Plugin Skills Methods
    // ========================================================================

    /// Get all discovered plugins.
    pub async fn get_plugins(&self) -> Result<Vec<PluginInfo>, String> {
        self.plugin_discovery.discover_plugins().await
    }

    /// Get all skills for a specific plugin.
    pub async fn get_plugin_skills(&self, plugin_id: &str) -> Result<Vec<PluginSkill>, String> {
        self.plugin_discovery.list_plugin_skills(plugin_id).await
    }

    /// Get a specific plugin skill by ID.
    pub async fn get_plugin_skill(&self, skill_id: &str) -> Result<PluginSkill, String> {
        self.plugin_discovery.get_plugin_skill(skill_id).await
    }

    /// Copy a plugin skill to the user's library.
    /// Creates a new skill in the specified agent directory.
    pub async fn copy_plugin_skill_to_library(
        &self,
        skill_id: &str,
        target_agent_id: &str,
    ) -> Result<Skill, String> {
        // Get the plugin skill
        let plugin_skill = self.plugin_discovery.get_plugin_skill(skill_id).await?;

        // Get target agent config
        let target_config = self
            .agents
            .get(target_agent_id)
            .ok_or_else(|| format!("Unknown agent: {}", target_agent_id))?;

        // Ensure target skills directory exists
        if !target_config.skills_dir.exists() {
            tokio::fs::create_dir_all(&target_config.skills_dir)
                .await
                .map_err(|e| format!("Failed to create skills directory: {}", e))?;
        }

        let target_skill_dir = target_config.skills_dir.join(&plugin_skill.folder_name);

        // Check if target already exists
        if target_skill_dir.exists() {
            return Err(format!(
                "Skill already exists in {}: {}",
                target_agent_id, plugin_skill.folder_name
            ));
        }

        // Create target skill directory
        tokio::fs::create_dir(&target_skill_dir)
            .await
            .map_err(|e| format!("Failed to create skill directory: {}", e))?;

        // Copy SKILL.md
        let target_skill_md = target_skill_dir.join("SKILL.md");
        tokio::fs::write(&target_skill_md, &plugin_skill.content)
            .await
            .map_err(|e| format!("Failed to write SKILL.md: {}", e))?;

        // Return the new skill
        self.load_skill_from_path(&target_skill_md, target_agent_id, &plugin_skill.folder_name)
            .await
    }
}

impl Default for SkillsService {
    fn default() -> Self {
        Self::new()
    }
}
