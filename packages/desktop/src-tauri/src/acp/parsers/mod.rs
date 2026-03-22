//! Agent-specific parsers for ACP protocol messages.
//!
//! Each agent (Claude Code, OpenCode, Cursor, Codex) sends events in slightly
//! different formats. This module provides a unified parsing interface via the
//! `AgentParser` trait, with agent-specific implementations.
//!
//! ## Architecture
//!
//! Tool name normalization is handled by agent-specific adapters in the `adapters` module.
//! Each adapter normalizes tool names to a `CanonicalTool` enum, which is then mapped
//! to `ToolKind` for UI routing. This provides:
//!
//! - Single source of truth for tool → kind mapping
//! - Agent-specific name normalization in separate files
//! - Easy testing and maintenance

pub mod acp_fields;
pub mod adapters;
pub(crate) mod arguments;
pub mod canonical_tool;
pub(crate) mod claude_code_parser;
pub(crate) mod codex_parser;
pub(crate) mod cursor_parser;
pub(crate) mod edit_normalizers;
pub mod kind;
pub(crate) mod opencode_parser;
pub mod status;
mod types;

pub use adapters::{ClaudeCodeAdapter, CodexAdapter, CursorAdapter, OpenCodeAdapter};
pub use canonical_tool::CanonicalTool;
pub use claude_code_parser::ClaudeCodeParser;
pub use codex_parser::CodexParser;
pub use cursor_parser::CursorParser;
pub use opencode_parser::OpenCodeParser;
pub use types::{
    get_parser, AgentParser, AgentType, ParseError, ParsedQuestion, ParsedQuestionOption,
    ParsedTodo, ParsedTodoStatus, UpdateType,
};

#[cfg(test)]
mod tests;
