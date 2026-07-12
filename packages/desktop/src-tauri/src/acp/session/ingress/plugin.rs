//! Provider plugin registry — one registration point per agent history source.

use crate::acp::session::ingress::providers::claude_code::ClaudeHistorySource;
use crate::acp::session::ingress::providers::copilot::CopilotHistorySource;
use crate::acp::session::ingress::providers::cursor::CursorHistorySource;
use crate::acp::session::ingress::providers::opencode::OpenCodeHistorySource;
use crate::acp::session::ingress::source::HistorySource;
use crate::acp::types::CanonicalAgentId;

static CURSOR_HISTORY: CursorHistorySource = CursorHistorySource;
static CLAUDE_HISTORY: ClaudeHistorySource = ClaudeHistorySource;
static OPENCODE_HISTORY: OpenCodeHistorySource = OpenCodeHistorySource;
static COPILOT_HISTORY: CopilotHistorySource = CopilotHistorySource;

/// Returns the registered history source for `agent`, if any.
#[must_use]
pub fn history_source_for(agent: &CanonicalAgentId) -> Option<&'static dyn HistorySource> {
    match agent {
        CanonicalAgentId::Cursor => Some(&CURSOR_HISTORY),
        CanonicalAgentId::ClaudeCode => Some(&CLAUDE_HISTORY),
        CanonicalAgentId::OpenCode => Some(&OPENCODE_HISTORY),
        CanonicalAgentId::Copilot => Some(&COPILOT_HISTORY),
        _ => None,
    }
}

/// Iterates every agent id with a registered plugin.
pub fn registered_agents() -> impl Iterator<Item = CanonicalAgentId> {
    [
        CanonicalAgentId::Cursor,
        CanonicalAgentId::ClaudeCode,
        CanonicalAgentId::OpenCode,
        CanonicalAgentId::Copilot,
    ]
    .into_iter()
}
