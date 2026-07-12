//! History delivery — plugin registry load + replay-context production path.

use std::path::PathBuf;

use crate::acp::provider::ProviderHistoryLoadError;
use crate::acp::session::delivery::open_from_fold::graph_from_history_events;
use crate::acp::session::fold_export::provider_owned_snapshot_from_folded_graph;
use crate::acp::session::engine::fold::FoldContext;
use crate::acp::session::ingress::event::ProviderEvent;
use crate::acp::session::ingress::plugin::history_source_for;
use crate::acp::session::ingress::providers::{claude_code, copilot, opencode};
use crate::acp::session::ingress::source::{HistoryError, HistoryInput};
use crate::acp::session_descriptor::SessionReplayContext;
use crate::acp::session_thread_snapshot::ProviderOwnedSessionSnapshot;
use crate::acp::types::CanonicalAgentId;
use tauri::AppHandle;

pub fn history_error_to_provider_error(error: HistoryError) -> ProviderHistoryLoadError {
    match error {
        HistoryError::NotFound(message) => {
            ProviderHistoryLoadError::provider_history_missing(message)
        }
        HistoryError::InvalidFormat(message) => {
            ProviderHistoryLoadError::provider_unparseable(message)
        }
        HistoryError::Io(message) => ProviderHistoryLoadError::provider_unavailable(message),
    }
}

/// Build history input from session-context fields.
///
/// `source_path` overrides `workspace_root` when present (explicit on-disk source).
fn history_input_from_context(
    session_id: &str,
    workspace_root: Option<PathBuf>,
    source_path: Option<&str>,
) -> HistoryInput {
    HistoryInput {
        session_id: session_id.to_string(),
        workspace_root: source_path
            .map(PathBuf::from)
            .or(workspace_root),
    }
}

/// Load ordered provider events via the plugin registry (sync test + fold seam).
pub fn load_history_events(
    agent_id: &CanonicalAgentId,
    session_id: &str,
    workspace_root: Option<PathBuf>,
    source_path: Option<&str>,
) -> Result<Vec<ProviderEvent>, HistoryError> {
    let source = history_source_for(agent_id).ok_or_else(|| {
        HistoryError::NotFound(format!(
            "No history source registered for agent {agent_id}"
        ))
    })?;

    let input = history_input_from_context(session_id, workspace_root, source_path);
    source.read(input)
}

/// Load provider-owned snapshot via HistorySource → fold → backward-compat snapshot mapper.
pub fn load_provider_owned_snapshot_from_history(
    agent_id: &CanonicalAgentId,
    history_session_id: &str,
    project_path: &str,
    source_path: Option<&str>,
    title: String,
) -> Result<Option<ProviderOwnedSessionSnapshot>, HistoryError> {
    let events = load_history_events(
        agent_id,
        history_session_id,
        Some(PathBuf::from(project_path)),
        source_path,
    )?;
    if events.is_empty() {
        return Ok(None);
    }

    let ctx = FoldContext::new(history_session_id, agent_id.clone(), project_path);
    let graph = graph_from_history_events(&events, &ctx);
    Ok(Some(provider_owned_snapshot_from_folded_graph(
        graph, title,
    )))
}

/// Load provider history as ordered ingress events for fold-based session open.
pub async fn load_history_events_for_replay(
    _app: AppHandle,
    replay_context: &SessionReplayContext,
) -> Result<Vec<ProviderEvent>, ProviderHistoryLoadError> {
    match replay_context.agent_id {
        CanonicalAgentId::Cursor => load_history_events(
            &replay_context.agent_id,
            &replay_context.history_session_id,
            Some(PathBuf::from(&replay_context.project_path)),
            replay_context.source_path.as_deref(),
        )
        .map_err(history_error_to_provider_error),
        CanonicalAgentId::ClaudeCode => claude_code::load_replay_events(replay_context)
            .await
            .map_err(history_error_to_provider_error),
        CanonicalAgentId::OpenCode => opencode::load_replay_events(replay_context)
            .await
            .map_err(history_error_to_provider_error),
        CanonicalAgentId::Copilot => copilot::load_replay_events(replay_context)
            .await
            .map_err(history_error_to_provider_error),
        _ => Err(ProviderHistoryLoadError::provider_unavailable(format!(
            "History event load is not supported for agent {}",
            replay_context.agent_id
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::session::ingress::plugin::registered_agents;

    #[test]
    fn load_history_events_resolves_cursor_junk_fixture() {
        let fixture_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/cursor_sessions");

        let events = load_history_events(
            &CanonicalAgentId::Cursor,
            "c2a34686-f99a-4632-90e2-e036b96124c2",
            Some(fixture_dir),
            None,
        )
        .expect("cursor junk fixture should load");

        assert!(
            !events.is_empty(),
            "cursor history load must emit events"
        );
    }

    #[test]
    fn load_history_events_prefers_source_path_over_workspace_root() {
        let fixture_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("src/acp/reconciler/tests/fixtures/historical-tool-call-session.jsonl");

        let events = load_history_events(
            &CanonicalAgentId::ClaudeCode,
            "sess-hist-001",
            Some(PathBuf::from("/nonexistent/workspace")),
            Some(fixture_path.to_str().expect("fixture path is valid utf-8")),
        )
        .expect("claude fixture should load via source_path override");

        assert!(
            !events.is_empty(),
            "claude history load must emit events"
        );
    }

    #[test]
    fn load_history_events_errors_for_unregistered_agent() {
        let error = load_history_events(
            &CanonicalAgentId::Codex,
            "session-id",
            None,
            None,
        )
        .expect_err("codex is not registered yet");

        assert_eq!(
            error,
            HistoryError::NotFound("No history source registered for agent codex".to_string())
        );
    }

    #[test]
    fn registered_agents_match_history_load_coverage() {
        let agents: Vec<_> = registered_agents().collect();
        assert!(agents.contains(&CanonicalAgentId::Cursor));
        assert!(agents.contains(&CanonicalAgentId::ClaudeCode));
        assert!(agents.contains(&CanonicalAgentId::OpenCode));
        assert!(agents.contains(&CanonicalAgentId::Copilot));
    }
}
