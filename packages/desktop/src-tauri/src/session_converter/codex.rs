use crate::acp::parsers::AgentType;
use crate::session_jsonl::types::{ConvertedSession, FullSession};

#[allow(dead_code)]
pub(crate) fn convert_codex_full_session_to_entries(session: &FullSession) -> ConvertedSession {
    super::fullsession::convert_full_session_to_entries_with_agent(session, AgentType::Codex)
}
