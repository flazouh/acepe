//! History delivery — plugin registry load + replay-context production path.

use std::path::PathBuf;

use crate::acp::provider::ProviderHistoryLoadError;
use crate::acp::session::fold_export::{
    fold_graph_from_history_events, materialized_thread_snapshot_from_folded_graph,
    provider_owned_snapshot_from_folded_graph, MaterializedThreadSnapshot,
};
use crate::acp::session::ingress::event::ProviderEvent;
use crate::acp::session::ingress::plugin::history_source_for;
use crate::acp::session::ingress::providers::{claude_code, codex, copilot, opencode};
use crate::acp::session::ingress::source::{HistoryError, HistoryInput};
use crate::acp::session_descriptor::SessionReplayContext;
use crate::acp::session_state_engine::graph::SessionStateGraph;
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
        workspace_root: source_path.map(PathBuf::from).or(workspace_root),
    }
}

/// Load ordered provider events via the plugin registry (sync test + fold seam).
pub async fn load_history_events(
    agent_id: &CanonicalAgentId,
    session_id: &str,
    workspace_root: Option<PathBuf>,
    source_path: Option<&str>,
) -> Result<Vec<ProviderEvent>, HistoryError> {
    let source = history_source_for(agent_id).ok_or_else(|| {
        HistoryError::NotFound(format!("No history source registered for agent {agent_id}"))
    })?;

    let input = history_input_from_context(session_id, workspace_root, source_path);
    source.read(input).await
}

/// Load and fold provider history into a session graph (no compat snapshot wrapping).
pub async fn load_fold_graph_from_history(
    agent_id: &CanonicalAgentId,
    history_session_id: &str,
    project_path: &str,
    source_path: Option<&str>,
) -> Result<Option<SessionStateGraph>, HistoryError> {
    load_fold_graph_from_history_workspace(
        agent_id,
        history_session_id,
        project_path,
        Some(PathBuf::from(project_path)),
        source_path,
    )
    .await
}

/// Like [`load_fold_graph_from_history`] but allows a distinct history workspace root.
///
/// Copilot history discovery uses `None` workspace when no explicit `source_path` is set.
pub async fn load_fold_graph_from_history_workspace(
    agent_id: &CanonicalAgentId,
    history_session_id: &str,
    fold_project_path: &str,
    history_workspace: Option<PathBuf>,
    source_path: Option<&str>,
) -> Result<Option<SessionStateGraph>, HistoryError> {
    let events =
        load_history_events(agent_id, history_session_id, history_workspace, source_path).await?;
    if events.is_empty() {
        return Ok(None);
    }

    Ok(Some(fold_graph_from_history_events(
        history_session_id,
        agent_id,
        fold_project_path,
        &events,
    )))
}

/// Load fold materialization via HistorySource → fold (no backward-compat entry round-trip).
pub async fn load_materialized_from_history(
    agent_id: &CanonicalAgentId,
    history_session_id: &str,
    project_path: &str,
    source_path: Option<&str>,
) -> Result<Option<MaterializedThreadSnapshot>, HistoryError> {
    let graph =
        load_fold_graph_from_history(agent_id, history_session_id, project_path, source_path)
            .await?;
    Ok(graph.map(|graph| {
        materialized_thread_snapshot_from_folded_graph(
            history_session_id,
            &graph,
            graph.revision.graph_revision,
        )
    }))
}

/// Load provider-owned snapshot via HistorySource → fold → backward-compat snapshot mapper.
pub async fn load_provider_owned_snapshot_from_history(
    agent_id: &CanonicalAgentId,
    history_session_id: &str,
    project_path: &str,
    source_path: Option<&str>,
    title: String,
) -> Result<Option<ProviderOwnedSessionSnapshot>, HistoryError> {
    let graph =
        load_fold_graph_from_history(agent_id, history_session_id, project_path, source_path)
            .await?;
    Ok(graph.map(|graph| provider_owned_snapshot_from_folded_graph(graph, title)))
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
        .await
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
        CanonicalAgentId::Codex => codex::load_replay_events(replay_context)
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

    #[tokio::test]
    async fn load_fold_graph_from_history_resolves_cursor_fixture() {
        let fixture_dir =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/cursor_sessions");
        let fixture_db = fixture_dir.join("c2a34686-junk-session.db");

        let graph = load_fold_graph_from_history(
            &CanonicalAgentId::Cursor,
            "c2a34686-f99a-4632-90e2-e036b96124c2",
            "/Users/alex/Documents/sandbox",
            Some(fixture_db.to_str().expect("fixture db path is valid utf-8")),
        )
        .await
        .expect("cursor fold graph should load");

        let graph = graph.expect("cursor fold graph must be present");
        assert!(
            !graph.transcript_snapshot.entries.is_empty(),
            "cursor fold graph must contain transcript entries"
        );
        assert!(
            graph.operations.is_empty(),
            "cursor junk fixture golden has no tool operations"
        );
    }

    #[tokio::test]
    async fn load_fold_graph_from_history_resolves_claude_fixture() {
        let fixture_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("src/acp/session/ingress/tool_identity/tests/fixtures/historical-tool-call-session.jsonl");

        let graph = load_fold_graph_from_history(
            &CanonicalAgentId::ClaudeCode,
            "sess-hist-001",
            "/project",
            Some(fixture_path.to_str().expect("fixture path is valid utf-8")),
        )
        .await
        .expect("claude fold graph should load");

        let graph = graph.expect("claude fold graph must be present");
        assert!(
            !graph.transcript_snapshot.entries.is_empty(),
            "fold graph must contain transcript entries"
        );
        assert!(
            !graph.operations.is_empty(),
            "fold graph must contain tool operations"
        );
    }

    #[tokio::test]
    async fn load_history_events_resolves_cursor_junk_fixture() {
        let fixture_dir =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/cursor_sessions");

        let events = load_history_events(
            &CanonicalAgentId::Cursor,
            "c2a34686-f99a-4632-90e2-e036b96124c2",
            Some(fixture_dir),
            None,
        )
        .await
        .expect("cursor junk fixture should load");

        assert!(!events.is_empty(), "cursor history load must emit events");
    }

    #[tokio::test]
    async fn load_history_events_prefers_source_path_over_workspace_root() {
        let fixture_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("src/acp/session/ingress/tool_identity/tests/fixtures/historical-tool-call-session.jsonl");

        let events = load_history_events(
            &CanonicalAgentId::ClaudeCode,
            "sess-hist-001",
            Some(PathBuf::from("/nonexistent/workspace")),
            Some(fixture_path.to_str().expect("fixture path is valid utf-8")),
        )
        .await
        .expect("claude fixture should load via source_path override");

        assert!(!events.is_empty(), "claude history load must emit events");
    }

    #[tokio::test]
    async fn load_history_events_errors_for_unregistered_agent() {
        let error = load_history_events(&CanonicalAgentId::Forge, "session-id", None, None)
            .await
            .expect_err("forge is not registered");

        assert_eq!(
            error,
            HistoryError::NotFound("No history source registered for agent forge".to_string())
        );
    }

    #[test]
    fn registered_agents_match_history_load_coverage() {
        let agents: Vec<_> = registered_agents().collect();
        assert!(agents.contains(&CanonicalAgentId::Cursor));
        assert!(agents.contains(&CanonicalAgentId::ClaudeCode));
        assert!(agents.contains(&CanonicalAgentId::OpenCode));
        assert!(agents.contains(&CanonicalAgentId::Copilot));
        assert!(agents.contains(&CanonicalAgentId::Codex));
    }
}
