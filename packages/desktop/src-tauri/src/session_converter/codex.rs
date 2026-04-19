use crate::acp::parsers::AgentType;
use crate::acp::session_thread_snapshot::SessionThreadSnapshot;
use crate::session_jsonl::types::FullSession;

pub(crate) fn convert_codex_full_session_to_thread_snapshot(
    session: &FullSession,
) -> SessionThreadSnapshot {
    super::fullsession::convert_full_session_to_thread_snapshot_with_agent(
        session,
        AgentType::Codex,
    )
}
