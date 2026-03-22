//! Skills Manager module.
//!
//! Provides functionality for managing AI agent skills across
//! Claude Code, Cursor, Codex, OpenCode, Amp, and Antigravity agents.
//!
//! The unified skills library stores skills in SQLite and syncs them
//! to agent directories on demand.

pub mod commands;
pub mod parser;
pub mod plugins;
pub mod service;
pub mod sync;
pub mod types;

pub use commands::*;
pub use plugins::PluginDiscovery;
pub use service::SkillsService;
pub use sync::SyncEngine;
pub use types::*;
