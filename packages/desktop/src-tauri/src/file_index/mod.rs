//! File indexing module for the @ file picker feature.
//!
//! This module provides:
//! - Fast file scanning with .gitignore support
//! - Git status extraction (M/A/D/? with line changes)
//! - Caching for instant subsequent lookups

pub mod commands;
pub mod git;
mod scanner;
pub mod service;
pub mod types;

pub use commands::*;
pub use service::FileIndexService;
pub use types::*;
