//! Codex history ingress — rollout JSONL → ordered `ProviderEvent` stream.
//!
//! Production replay routes rollout JSONL → `CodexRolloutEventAccumulator` →
//! ordered `ProviderEvent` stream (no `StoredEntry` or `SessionThreadSnapshot` on ingress).

pub mod codex_history;
mod disk;

pub use disk::load_provider_events;

use std::path::PathBuf;

use crate::acp::session::ingress::event::ProviderEvent;
use crate::acp::session::ingress::source::{HistoryError, HistoryInput, HistorySource};
use crate::acp::session_descriptor::SessionReplayContext;

/// Reads Codex rollout JSONL history into provider-agnostic ingress events.
pub struct CodexHistorySource;

impl HistorySource for CodexHistorySource {
    fn read(&self, input: HistoryInput) -> Result<Vec<ProviderEvent>, HistoryError> {
        let (project_path, source_path) = resolve_paths(&input)?;
        block_on_async(load_provider_events(
            &input.session_id,
            &project_path,
            source_path.as_deref(),
        ))
        .map_err(|error| HistoryError::NotFound(error))
    }
}

fn block_on_async<F: std::future::Future>(future: F) -> F::Output {
    if let Ok(handle) = tokio::runtime::Handle::try_current() {
        handle.block_on(future)
    } else {
        tokio::runtime::Runtime::new()
            .expect("tokio runtime for Codex history ingress")
            .block_on(future)
    }
}

fn resolve_paths(input: &HistoryInput) -> Result<(String, Option<String>), HistoryError> {
    let Some(root) = &input.workspace_root else {
        return Ok((String::new(), None));
    };

    if root.is_file() {
        return Ok((String::new(), Some(root.display().to_string())));
    }

    if root.is_dir() {
        return Ok((root.display().to_string(), None));
    }

    Err(HistoryError::NotFound(format!(
        "Codex history path does not exist: {}",
        root.display()
    )))
}

/// Load Codex history events for production replay.
pub async fn load_replay_events(
    replay_context: &SessionReplayContext,
) -> Result<Vec<ProviderEvent>, HistoryError> {
    let source = CodexHistorySource;
    source.read(HistoryInput {
        session_id: replay_context.history_session_id.clone(),
        workspace_root: Some(PathBuf::from(&replay_context.project_path)),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::session::ingress::event::ProviderEventKind;
    use crate::acp::session::ingress::stored_entry_events::stored_entries_to_provider_events;
    use crate::acp::session_update::{ToolArguments, ToolCallData, ToolCallStatus, ToolKind};
    use crate::acp::types::CanonicalAgentId;
    use crate::session_jsonl::types::StoredEntry;

    #[test]
    fn codex_stored_entries_map_to_provider_events() {
        let entries = vec![
            StoredEntry::User {
                id: "user-1".to_string(),
                message: crate::session_jsonl::types::StoredUserMessage {
                    id: Some("user-1".to_string()),
                    content: crate::session_jsonl::types::StoredContentBlock {
                        block_type: "text".to_string(),
                        text: Some("Run the tests".to_string()),
                    },
                    chunks: vec![],
                    sent_at: None,
                },
                timestamp: None,
            },
            StoredEntry::ToolCall {
                id: "tool-1".to_string(),
                message: ToolCallData {
                    id: "tool-1".to_string(),
                    name: "Read".to_string(),
                    arguments: ToolArguments::Read {
                        file_path: Some("/repo/README.md".to_string()),
                        source_context: None,
                    },
                    diagnostic_input: None,
                    status: ToolCallStatus::Completed,
                    result: None,
                    kind: Some(ToolKind::Read),
                    title: Some("Read README".to_string()),
                    locations: None,
                    skill_meta: None,
                    normalized_questions: None,
                    normalized_todos: None,
                    normalized_todo_update: None,
                    parent_tool_use_id: None,
                    task_children: None,
                    question_answer: None,
                    awaiting_plan_approval: false,
                    plan_approval_request_id: None,
                },
                timestamp: None,
            },
        ];

        let events = stored_entries_to_provider_events(&entries, CanonicalAgentId::Codex);
        assert_eq!(events.len(), 2);
        assert!(matches!(
            &events[0].kind,
            ProviderEventKind::UserText { text, .. } if text == "Run the tests"
        ));
        assert!(matches!(&events[1].kind, ProviderEventKind::ToolCall(_)));
    }
}
