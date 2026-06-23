//! ClaudeRuntime — wraps the existing npm-based Claude CLI updater behind the
//! shared [`ManagedAgentRuntime`] trait. Behavior is unchanged; this only adapts
//! the outcome type and keeps Claude's catalog re-warm (its updater bypasses
//! `install_agent`, which is where the other agents' re-warm lives).

use crate::acp::agent_runtime::{ManagedAgentRuntime, UpdateOutcome};
use crate::acp::types::CanonicalAgentId;
use crate::cc_sdk::cli_download::{self, UpdateOutcome as ClaudeUpdateOutcome};
use async_trait::async_trait;
use tauri::AppHandle;

pub(crate) struct ClaudeRuntime;

#[async_trait]
impl ManagedAgentRuntime for ClaudeRuntime {
    fn agent_id(&self) -> CanonicalAgentId {
        CanonicalAgentId::ClaudeCode
    }

    async fn ensure_up_to_date(&self, app: &AppHandle) -> UpdateOutcome {
        let claude_outcome = cli_download::ensure_managed_claude_up_to_date().await;

        // On a real update, refresh the Claude model catalog (Claude's updater does
        // not go through `install_agent`, which is where Copilot's re-warm happens).
        if matches!(claude_outcome, ClaudeUpdateOutcome::Updated { .. }) {
            if let Err(error) =
                crate::acp::providers::claude_code_model_catalog::invalidate_catalog_snapshot_for_app(
                    app,
                )
                .await
            {
                tracing::warn!(error = %error, "Failed invalidating Claude catalog after CLI update");
            }
            crate::acp::providers::claude_code_model_catalog::warm_catalog_in_background(
                app.clone(),
            );
        }

        map_claude_outcome(claude_outcome)
    }
}

/// Pure mapping from the Claude updater's outcome to the shared [`UpdateOutcome`].
/// `Updated` carries `SemVer`, so format the versions to display strings.
fn map_claude_outcome(outcome: ClaudeUpdateOutcome) -> UpdateOutcome {
    match outcome {
        ClaudeUpdateOutcome::Updated { from, to } => UpdateOutcome::Updated {
            from: format!("{}.{}.{}", from.major, from.minor, from.patch),
            to: format!("{}.{}.{}", to.major, to.minor, to.patch),
        },
        ClaudeUpdateOutcome::AlreadyCurrent => UpdateOutcome::AlreadyCurrent,
        ClaudeUpdateOutcome::SkippedCold => UpdateOutcome::SkippedNotInstalled,
        ClaudeUpdateOutcome::SkippedOffline => UpdateOutcome::SkippedOffline,
        ClaudeUpdateOutcome::SkippedError => UpdateOutcome::SkippedError,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cc_sdk::transport::subprocess::SemVer;

    #[test]
    fn maps_every_claude_outcome_variant() {
        assert_eq!(
            map_claude_outcome(ClaudeUpdateOutcome::Updated {
                from: SemVer::new(2, 1, 150),
                to: SemVer::new(2, 1, 186),
            }),
            UpdateOutcome::Updated {
                from: "2.1.150".to_string(),
                to: "2.1.186".to_string(),
            }
        );
        assert_eq!(
            map_claude_outcome(ClaudeUpdateOutcome::AlreadyCurrent),
            UpdateOutcome::AlreadyCurrent
        );
        assert_eq!(
            map_claude_outcome(ClaudeUpdateOutcome::SkippedCold),
            UpdateOutcome::SkippedNotInstalled
        );
        assert_eq!(
            map_claude_outcome(ClaudeUpdateOutcome::SkippedOffline),
            UpdateOutcome::SkippedOffline
        );
        assert_eq!(
            map_claude_outcome(ClaudeUpdateOutcome::SkippedError),
            UpdateOutcome::SkippedError
        );
    }

    #[test]
    fn agent_id_is_claude_code() {
        assert_eq!(ClaudeRuntime.agent_id(), CanonicalAgentId::ClaudeCode);
    }
}
