//! Cursor history parsing module.
//!
//! Reads conversation history from Cursor's agent transcripts stored at:
//! `~/.cursor/projects/{project-slug}/agent-transcripts/{session-id}.json`
//!
//! This format is similar to Claude Code's history structure.
//!
//! Provides two-level loading:
//! - Discovery: Lightweight metadata for thread listing
//! - Full load: Complete conversation content on demand

pub mod commands;
pub mod parser;
pub mod plan_loader;
pub mod types;
pub mod workspace;

#[cfg(test)]
mod test_integration;
