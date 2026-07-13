//! Codex history ingress — rollout JSONL → ordered `ProviderEvent` stream.
//!
//! Production replay routes rollout JSONL → `CodexRolloutEventAccumulator` →
//! ordered `ProviderEvent` stream (no `StoredEntry` or `SessionThreadSnapshot` on ingress).

pub mod codex_history;
mod disk;

pub use disk::load_provider_events;

use async_trait::async_trait;

use crate::acp::session::ingress::event::ProviderEvent;
use crate::acp::session::ingress::source::{HistoryError, HistoryInput, HistorySource};

/// Reads Codex rollout JSONL history into provider-agnostic ingress events.
pub struct CodexHistorySource;

#[async_trait]
impl HistorySource for CodexHistorySource {
    async fn read(&self, input: HistoryInput) -> Result<Vec<ProviderEvent>, HistoryError> {
        let (project_path, source_path) = resolve_paths(&input)?;
        load_provider_events(&input.session_id, &project_path, source_path.as_deref())
            .await
            .map_err(|error| HistoryError::NotFound(error))
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::session::ingress::event::ProviderEventKind;
    use crate::acp::session::ingress::stored_entry_events::stored_entries_to_provider_events;
    use crate::acp::session_update::{ToolArguments, ToolCallData, ToolCallStatus, ToolKind};
    use crate::acp::types::CanonicalAgentId;
    use crate::session_jsonl::types::StoredEntry;

    #[tokio::test]
    async fn codex_history_source_reads_inside_active_tokio_runtime() {
        let temp_file = tempfile::NamedTempFile::new().expect("temp rollout file");

        let events = CodexHistorySource
            .read(HistoryInput {
                session_id: "missing-session".to_string(),
                workspace_root: Some(temp_file.path().to_path_buf()),
            })
            .await
            .expect("an empty rollout file should produce an empty event stream");

        assert!(events.is_empty());
    }

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
