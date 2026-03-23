//! Shared constants for history scanning across all agents.

/// Maximum number of projects to scan during discovery.
/// Used to limit startup time when discovering sessions from all agents.
pub const MAX_PROJECTS_TO_SCAN: usize = 20;

/// Maximum number of sessions to scan per project.
/// Used to limit startup time while still providing a good overview.
pub const MAX_SESSIONS_PER_PROJECT: usize = 50;
