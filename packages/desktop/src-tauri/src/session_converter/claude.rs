use crate::session_jsonl::types::{ConvertedSession, FullSession};

pub(crate) fn convert_claude_full_session_to_entries(session: &FullSession) -> ConvertedSession {
    super::fullsession::convert_full_session_to_entries(session)
}
