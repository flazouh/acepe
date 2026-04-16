//! Unified history module for all agents.
//!
//! This module provides a unified interface for retrieving
//! conversation history from all agents (Claude Code, Cursor, etc.).
//! Session content is parsed on-demand from source files (JSONL, SQLite, etc.)

pub mod commands;
pub mod constants;
pub mod cursor_sqlite_parser;
pub mod indexer;
pub mod scan_cache;
pub mod session_context;
pub(crate) mod tag_utils;
pub(crate) mod title_utils;

// Re-export commonly used types
pub use commands::{
    audit_session_load_timing, get_session_open_result, get_startup_sessions,
    get_unified_session, scan_project_sessions, SessionLoadTiming, TimingStage,
};
pub use constants::{MAX_PROJECTS_TO_SCAN, MAX_SESSIONS_PER_PROJECT};
