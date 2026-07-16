//! OpenCode history ingress — local storage messages → ordered `ProviderEvent` stream.

mod disk;

use std::path::PathBuf;

use crate::acp::session::ingress::event::ProviderEvent;
use crate::acp::session::ingress::source::{HistoryError, HistoryInput, HistorySource};
use crate::acp::session_descriptor::SessionReplayContext;
use crate::acp::types::CanonicalAgentId;
pub use crate::opencode_history::convert::opencode_messages_to_provider_events;

use disk::load_opencode_messages_from_disk;

/// Reads OpenCode local storage history into provider-agnostic ingress events.
pub struct OpenCodeHistorySource;

impl HistorySource for OpenCodeHistorySource {
    fn read(&self, input: HistoryInput) -> Result<Vec<ProviderEvent>, HistoryError> {
        let source_path = resolve_source_path(&input)?;
        let messages = block_on_async(load_opencode_messages_from_disk(
            &input.session_id,
            source_path.as_deref(),
        ))
        .map_err(|error| HistoryError::Io(error.to_string()))?
        .ok_or_else(|| {
            HistoryError::NotFound(format!(
                "OpenCode provider history missing for session {}",
                input.session_id
            ))
        })?;

        Ok(opencode_messages_to_provider_events(&messages))
    }
}

fn block_on_async<F: std::future::Future>(future: F) -> F::Output {
    if let Ok(handle) = tokio::runtime::Handle::try_current() {
        handle.block_on(future)
    } else {
        tokio::runtime::Runtime::new()
            .expect("tokio runtime for OpenCode history ingress")
            .block_on(future)
    }
}

/// Resolve optional session metadata path from history input.
fn resolve_source_path(input: &HistoryInput) -> Result<Option<String>, HistoryError> {
    let Some(root) = &input.workspace_root else {
        return Ok(None);
    };

    if root.is_file() {
        return Ok(Some(root.display().to_string()));
    }

    if root.is_dir() {
        let by_session = root.join(format!("{}.json", input.session_id));
        if by_session.is_file() {
            return Ok(Some(by_session.display().to_string()));
        }
    }

    Ok(None)
}

/// Load OpenCode history events for production replay.
pub async fn load_replay_events(
    replay_context: &SessionReplayContext,
) -> Result<Vec<ProviderEvent>, HistoryError> {
    let input = HistoryInput {
        session_id: replay_context.history_session_id.clone(),
        workspace_root: replay_context.source_path.as_ref().map(PathBuf::from),
    };
    let source_path = resolve_source_path(&input)?;
    let messages = load_opencode_messages_from_disk(&input.session_id, source_path.as_deref())
        .await
        .map_err(|error| HistoryError::Io(error.to_string()))?
        .ok_or_else(|| {
            HistoryError::NotFound(format!(
                "OpenCode provider history missing for session {}",
                input.session_id
            ))
        })?;

    Ok(opencode_messages_to_provider_events(&messages))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::parsers::AgentType;
    use crate::acp::session::ingress::event::ProviderEventKind;
    use crate::acp::session_descriptor::{SessionDescriptorCompatibility, SessionReplayContext};
    use crate::opencode_history::types::{OpenCodeMessage, OpenCodeMessagePart};

    #[test]
    fn opencode_history_source_converts_messages_to_provider_events() {
        let messages = vec![
            OpenCodeMessage {
                id: "msg-user-1".to_string(),
                role: "user".to_string(),
                parts: vec![OpenCodeMessagePart::Text {
                    text: "Hello OpenCode".to_string(),
                }],
                model: None,
                timestamp: Some("2026-07-12T00:00:00Z".to_string()),
            },
            OpenCodeMessage {
                id: "msg-assistant-1".to_string(),
                role: "assistant".to_string(),
                parts: vec![OpenCodeMessagePart::Text {
                    text: "Hi there".to_string(),
                }],
                model: Some("openrouter/test-model".to_string()),
                timestamp: Some("2026-07-12T00:00:01Z".to_string()),
            },
        ];

        let events = opencode_messages_to_provider_events(&messages);

        assert_eq!(events.len(), 2);
        assert_eq!(events[0].source, CanonicalAgentId::OpenCode);
        assert!(matches!(
            &events[0].kind,
            ProviderEventKind::UserText { text, .. } if text == "Hello OpenCode"
        ));
        assert!(matches!(
            &events[1].kind,
            ProviderEventKind::AssistantText { text, .. } if text == "Hi there"
        ));
    }

    #[test]
    fn opencode_history_source_reports_missing_disk_history() {
        let source = OpenCodeHistorySource;
        let error = source
            .read(HistoryInput {
                session_id: "ses_nonexistent_fixture".to_string(),
                workspace_root: None,
            })
            .expect_err("missing opencode history should error");

        assert!(matches!(error, HistoryError::NotFound(_)));
    }

    #[tokio::test]
    async fn opencode_replay_returns_an_error_inside_an_active_tokio_runtime() {
        let replay_context = SessionReplayContext {
            local_session_id: "ses_nested-runtime".to_string(),
            history_session_id: "ses_nested-runtime".to_string(),
            agent_id: CanonicalAgentId::OpenCode,
            parser_agent_type: AgentType::OpenCode,
            project_path: "/project".to_string(),
            worktree_path: None,
            effective_cwd: "/project".to_string(),
            source_path: None,
            compatibility: SessionDescriptorCompatibility::Canonical,
        };

        let result = load_replay_events(&replay_context).await;

        assert!(matches!(result, Err(HistoryError::NotFound(_))));
    }

    #[tokio::test]
    #[ignore = "requires the local OpenCode SQLite database"]
    async fn real_f38_opencode_replay_returns_provider_events() {
        let replay_context = SessionReplayContext {
            local_session_id: "ses_0a3e2f368ffeLHjFLEnP4IL70v".to_string(),
            history_session_id: "ses_0a3e2f368ffeLHjFLEnP4IL70v".to_string(),
            agent_id: CanonicalAgentId::OpenCode,
            parser_agent_type: AgentType::OpenCode,
            project_path: "/Users/alex/Documents/fluentai".to_string(),
            worktree_path: None,
            effective_cwd: "/Users/alex/Documents/fluentai".to_string(),
            source_path: None,
            compatibility: SessionDescriptorCompatibility::Canonical,
        };

        let events = load_replay_events(&replay_context)
            .await
            .expect("F38 OpenCode replay should load from SQLite");

        assert!(!events.is_empty());
    }
}
