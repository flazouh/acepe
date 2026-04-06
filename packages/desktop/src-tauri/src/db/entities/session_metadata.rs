//! Session metadata entity for fast history lookups.
//!
//! This table stores pre-extracted metadata from JSONL session files,
//! enabling O(1) lookups instead of O(files * lines) file scanning.

use crate::acp::types::CanonicalAgentId;
use chrono::{DateTime, Utc};
use sea_orm::entity::prelude::*;
use sea_orm::Set;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "session_metadata")]
pub struct Model {
    /// Session ID (UUID format) - primary key
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,

    /// Display title (extracted from summary or first user message)
    pub display: String,

    /// Unix timestamp in milliseconds (session creation time)
    pub timestamp: i64,

    /// Project path (e.g., /Users/example/Documents/acepe)
    pub project_path: String,

    /// Agent ID (e.g., "claude-code")
    /// Stored as String in DB, but represents CanonicalAgentId
    pub agent_id: String,

    /// File path relative to ~/.claude/projects/ (e.g., "-Users-example-Documents-acepe/abc123.jsonl")
    #[sea_orm(unique)]
    pub file_path: String,

    /// File modification time in seconds (for change detection)
    pub file_mtime: i64,

    /// File size in bytes (additional validation)
    pub file_size: i64,

    /// Provider-owned persisted session ID when it differs from the app session ID.
    pub provider_session_id: Option<String>,

    /// Optional worktree path when session operates in a git worktree
    pub worktree_path: Option<String>,

    /// Associated pull request number (e.g. from a `gh pr create` in the session)
    pub pr_number: Option<i32>,

    /// Record creation timestamp
    pub created_at: DateTime<Utc>,

    /// Record update timestamp
    pub updated_at: DateTime<Utc>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

impl Model {
    /// Get agent_id as CanonicalAgentId
    ///
    /// This always succeeds since CanonicalAgentId::parse accepts any string
    /// (unknown strings become Custom variants). If you need strict validation,
    /// use the std::str::FromStr trait implementation which returns Result.
    pub fn agent_id_enum(&self) -> CanonicalAgentId {
        CanonicalAgentId::parse(&self.agent_id)
    }
}

impl ActiveModel {
    /// Set agent_id from CanonicalAgentId
    /// Uses prefix format for Custom variants to ensure round-trip safety
    pub fn set_agent_id_enum(&mut self, agent_id: CanonicalAgentId) {
        self.agent_id = Set(agent_id.to_string_with_prefix());
    }
}
