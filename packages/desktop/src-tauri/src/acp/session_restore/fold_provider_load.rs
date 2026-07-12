//! Fold-path provider history loader — events when HistorySource is available.

use crate::acp::provider::ProviderHistoryLoadError;
use crate::acp::session::delivery::history_load::load_history_events_for_replay;
use crate::acp::session::ingress::event::ProviderEvent;
use crate::acp::session_descriptor::SessionReplayContext;
use crate::acp::types::CanonicalAgentId;
use tauri::AppHandle;

/// Load provider history events for fold-based open when the agent supports HistorySource.
///
/// Returns `Ok(None)` for agents that should fall back to the legacy snapshot path.
pub async fn load_provider_history_events(
    app: AppHandle,
    replay_context: &SessionReplayContext,
) -> Result<Option<Vec<ProviderEvent>>, ProviderHistoryLoadError> {
    match replay_context.agent_id {
        CanonicalAgentId::Cursor
        | CanonicalAgentId::ClaudeCode
        | CanonicalAgentId::OpenCode
        | CanonicalAgentId::Copilot => {
            load_history_events_for_replay(app, replay_context)
                .await
                .map(Some)
        }
        _ => Ok(None),
    }
}
