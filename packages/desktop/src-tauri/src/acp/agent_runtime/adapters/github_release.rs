//! GitHubReleaseRuntime — auto-updates GitHub-release agents (Copilot, Codex)
//! through the shared [`ManagedAgentRuntime`] trait. All source-specific work
//! (latest-stable resolution, digest verification, rollback-safe install) lives in
//! `agent_installer`; this adapter is a thin, agent-agnostic spine over it.

use crate::acp::agent_installer;
use crate::acp::agent_runtime::{ManagedAgentRuntime, UpdateOutcome};
use crate::acp::error::AcpError;
use crate::acp::types::CanonicalAgentId;
use async_trait::async_trait;
use tauri::AppHandle;

pub(crate) struct GitHubReleaseRuntime {
    agent_id: CanonicalAgentId,
}

impl GitHubReleaseRuntime {
    pub(crate) fn new(agent_id: CanonicalAgentId) -> Self {
        Self { agent_id }
    }
}

#[async_trait]
impl ManagedAgentRuntime for GitHubReleaseRuntime {
    fn agent_id(&self) -> CanonicalAgentId {
        self.agent_id.clone()
    }

    async fn ensure_up_to_date(&self, app: &AppHandle) -> UpdateOutcome {
        // Not installed → cold install is owned by client_factory; never probe/install here.
        let installed = match agent_installer::get_cached_version(&self.agent_id) {
            Some(version) => version,
            None => return UpdateOutcome::SkippedNotInstalled,
        };

        let latest = match agent_installer::resolve_latest_version(&self.agent_id).await {
            Ok(version) => version,
            Err(error) => {
                tracing::debug!(error = %error, "Skipping update: could not resolve latest version");
                return UpdateOutcome::SkippedOffline;
            }
        };

        if !needs_update(&installed, &latest) {
            return UpdateOutcome::AlreadyCurrent;
        }

        match agent_installer::install_agent(self.agent_id.clone(), app.clone()).await {
            Ok(_) => UpdateOutcome::Updated {
                from: installed,
                to: latest,
            },
            Err(AcpError::AgentUpdateRolledBack { .. }) => {
                UpdateOutcome::RevertedAfterFailedHealthCheck
            }
            Err(error) => {
                tracing::warn!(error = %error, "Agent update install failed; keeping existing binary");
                UpdateOutcome::SkippedError
            }
        }
    }
}

/// Decide whether an update is needed: the source always points at the latest, so any
/// (whitespace-normalized) difference between installed and latest means we are behind.
/// Format-agnostic — works for date strings (`2026.06.19`) and semver tags alike.
fn needs_update(installed: &str, latest: &str) -> bool {
    installed.trim() != latest.trim()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn needs_update_compares_normalized() {
        assert!(needs_update("0.0.1", "0.0.2"));
        assert!(needs_update("2026.06.19", "2026.06.24"));
        assert!(!needs_update("1.17.9", "1.17.9"));
        // Whitespace-only differences do not count as an update.
        assert!(!needs_update(" 1.17.9 ", "1.17.9\n"));
    }

    #[test]
    fn agent_id_round_trips() {
        let rt = GitHubReleaseRuntime::new(CanonicalAgentId::Codex);
        assert_eq!(rt.agent_id(), CanonicalAgentId::Codex);
    }
}
