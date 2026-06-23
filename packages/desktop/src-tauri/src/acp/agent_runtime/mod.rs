//! Agent-agnostic "keep the managed CLI current" capability.
//!
//! Each managed agent's update mechanism lives behind a [`ManagedAgentRuntime`]
//! adapter; a thin orchestrator (see [`spawn_update_all`], added with the registry)
//! drives every *enrolled* adapter at startup with no per-agent branching. An agent
//! is enrolled only if its update can be integrity-verified.

use crate::acp::types::CanonicalAgentId;
use async_trait::async_trait;
use tauri::AppHandle;

pub(crate) mod adapters;

/// Outcome of a single agent's update check. All variants are non-error: the
/// updater is best-effort and always leaves a working binary in place.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum UpdateOutcome {
    /// The managed binary was advanced from `from` to `to`.
    Updated { from: String, to: String },
    /// Already at (or newer than) the latest available version.
    AlreadyCurrent,
    /// Not installed yet — cold install is owned by the install flow, not the updater.
    SkippedNotInstalled,
    /// Latest version could not be resolved (offline / registry / GitHub error).
    SkippedOffline,
    /// Reading the installed version, verifying, downloading, or installing failed;
    /// the existing binary is left in place.
    SkippedError,
    /// An update installed but failed its post-install health probe and was rolled
    /// back to the previous binary.
    RevertedAfterFailedHealthCheck,
}

/// A managed agent runtime that can keep itself current.
///
/// Deep module: the single [`ensure_up_to_date`](ManagedAgentRuntime::ensure_up_to_date)
/// method hides version resolution, integrity verification, install, and rollback so
/// the orchestrator never branches per agent.
#[async_trait]
pub(crate) trait ManagedAgentRuntime: Send + Sync {
    /// Which agent this runtime manages.
    fn agent_id(&self) -> CanonicalAgentId;

    /// Best-effort, non-blocking: advance the managed binary to the latest verified
    /// version if needed. Never surfaces an error — every failure mode maps to a
    /// `Skipped*` / `Reverted*` [`UpdateOutcome`] and leaves a working binary in place.
    async fn ensure_up_to_date(&self, app: &AppHandle) -> UpdateOutcome;
}

/// The set of **enrolled** managed runtimes — agents whose update can be
/// integrity-verified. Cursor and OpenCode are intentionally absent: the ACP
/// registry publishes no digest for them, so they stay install-once until a
/// verifiable source exists (see the plan's Deferred section).
fn registry() -> Vec<Box<dyn ManagedAgentRuntime>> {
    vec![
        Box::new(adapters::claude::ClaudeRuntime),
        Box::new(adapters::github_release::GitHubReleaseRuntime::new(
            CanonicalAgentId::Copilot,
        )),
        Box::new(adapters::github_release::GitHubReleaseRuntime::new(
            CanonicalAgentId::Codex,
        )),
    ]
}

/// Fire the startup update check for every enrolled managed agent. Each agent runs in
/// its own background task so one agent's failure (or hang) never blocks startup or
/// the others — agent-agnostic, no per-agent branching. Safe to call unconditionally:
/// each adapter self-skips when its agent is not installed.
pub(crate) fn spawn_update_all(app: AppHandle) {
    for runtime in registry() {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let agent = runtime.agent_id();
            let outcome = runtime.ensure_up_to_date(&app).await;
            tracing::info!(?agent, ?outcome, "Managed agent update check complete");
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_enrolls_only_integrity_verified_agents() {
        let ids: Vec<CanonicalAgentId> = registry().iter().map(|r| r.agent_id()).collect();
        assert!(ids.contains(&CanonicalAgentId::ClaudeCode));
        assert!(ids.contains(&CanonicalAgentId::Copilot));
        assert!(ids.contains(&CanonicalAgentId::Codex));
        // Not enrolled — no published integrity source yet.
        assert!(!ids.contains(&CanonicalAgentId::Cursor));
        assert!(!ids.contains(&CanonicalAgentId::OpenCode));
        assert_eq!(ids.len(), 3, "exactly the three verified agents");
    }
}
