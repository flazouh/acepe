//! Agent-specific adapters for tool name normalization.
//!
//! Each adapter normalizes agent-specific tool names directly to `ToolKind`.
//! This allows each agent to use different tool names while maintaining a unified
//! classification system.

mod claude_code;
mod codex;
mod copilot;
mod cursor;
mod open_code;
mod shared_chat;

pub use claude_code::ClaudeCodeAdapter;
pub use codex::CodexAdapter;
pub use copilot::CopilotAdapter;
pub use cursor::CursorAdapter;
pub use open_code::OpenCodeAdapter;

/// Zero-allocation check: name matches any of the candidates (ASCII case-insensitive).
pub(crate) fn any_eq(name: &str, candidates: &[&str]) -> bool {
    candidates.iter().any(|c| name.eq_ignore_ascii_case(c))
}
