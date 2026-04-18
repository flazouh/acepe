//! Presentation-free semantic tool records (Unit 2).
//!
//! [`SemanticTransition`] is the shared output of provider classification + projection. Live and
//! streaming paths should prefer [`crate::acp::reconciler::semantic_transition`] over calling
//! `providers::classify` and the projector separately so semantics stay single-sourced.

use crate::acp::session_update::{QuestionItem, TodoItem, ToolArguments, ToolKind};

use super::SignalName;

/// Canonical semantic snapshot for one tool call after classification and argument parsing.
#[derive(Debug, Clone, PartialEq)]
pub struct SemanticToolRecord {
    pub kind: ToolKind,
    pub arguments: ToolArguments,
    pub normalized_questions: Option<Vec<QuestionItem>>,
    pub normalized_todos: Option<Vec<TodoItem>>,
}

impl SemanticToolRecord {
    pub fn new(
        kind: ToolKind,
        arguments: ToolArguments,
        normalized_questions: Option<Vec<QuestionItem>>,
        normalized_todos: Option<Vec<TodoItem>>,
    ) -> Self {
        Self {
            kind,
            arguments,
            normalized_questions,
            normalized_todos,
        }
    }
}

/// Result of classifying a raw tool frame and projecting it once for the desktop wire contract.
#[derive(Debug, Clone, PartialEq)]
pub struct SemanticTransition {
    pub record: SemanticToolRecord,
    /// Always [`super::projector::project_semantic_record`] of `record` — single projection authority.
    pub projected_arguments: ToolArguments,
    pub signals_tried: Vec<SignalName>,
}
