use crate::acp::session_thread_snapshot::SessionThreadSnapshot;
use crate::session_jsonl::types::FullSession;

pub fn convert_full_session_to_entries(session: &FullSession) -> SessionThreadSnapshot {
    crate::session_converter::convert_claude_full_session_to_thread_snapshot(session)
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
    Ok(crate::session_converter::convert_claude_full_session_to_thread_snapshot(&full_session))
}
