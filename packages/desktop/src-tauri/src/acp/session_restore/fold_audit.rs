//! Fold-path thread snapshot loading for CLI audit tools.

use std::path::PathBuf;

use crate::acp::parsers::AgentType;
use crate::acp::session::fold_export::{
    thread_snapshot_from_full_session, thread_snapshot_from_history_events,
};
use crate::acp::session::ingress::providers::claude_code::ClaudeHistorySource;
use crate::acp::session::ingress::source::{HistoryError, HistoryInput, HistorySource};
use crate::acp::session_thread_snapshot::SessionThreadSnapshot;
use crate::acp::types::CanonicalAgentId;
use crate::session_jsonl::types::FullSession;

fn fallback_title(session_id: &str) -> String {
    format!("Session {}", &session_id[..8.min(session_id.len())])
}

pub fn claude_thread_snapshot_from_jsonl_path(
    session_id: &str,
    project_path: &str,
    jsonl_path: PathBuf,
) -> Result<SessionThreadSnapshot, String> {
    let events = ClaudeHistorySource
        .read(HistoryInput {
            session_id: session_id.to_string(),
            workspace_root: Some(jsonl_path),
        })
        .map_err(history_error_message)?;

    Ok(thread_snapshot_from_history_events(
        session_id,
        &CanonicalAgentId::ClaudeCode,
        project_path,
        &events,
        fallback_title(session_id),
    ))
}

pub fn cursor_thread_snapshot_from_full_session(session: &FullSession) -> SessionThreadSnapshot {
    thread_snapshot_from_full_session(session, CanonicalAgentId::Cursor, AgentType::Cursor)
}

fn history_error_message(error: HistoryError) -> String {
    error.to_string()
}
