//! Types for the Skills Manager feature.
//!
//! These types represent skills that can be managed across different AI agents
//! (Claude Code, Cursor, Codex). Skills are stored as SKILL.md files with
//! YAML frontmatter containing name and description.

use serde::{Deserialize, Serialize};

/// Represents an AI agent that can have skills.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SkillAgent {
    /// Agent identifier (claude-code, cursor, codex)
    pub id: String,
    /// Display name for the agent
    pub name: String,
    /// Full path to the skills directory
    pub skills_dir: String,
    /// Whether the skills directory exists on disk
    pub exists: bool,
}

/// A skill with its metadata and content.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    /// Unique identifier in format "agent_id::folder_name"
    pub id: String,
    /// Agent this skill belongs to
    pub agent_id: String,
    /// Skill folder name (without path)
    pub folder_name: String,
    /// Full path to the SKILL.md file
    pub path: String,
    /// Skill name from frontmatter
    pub name: String,
    /// Description from frontmatter
    pub description: String,
    /// Raw content of the SKILL.md file
    pub content: String,
    /// Last modified timestamp (Unix millis)
    pub modified_at: i64,
}

/// Parsed skills grouped by agent for startup consumers.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentSkillsGroup {
    /// Agent ID these skills belong to
    pub agent_id: String,
    /// Parsed skills for this agent
    pub skills: Vec<Skill>,
}

/// Tree node for UI rendering.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SkillTreeNode {
    /// Node identifier
    pub id: String,
    /// Display label
    pub label: String,
    /// Node type: "agent" or "skill"
    pub node_type: String,
    /// Agent ID (for both agent and skill nodes)
    pub agent_id: String,
    /// Children nodes (only for agent nodes)
    pub children: Vec<SkillTreeNode>,
    /// Whether this node is expandable
    pub is_expandable: bool,
}

/// Event emitted when skills change on disk.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SkillsChangedEvent {
    /// Agent ID that changed
    pub agent_id: String,
    /// Type of change: "created", "modified", "deleted"
    pub change_type: String,
    /// Path that changed
    pub path: String,
}

// ============================================================================
// Unified Skills Library Types
// ============================================================================

/// A skill stored in the unified library (SQLite).
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySkill {
    /// Unique skill ID (UUID)
    pub id: String,
    /// Skill name
    pub name: String,
    /// Optional description
    pub description: Option<String>,
    /// Full SKILL.md content
    pub content: String,
    /// Optional category for organization
    pub category: Option<String>,
    /// Created timestamp (Unix millis)
    pub created_at: i64,
    /// Updated timestamp (Unix millis)
    pub updated_at: i64,
}

/// Sync target configuration for a skill.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SyncTarget {
    /// Agent ID
    pub agent_id: String,
    /// Agent display name
    pub agent_name: String,
    /// Whether sync is enabled for this agent
    pub enabled: bool,
    /// Sync status: "synced", "pending", "never"
    pub status: String,
    /// Last synced timestamp (if synced)
    pub synced_at: Option<i64>,
}

/// A skill with its sync status across all agents.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySkillWithSync {
    /// The skill data
    pub skill: LibrarySkill,
    /// Sync targets with status
    pub sync_targets: Vec<SyncTarget>,
    /// Whether the skill has pending changes (content changed since last sync)
    pub has_pending_changes: bool,
}

/// Result of a sync operation for a single skill.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SkillSyncResult {
    /// Skill ID
    pub skill_id: String,
    /// Agent ID
    pub agent_id: String,
    /// Whether sync was successful
    pub success: bool,
    /// Error message if failed
    pub error: Option<String>,
}

/// Result of a full sync operation.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    /// Number of skills synced
    pub synced_count: i32,
    /// Number of skills that failed
    pub failed_count: i32,
    /// Individual results
    pub results: Vec<SkillSyncResult>,
}

/// Configuration for a supported agent.
#[derive(Debug, Clone)]
pub struct AgentConfig {
    /// Agent ID
    pub id: String,
    /// Display name
    pub name: String,
    /// Skills directory path pattern (with ~ for home)
    pub skills_dir_pattern: String,
    /// Filename for skill content (e.g., "SKILL.md")
    pub skill_filename: String,
}

// ============================================================================
// Plugin Skills Types
// ============================================================================

/// Information about an installed plugin.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    /// Unique plugin ID (marketplace::name)
    pub id: String,
    /// Marketplace name (e.g., "superpowers-marketplace")
    pub marketplace: String,
    /// Plugin name (e.g., "superpowers")
    pub name: String,
    /// Installed version (latest)
    pub version: String,
    /// Full path to the plugin's skills directory
    pub skills_dir: String,
    /// Number of skills in this plugin
    pub skill_count: i32,
}

/// A skill from a plugin (read-only).
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PluginSkill {
    /// Unique identifier (plugin_id::folder_name)
    pub id: String,
    /// Plugin this skill belongs to
    pub plugin_id: String,
    /// Skill folder name
    pub folder_name: String,
    /// Full path to SKILL.md
    pub path: String,
    /// Skill name from frontmatter
    pub name: String,
    /// Description from frontmatter
    pub description: String,
    /// Raw content of SKILL.md
    pub content: String,
    /// Last modified timestamp
    pub modified_at: i64,
}
