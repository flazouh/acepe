//! Fold-path provider history loader — events when HistorySource is available.

use crate::acp::provider::ProviderHistoryLoadError;
use crate::acp::session::ingress::event::ProviderEvent;
use crate::acp::session_descriptor::SessionReplayContext;
use tauri::AppHandle;

use super::provider_load::load_provider_history_events_from_provider;

/// Load provider history events through the provider-owned ingress hook.
pub async fn load_provider_history_events(
    app: AppHandle,
    replay_context: &SessionReplayContext,
) -> Result<Option<Vec<ProviderEvent>>, ProviderHistoryLoadError> {
    load_provider_history_events_from_provider(app, replay_context).await
}
