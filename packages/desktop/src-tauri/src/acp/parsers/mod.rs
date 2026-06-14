//! Agent-specific parsers for ACP protocol messages.
//!
//! Each agent (Claude Code, OpenCode, Cursor, Codex) sends events in slightly
//! different formats. This module provides a unified parsing interface via the
//! `AgentParser` trait, with agent-specific implementations.
//!
//! ## Architecture
//!
//! Tool name normalization lives under `crate::acp::reconciler` (Unit 3 / plan 009).
//! ACP `kind` hints and canonical display names are re-exported from the tool identity authority.
//! Parsers re-export adapter types for the `AgentParser` surface.

pub mod acp_fields;
pub(crate) mod argument_enrichment;
pub(crate) mod arguments;
pub mod cc_sdk_bridge;
pub(crate) mod claude_code_parser;
pub(crate) mod codex_parser;
pub(crate) mod copilot_parser;
pub(crate) mod cursor_parser;
pub(crate) mod edit_normalizers;
pub(crate) mod opencode_parser;
pub mod parsed_todo;
pub mod provider_capabilities;
pub(crate) mod shared_chat;
pub mod status;
mod types;

pub use crate::acp::reconciler::providers::{
    ClaudeCodeAdapter, CodexAdapter, CopilotAdapter, CursorAdapter, OpenCodeAdapter,
};
pub use claude_code_parser::ClaudeCodeParser;
pub use codex_parser::CodexParser;
pub use copilot_parser::CopilotParser;
pub use cursor_parser::CursorParser;
pub use opencode_parser::OpenCodeParser;
pub use types::{
    get_parser, AgentParser, AgentType, ParseError, ParsedQuestion, ParsedQuestionOption,
    ParsedTodo, ParsedTodoStatus, UpdateType,
};

#[cfg(test)]
mod tests;
