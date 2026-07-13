//! Fold-path materialized loading for CLI audit tools.

use std::path::PathBuf;

use crate::acp::parsers::AgentType;
use crate::acp::session::delivery::history_load::load_history_events;
use crate::acp::session::fold_export::{
    materialized_thread_snapshot_from_full_session,
    materialized_thread_snapshot_from_history_events, MaterializedThreadSnapshot,
};
use crate::acp::session::ingress::providers::claude_code::ClaudeHistorySource;
use crate::acp::session::ingress::source::{HistoryError, HistoryInput, HistorySource};
use crate::acp::types::CanonicalAgentId;
use crate::session_jsonl::types::FullSession;

fn fallback_title(session_id: &str) -> String {
    format!("Session {}", &session_id[..8.min(session_id.len())])
}

pub(crate) async fn claude_materialized_from_jsonl_path(
    session_id: &str,
    project_path: &str,
    jsonl_path: PathBuf,
) -> Result<MaterializedThreadSnapshot, String> {
    let events = ClaudeHistorySource
        .read(HistoryInput {
            session_id: session_id.to_string(),
            workspace_root: Some(jsonl_path),
        })
        .await
        .map_err(history_error_message)?;

    Ok(materialized_thread_snapshot_from_history_events(
        session_id,
        &CanonicalAgentId::ClaudeCode,
        project_path,
        &events,
        fallback_title(session_id),
        0,
    ))
}

pub(crate) fn cursor_materialized_from_full_session(
    session: &FullSession,
) -> MaterializedThreadSnapshot {
    materialized_thread_snapshot_from_full_session(
        session,
        CanonicalAgentId::Cursor,
        AgentType::Cursor,
        0,
    )
}

pub(crate) async fn materialized_from_history(
    agent_id: &CanonicalAgentId,
    session_id: &str,
    project_path: &str,
    source_path: Option<&str>,
) -> Result<Option<MaterializedThreadSnapshot>, String> {
    let events = load_history_events(
        agent_id,
        session_id,
        Some(PathBuf::from(project_path)),
        source_path,
    )
    .await
    .map_err(history_error_message)?;

    if events.is_empty() {
        return Ok(None);
    }

    Ok(Some(materialized_thread_snapshot_from_history_events(
        session_id,
        agent_id,
        project_path,
        &events,
        fallback_title(session_id),
        0,
    )))
}

fn history_error_message(error: HistoryError) -> String {
    error.to_string()
}
