//! Pure semantic → desktop wire projection (R3, R13).
//!
//! The projector is deterministic and provider-agnostic: it operates only on typed
//! [`crate::acp::session_update::ToolArguments`] and related structs, not raw provider strings.

use crate::acp::reconciler::semantic::{SemanticToolRecord, SemanticTransition};
use crate::acp::session_update::derive_normalized_questions_and_todos;
use crate::acp::session_update::ToolArguments;

use super::ClassificationOutput;

/// Project a semantic record into the desktop `ToolArguments` union.
///
/// Today this is mostly identity: classification has already produced typed arguments including
/// optional [`crate::acp::session_update::ToolSourceContext`] on read tools. Later units may merge
/// task-association or streaming state here without changing the frontend contract shape.
pub fn project_semantic_record(record: &SemanticToolRecord) -> ToolArguments {
    let _ = (
        record.kind,
        &record.normalized_questions,
        &record.normalized_todos,
    );
    record.arguments.clone()
}

/// Build a [`SemanticTransition`] after shared classification — keeps projection in one place.
pub fn transition_from_classification(
    output: ClassificationOutput,
    normalization_name: &str,
    raw_arguments: &serde_json::Value,
    agent: crate::acp::parsers::AgentType,
) -> SemanticTransition {
    let ClassificationOutput {
        kind,
        arguments,
        signals_tried,
    } = output;
    let (normalized_questions, normalized_todos, normalized_todo_update) =
        derive_normalized_questions_and_todos(normalization_name, raw_arguments, agent);
    let record = SemanticToolRecord::new(
        kind,
        arguments.clone(),
        normalized_questions,
        normalized_todos,
        normalized_todo_update,
    );
    let projected_arguments = project_semantic_record(&record);
    SemanticTransition {
        record,
        projected_arguments,
        signals_tried,
    }
}

/// Convenience: verify projector-derived kind matches payload (`kind` remains derived metadata).
#[allow(dead_code)]
pub fn projected_tool_kind(arguments: &ToolArguments) -> crate::acp::session_update::ToolKind {
    arguments.tool_kind()
}
