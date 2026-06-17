//! Shared parsed todo types used by agent parsers and provider-specific todo extractors.

/// Status of a todo item.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParsedTodoStatus {
    Pending,
    InProgress,
    Completed,
    Cancelled,
}

/// A parsed todo item in unified format.
#[derive(Debug, Clone, PartialEq)]
pub struct ParsedTodo {
    pub content: String,
    pub active_form: String,
    pub status: ParsedTodoStatus,
}
