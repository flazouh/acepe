//! Checkpoint system for file versioning and revert functionality.
//!
//! This module provides:
//! - Point-in-time file snapshots during editing sessions
//! - Auto-checkpoints after each edit tool call
//! - Manual checkpoints on user request
//! - File and session revert functionality

pub mod commands;
pub mod manager;
pub mod repository;
pub mod types;

pub use commands::*;
pub use manager::CheckpointManager;
pub use repository::CheckpointRepository;
pub use types::*;
