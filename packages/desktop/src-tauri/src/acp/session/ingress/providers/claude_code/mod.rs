//! Claude Code history ingress — NDJSON session updates → ordered `ProviderEvent` stream.

mod discovery;
mod jsonl;
pub mod session_jsonl;

use std::path::PathBuf;

use crate::acp::session::ingress::event::ProviderEvent;
use crate::acp::session::ingress::full_session_to_provider_events;
use crate::acp::session::ingress::source::{HistoryError, HistoryInput, HistorySource};
use crate::acp::session_descriptor::SessionReplayContext;
use crate::acp::types::CanonicalAgentId;

use discovery::find_session_file;
use jsonl::{parse_jsonl_file, session_updates_to_provider_events};
use session_jsonl::parser::parse_full_session_from_path;

/// Reads Claude Code NDJSON history into provider-agnostic ingress events.
pub struct ClaudeHistorySource;

impl HistorySource for ClaudeHistorySource {
    fn read(&self, input: HistoryInput) -> Result<Vec<ProviderEvent>, HistoryError> {
        let jsonl_path = resolve_jsonl_path(&input)?;
        let updates = match parse_jsonl_file(&jsonl_path) {
            Ok(updates) => updates,
            Err(error) => {
                return read_raw_claude_jsonl(&input, jsonl_path, error);
            }
        };
        Ok(session_updates_to_provider_events(
            CanonicalAgentId::ClaudeCode,
            &updates,
        ))
    }
}

fn read_raw_claude_jsonl(
    input: &HistoryInput,
    jsonl_path: PathBuf,
    original_error: HistoryError,
) -> Result<Vec<ProviderEvent>, HistoryError> {
    let session_id = input.session_id.clone();
    let full_session =
        block_on_async(
            async move { parse_full_session_from_path(&session_id, "", &jsonl_path).await },
        )
        .map_err(|error| {
            HistoryError::InvalidFormat(format!(
                "{original_error}; raw Claude parse failed: {error}"
            ))
        })?;

    Ok(full_session_to_provider_events(
        &full_session,
        CanonicalAgentId::ClaudeCode,
        crate::acp::parsers::AgentType::ClaudeCode,
    ))
}

fn block_on_async<F>(future: F) -> F::Output
where
    F: std::future::Future + Send + 'static,
    F::Output: Send + 'static,
{
    if tokio::runtime::Handle::try_current().is_ok() {
        std::thread::spawn(move || {
            tokio::runtime::Runtime::new()
                .expect("create runtime for Claude history parsing")
                .block_on(future)
        })
        .join()
        .expect("Claude history parsing thread should complete")
    } else {
        tokio::runtime::Runtime::new()
            .expect("create runtime for Claude history parsing")
            .block_on(future)
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
    use std::fs;
    use std::path::PathBuf;
    use tempfile::TempDir;

    fn historical_tool_call_fixture_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/acp/reconciler/tests/fixtures")
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

    #[test]
    fn claude_history_source_reads_raw_claude_sidechain_jsonl() {
        const SESSION_ID: &str = "550e8400-e29b-41d4-a716-446655440000";
        let temp_dir = TempDir::new().expect("temp dir");
        let session_dir = temp_dir.path().join("project");
        let subagents_dir = session_dir.join("subagents");
        fs::create_dir_all(&subagents_dir).expect("create subagents dir");

        let agent_id = "ac373ea9520618f17";
        let parent_tool_use_id = "toolu_task_parent";
        let session_path = session_dir.join(format!("{SESSION_ID}.jsonl"));
        let parent_content = [
            serde_json::json!({
                "type": "queue-operation",
                "operation": "enqueue",
                "sessionId": SESSION_ID
            })
            .to_string(),
            serde_json::json!({
                "parentUuid": null,
                "isSidechain": false,
                "type": "assistant",
                "sessionId": SESSION_ID,
                "uuid": "parent-assistant",
                "timestamp": "2026-07-16T12:07:32.288Z",
                "message": {
                    "role": "assistant",
                    "content": [{
                        "type": "tool_use",
                        "id": parent_tool_use_id,
                        "name": "Agent",
                        "input": {
                            "description": "Inspect dir",
                            "subagent_type": "Explore",
                            "prompt": "Read README.md"
                        }
                    }]
                }
            })
            .to_string(),
            serde_json::json!({
                "parentUuid": "parent-assistant",
                "isSidechain": false,
                "type": "user",
                "sessionId": SESSION_ID,
                "uuid": "parent-result",
                "timestamp": "2026-07-16T12:07:41.805Z",
                "message": {
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": parent_tool_use_id,
                        "content": [{
                            "type": "text",
                            "text": "Child report"
                        }]
                    }]
                },
                "toolUseResult": {
                    "status": "completed",
                    "agentId": agent_id,
                    "agentType": "Explore",
                    "content": [{
                        "type": "text",
                        "text": "Child report"
                    }]
                }
            })
            .to_string(),
        ]
        .join("\n");
        fs::write(&session_path, parent_content).expect("write parent session");

        let sidechain_path = subagents_dir.join(format!("agent-{agent_id}.jsonl"));
        let sidechain_content = [
            serde_json::json!({
                "parentUuid": null,
                "isSidechain": true,
                "agentId": agent_id,
                "type": "user",
                "sessionId": SESSION_ID,
                "uuid": "child-user",
                "timestamp": "2026-07-16T12:07:32.303Z",
                "message": {
                    "role": "user",
                    "content": "Read README.md"
                }
            })
            .to_string(),
            serde_json::json!({
                "parentUuid": "child-user",
                "isSidechain": true,
                "agentId": agent_id,
                "type": "assistant",
                "sessionId": SESSION_ID,
                "uuid": "child-assistant",
                "timestamp": "2026-07-16T12:07:41.768Z",
                "message": {
                    "role": "assistant",
                    "content": [{
                        "type": "text",
                        "text": "Child report"
                    }]
                }
            })
            .to_string(),
        ]
        .join("\n");
        fs::write(sidechain_path, sidechain_content).expect("write sidechain session");

        let source = ClaudeHistorySource;
        let events = source
            .read(HistoryInput {
                session_id: SESSION_ID.to_string(),
                workspace_root: Some(session_path),
            })
            .expect("raw Claude JSONL should parse");

        assert!(events.iter().any(|event| {
            matches!(
                &event.kind,
                ProviderEventKind::AssistantText {
                    text,
                    parent_tool_use_id: event_parent_tool_use_id
                } if text == "Child report"
                    && event_parent_tool_use_id.as_deref() == Some(parent_tool_use_id)
            )
        }));
    }
}
