//! Unified Tauri commands for session history.
//!
//! Provides commands for querying and retrieving conversation history
//! from all agents (Claude Code, Cursor, etc.) through a unified interface.
//! Session content is parsed on-demand from source files (JSONL, SQLite, etc.)

use std::sync::LazyLock;
use std::time::{Duration, Instant};

use crate::acp::types::CanonicalAgentId;
use crate::codex_history::parser as codex_parser;
use crate::codex_history::scanner as codex_scanner;
use crate::cursor_history::parser as cursor_parser;
use crate::cursor_history::plan_loader as cursor_plan_loader;
use crate::db::repository::SessionMetadataRepository;
use crate::history::scan_cache::ScanCache;
use crate::opencode_history::parser as opencode_parser;
use crate::session_jsonl::parser as session_jsonl_parser;
use crate::session_jsonl::plan_loader as session_jsonl_plan_loader;
use crate::session_jsonl::types::{ConvertedSession, HistoryEntry, SessionPlanResponse};
use sea_orm::DbConn;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

pub(crate) mod plans;
pub(crate) mod projects;
pub(crate) mod scanning;
pub(crate) mod session_loading;

pub use plans::get_unified_plan;
pub use projects::{count_sessions_for_project, list_all_project_paths};
pub use scanning::{
    discover_all_projects_with_sessions, get_startup_sessions, scan_project_sessions,
};
pub use session_loading::{
    audit_session_load_timing, audit_session_load_timing_cli, get_session_open_result,
    get_unified_session, set_session_pr_number, set_session_title, set_session_worktree_path,
};

/// Information about a project with session counts per agent.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ProjectInfo {
    /// Absolute path to the project
    pub path: String,
    /// Agent source that discovered this project
    pub agent_id: String,
    /// Whether the discovered path is a git worktree instead of the main project root
    pub is_worktree: bool,
}

/// Session counts for a specific project, keyed by agent ID.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ProjectSessionCounts {
    /// Absolute path to the project
    pub path: String,
    /// Session counts per agent ID
    pub counts: std::collections::HashMap<String, u32>,
}

static SCAN_CACHE: LazyLock<ScanCache<Vec<HistoryEntry>>> =
    LazyLock::new(|| ScanCache::new(Duration::from_secs(5)));

/// A single timing stage for session load audit.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct TimingStage {
    pub name: String,
    pub ms: u128,
}

/// Timing audit result for session load.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct SessionLoadTiming {
    pub agent: String,
    pub total_ms: u128,
    pub stages: Vec<TimingStage>,
    pub entry_count: usize,
    pub ok: bool,
}

fn add_stage(stages: &mut Vec<TimingStage>, name: &str, start: Instant) {
    stages.push(TimingStage {
        name: name.to_string(),
        ms: start.elapsed().as_millis(),
    });
}
