#[cfg(test)]
use crate::acp::parsers::AgentType;
#[cfg(test)]
use crate::acp::session::fold_export::{
    materialized_thread_snapshot_from_full_session, MaterializedThreadSnapshot,
};
#[cfg(test)]
use crate::acp::types::CanonicalAgentId;

#[cfg(test)]
use super::parse_full_session;
#[cfg(test)]
use anyhow::Result;

/// Parse a session and return fold materialized transcript + projection.
#[cfg(test)]
pub(crate) async fn parse_converted_session(
    session_id: &str,
    project_path: &str,
) -> Result<MaterializedThreadSnapshot> {
    let full_session = parse_full_session(session_id, project_path).await?;
    Ok(materialized_thread_snapshot_from_full_session(
        &full_session,
        CanonicalAgentId::ClaudeCode,
        AgentType::ClaudeCode,
        0,
    ))
}
