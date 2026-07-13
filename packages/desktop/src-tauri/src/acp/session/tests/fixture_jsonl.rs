//! Parse historical NDJSON session-update fixtures into ingress events (test helpers).

use crate::acp::session::ingress::jsonl::parse_jsonl_file;
use crate::acp::session_update::SessionUpdate;
use crate::acp::types::CanonicalAgentId;
use std::path::Path;

/// Read an NDJSON fixture and parse each non-empty line into a typed [`SessionUpdate`].
pub fn parse_jsonl_fixture(path: &Path) -> Vec<SessionUpdate> {
    parse_jsonl_file(path).unwrap_or_else(|error| {
        panic!(
            "fixture not found or invalid at {}: {error}",
            path.display()
        )
    })
}

pub use crate::acp::session::ingress::jsonl::session_updates_to_provider_events;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::session::ingress::event::ProviderEventKind;
    use crate::acp::session_update::ToolCallStatus;
    use std::path::PathBuf;

    #[test]
    fn historical_tool_call_fixture_parses_and_maps_to_provider_events() {
        let fixture_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("src/acp/session/ingress/tool_identity/tests/fixtures/historical-tool-call-session.jsonl");
        let updates = parse_jsonl_fixture(&fixture_path);
        assert_eq!(updates.len(), 4);

        let events = session_updates_to_provider_events(CanonicalAgentId::ClaudeCode, &updates);
        assert_eq!(events.len(), 4);
        assert!(events.iter().any(|event| {
            matches!(
                &event.kind,
                ProviderEventKind::ToolCall(tool_call)
                    if tool_call.id == "call-read-1"
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
}
