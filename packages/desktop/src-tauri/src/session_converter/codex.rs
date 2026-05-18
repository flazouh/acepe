use crate::acp::parsers::AgentType;
use crate::acp::session_thread_snapshot::{ProviderOwnedSessionSnapshot, SessionThreadSnapshot};
use crate::session_jsonl::types::FullSession;

pub(crate) fn convert_codex_full_session_to_thread_snapshot(
    session: &FullSession,
) -> SessionThreadSnapshot {
    convert_codex_full_session_to_provider_owned_snapshot(session).thread_snapshot
}

pub(crate) fn convert_codex_full_session_to_provider_owned_snapshot(
    session: &FullSession,
) -> ProviderOwnedSessionSnapshot {
    super::fullsession::convert_full_session_to_provider_owned_snapshot_with_agent(
        session,
        AgentType::Codex,
    )
}
