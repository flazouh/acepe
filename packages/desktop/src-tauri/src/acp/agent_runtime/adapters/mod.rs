//! Per-mechanism [`super::ManagedAgentRuntime`] adapters.
//!
//! - [`claude`] — npm-based Claude CLI (wraps the existing `cc_sdk` updater).
//! - [`github_release`] — GitHub-release agents (Copilot, Codex), digest-verified.

pub(crate) mod claude;
pub(crate) mod github_release;
