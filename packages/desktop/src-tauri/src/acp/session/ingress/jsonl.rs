//! NDJSON session-update history → ingress `ProviderEvent` mapping.

use std::fs;
use std::path::Path;

use crate::acp::parsers::AgentType;
use crate::acp::session::ingress::source::HistoryError;
use crate::acp::session_update::SessionUpdate;

pub use crate::acp::session::ingress::live_session_update::session_updates_to_provider_events;

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
                HistoryError::InvalidFormat(format!("invalid JSON on line {}: {error}", index + 1))
            })?;
            crate::acp::session_update::parse_session_update_with_agent::<serde_json::Error>(
                &value,
                DEFAULT_FIXTURE_AGENT,
            )
            .map_err(|error| {
                HistoryError::InvalidFormat(format!(
                    "failed to parse session update on line {}: {error}",
                    index + 1
                ))
            })
        })
        .collect()
}
