//! Claude Code history ingress — NDJSON session updates → ordered `ProviderEvent` stream.

mod discovery;
mod jsonl;
pub mod session_jsonl;

use std::path::PathBuf;

use crate::acp::session::ingress::event::ProviderEvent;
use crate::acp::session::ingress::source::{HistoryError, HistoryInput, HistorySource};
use crate::acp::session_descriptor::SessionReplayContext;
use crate::acp::types::CanonicalAgentId;

use discovery::find_session_file;
use jsonl::{parse_jsonl_file, session_updates_to_provider_events};

/// Reads Claude Code NDJSON history into provider-agnostic ingress events.
pub struct ClaudeHistorySource;

impl HistorySource for ClaudeHistorySource {
    fn read(&self, input: HistoryInput) -> Result<Vec<ProviderEvent>, HistoryError> {
        let jsonl_path = resolve_jsonl_path(&input)?;
        let updates = parse_jsonl_file(&jsonl_path)?;
        Ok(session_updates_to_provider_events(
            CanonicalAgentId::ClaudeCode,
            &updates,
        ))
    }
}

/// Resolve NDJSON path from history input.
///
/// Accepts a direct `.jsonl` file path or a directory containing:
/// - `{session_id}.jsonl`, or
/// - `historical-tool-call-session.jsonl` (reconciler test fixture layout).
fn resolve_jsonl_path(input: &HistoryInput) -> Result<PathBuf, HistoryError> {
    let Some(root) = &input.workspace_root else {
        return Err(HistoryError::NotFound(format!(
            "Claude history path not provided for session {}",
            input.session_id
        )));
    };

    if root.extension().is_some_and(|ext| ext == "jsonl") && root.is_file() {
        return Ok(root.clone());
    }

    if root.is_dir() {
        let by_session = root.join(format!("{}.jsonl", input.session_id));
        if by_session.is_file() {
            return Ok(by_session);
        }

        let fixture = root.join("historical-tool-call-session.jsonl");
        if fixture.is_file() {
            return Ok(fixture);
        }

        return Err(HistoryError::NotFound(format!(
            "no Claude NDJSON history found under {}",
            root.display()
        )));
    }

    Err(HistoryError::NotFound(format!(
        "Claude history path does not exist: {}",
        root.display()
    )))
}

/// Load Claude history events for production replay (project-path discovery).
pub async fn load_replay_events(
    replay_context: &SessionReplayContext,
) -> Result<Vec<ProviderEvent>, HistoryError> {
    let session_id = replay_context.history_session_id.clone();
    let mut project_paths = Vec::new();
    if !replay_context.effective_cwd.is_empty() {
        project_paths.push(replay_context.effective_cwd.clone());
    }
    if replay_context.project_path != replay_context.effective_cwd {
        project_paths.push(replay_context.project_path.clone());
    }

    let mut last_error: Option<HistoryError> = None;
    for project_path in project_paths {
        match find_session_file(&session_id, &project_path).await {
            Ok(jsonl_path) => {
                let source = ClaudeHistorySource;
                return source.read(HistoryInput {
                    session_id: session_id.clone(),
                    workspace_root: Some(jsonl_path),
                });
            }
            Err(error) => {
                last_error = Some(if error.to_string().contains("not found") {
                    HistoryError::NotFound(format!("Claude provider history missing: {error}"))
                } else {
                    HistoryError::InvalidFormat(format!(
                        "Claude provider history parse failed: {error}"
                    ))
                });
            }
        }
    }

    Err(last_error.unwrap_or_else(|| {
        HistoryError::NotFound(format!(
            "Claude provider history missing for session {session_id}"
        ))
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::session::ingress::event::ProviderEventKind;
    use crate::acp::session_update::ToolCallStatus;
    use std::path::PathBuf;

    fn historical_tool_call_fixture_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("src/acp/session/ingress/tool_identity/tests/fixtures")
    }

    fn historical_tool_call_fixture_path() -> PathBuf {
        historical_tool_call_fixture_dir().join("historical-tool-call-session.jsonl")
    }

    #[test]
    fn claude_history_source_reads_tool_call_fixture() {
        const SESSION_ID: &str = "sess-hist-001";
        let fixture_dir = historical_tool_call_fixture_dir();
        assert!(
            historical_tool_call_fixture_path().exists(),
            "fixture not found under {}",
            fixture_dir.display()
        );

        let source = ClaudeHistorySource;
        let events = source
            .read(HistoryInput {
                session_id: SESSION_ID.to_string(),
                workspace_root: Some(fixture_dir),
            })
            .expect("read claude tool-call fixture");

        assert_eq!(events.len(), 4);
        assert!(events.iter().any(|event| {
            matches!(
                &event.kind,
                ProviderEventKind::ToolCall(tool_call) if tool_call.id == "call-read-1"
            )
        }));
        assert!(events.iter().any(|event| {
            matches!(
                &event.kind,
                ProviderEventKind::ToolCallUpdate(update)
                    if update.tool_call_id == "call-read-1"
                        && update.status == Some(ToolCallStatus::Completed)
            )
        }));
    }

    #[test]
    fn claude_history_source_reads_direct_jsonl_path() {
        const SESSION_ID: &str = "sess-hist-001";
        let fixture_path = historical_tool_call_fixture_path();

        let source = ClaudeHistorySource;
        let events = source
            .read(HistoryInput {
                session_id: SESSION_ID.to_string(),
                workspace_root: Some(fixture_path),
            })
            .expect("read claude tool-call fixture via direct path");

        assert_eq!(events.len(), 4);
        assert_eq!(events[0].source, CanonicalAgentId::ClaudeCode);
    }
}
