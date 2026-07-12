//! NDJSON session-update history → ingress `ProviderEvent` mapping.

use std::fs;
use std::path::Path;

use crate::acp::parsers::AgentType;
use crate::acp::session::ingress::event::{ProviderEvent, ProviderEventKind};
use crate::acp::session::ingress::source::HistoryError;
use crate::acp::session_update::parse_session_update_with_agent;
use crate::acp::session_update::{ContentChunk, SessionUpdate};
use crate::acp::types::{CanonicalAgentId, ContentBlock};

const DEFAULT_FIXTURE_AGENT: AgentType = AgentType::ClaudeCode;

/// Read an NDJSON file and parse each non-empty line into a typed [`SessionUpdate`].
pub fn parse_jsonl_file(path: &Path) -> Result<Vec<SessionUpdate>, HistoryError> {
    let contents = fs::read_to_string(path)
        .map_err(|error| HistoryError::Io(format!("{}: {error}", path.display())))?;

    parse_jsonl_lines(&contents)
}

/// Parse NDJSON text into typed session updates.
pub fn parse_jsonl_lines(contents: &str) -> Result<Vec<SessionUpdate>, HistoryError> {
    contents
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .enumerate()
        .map(|(index, line)| {
            let value: serde_json::Value = serde_json::from_str(line).map_err(|error| {
                HistoryError::InvalidFormat(format!(
                    "invalid JSON on line {}: {error}",
                    index + 1
                ))
            })?;
            parse_session_update_with_agent::<serde_json::Error>(&value, DEFAULT_FIXTURE_AGENT)
                .map_err(|error| {
                    HistoryError::InvalidFormat(format!(
                        "failed to parse session update on line {}: {error}",
                        index + 1
                    ))
                })
        })
        .collect()
}

/// Map replayed session updates into the shared ingress vocabulary.
pub fn session_updates_to_provider_events(
    source: CanonicalAgentId,
    updates: &[SessionUpdate],
) -> Vec<ProviderEvent> {
    updates
        .iter()
        .enumerate()
        .filter_map(|(index, update)| session_update_to_provider_event(source.clone(), index, update))
        .collect()
}

fn session_update_to_provider_event(
    source: CanonicalAgentId,
    index: usize,
    update: &SessionUpdate,
) -> Option<ProviderEvent> {
    let provider_seq = index as u64 + 1;
    let provider_row_id = provider_row_id_for_update(index, update);

    let kind = match update {
        SessionUpdate::UserMessageChunk { chunk, .. } => {
            let text = user_text_from_chunk(chunk)?;
            ProviderEventKind::UserText { text }
        }
        SessionUpdate::ToolCall { tool_call, .. } => {
            ProviderEventKind::ToolCall(tool_call.clone())
        }
        SessionUpdate::ToolCallUpdate { update, .. } => {
            ProviderEventKind::ToolCallUpdate(update.clone())
        }
        _ => return None,
    };

    Some(ProviderEvent {
        source,
        provider_seq,
        provider_row_id,
        timestamp_ms: None,
        kind,
    })
}

fn provider_row_id_for_update(index: usize, update: &SessionUpdate) -> String {
    match update {
        SessionUpdate::ToolCall { tool_call, .. } => tool_call.id.clone(),
        SessionUpdate::ToolCallUpdate { update, .. } => format!("{}:update", update.tool_call_id),
        SessionUpdate::UserMessageChunk { .. } => format!("user-{index}"),
        _ => format!("row-{index}"),
    }
}

fn user_text_from_chunk(chunk: &ContentChunk) -> Option<String> {
    match &chunk.content {
        ContentBlock::Text { text } if !text.is_empty() => Some(text.clone()),
        _ => None,
    }
}
