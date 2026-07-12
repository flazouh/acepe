use crate::acp::parsers::AgentType;
use crate::acp::session::fold_export::thread_snapshot_from_full_session;
use crate::acp::session_thread_snapshot::SessionThreadSnapshot;
use crate::acp::types::CanonicalAgentId;
use crate::session_jsonl::types::FullSession;

pub fn convert_full_session_to_entries(session: &FullSession) -> SessionThreadSnapshot {
    thread_snapshot_from_full_session(session, CanonicalAgentId::ClaudeCode, AgentType::ClaudeCode)
}

#[cfg(test)]
use super::parse_full_session;
#[cfg(test)]
use anyhow::Result;

/// Parse a session and return a `SessionThreadSnapshot`.
#[cfg(test)]
pub(crate) async fn parse_converted_session(
    session_id: &str,
    project_path: &str,
) -> Result<SessionThreadSnapshot> {
    let full_session = parse_full_session(session_id, project_path).await?;
    Ok(convert_full_session_to_entries(&full_session))
}
