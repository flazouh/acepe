use crate::acp::session_state_engine::protocol::SessionStatePayload;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SessionStateEnvelopeByteBudgetStatus {
    pub kind: SessionStatePayloadKind,
    pub byte_len: usize,
    pub max_bytes: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionStatePayloadKind {
    Snapshot,
    Delta,
    Lifecycle,
    Capabilities,
    Telemetry,
    Plan,
    AssistantTextDelta,
    ViewportBufferPush,
    ViewportBufferDelta,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SessionStateEnvelope {
    pub session_id: String,
    pub graph_revision: i64,
    pub last_event_seq: i64,
    pub payload: SessionStatePayload,
}

pub fn session_state_envelope_byte_budget_status(
    envelope: &SessionStateEnvelope,
) -> Result<SessionStateEnvelopeByteBudgetStatus, SessionStateEnvelopeByteBudgetStatus> {
    let kind = SessionStatePayloadKind::from_payload(&envelope.payload);
    let max_bytes = kind.max_bytes();
    let byte_len = serde_json::to_vec(envelope)
        .map(|bytes| bytes.len())
        .unwrap_or(usize::MAX);
    let status = SessionStateEnvelopeByteBudgetStatus {
        kind,
        byte_len,
        max_bytes,
    };
    if byte_len <= max_bytes {
        Ok(status)
    } else {
        Err(status)
    }
}

impl SessionStatePayloadKind {
    fn from_payload(payload: &SessionStatePayload) -> Self {
        match payload {
            SessionStatePayload::Snapshot { .. } => Self::Snapshot,
            SessionStatePayload::Delta { .. } => Self::Delta,
            SessionStatePayload::Lifecycle { .. } => Self::Lifecycle,
            SessionStatePayload::Capabilities { .. } => Self::Capabilities,
            SessionStatePayload::Telemetry { .. } => Self::Telemetry,
            SessionStatePayload::Plan { .. } => Self::Plan,
            SessionStatePayload::AssistantTextDelta { .. } => Self::AssistantTextDelta,
            SessionStatePayload::ViewportBufferPush { .. } => Self::ViewportBufferPush,
            SessionStatePayload::ViewportBufferDelta { .. } => Self::ViewportBufferDelta,
        }
    }

    pub fn max_bytes(self) -> usize {
        match self {
            Self::Snapshot => 2_000_000,
            Self::Delta => 64_000,
            Self::Lifecycle => 8_000,
            Self::Capabilities => 128_000,
            Self::Telemetry => 16_000,
            Self::Plan => 128_000,
            Self::AssistantTextDelta => 8_000,
            // A buffer push carries the visible slice plus a bounded overscan
            // window; the producer shrinks the buffer to stay under this cap.
            Self::ViewportBufferPush => 512_000,
            Self::ViewportBufferDelta => 128_000,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::session_state_engine::protocol::{
        CapabilityPreviewState, ViewportBufferDiagnostic, ViewportBufferPush,
    };
    use crate::acp::session_state_engine::revision::SessionGraphRevision;
    use crate::acp::session_state_engine::selectors::SessionGraphCapabilities;
    use crate::acp::session_update::AvailableCommand;
    use crate::acp::transcript_projection::{TranscriptEntryRole, TranscriptSegment};
    use crate::acp::transcript_viewport::{
        TranscriptViewportRow, TranscriptViewportRowContent, TranscriptViewportRowKind,
        ViewportMode,
    };

    fn revision() -> SessionGraphRevision {
        SessionGraphRevision {
            graph_revision: 1,
            transcript_revision: 1,
            last_event_seq: 1,
        }
    }

    fn capabilities_envelope(capabilities: SessionGraphCapabilities) -> SessionStateEnvelope {
        SessionStateEnvelope {
            session_id: "session-1".to_string(),
            graph_revision: 1,
            last_event_seq: 1,
            payload: SessionStatePayload::Capabilities {
                capabilities: Box::new(capabilities),
                revision: revision(),
                pending_mutation_id: None,
                preview_state: CapabilityPreviewState::Canonical,
            },
        }
    }

    fn buffer_push_envelope(rows: Vec<TranscriptViewportRow>) -> SessionStateEnvelope {
        let row_count = rows.len();
        SessionStateEnvelope {
            session_id: "session-1".to_string(),
            graph_revision: 1,
            last_event_seq: 1,
            payload: SessionStatePayload::ViewportBufferPush {
                push: ViewportBufferPush {
                    session_id: "session-1".to_string(),
                    graph_revision: revision(),
                    viewport_revision: 1,
                    emission_seq: 0,
                    buffer_start_index: 0,
                    buffer_end_index: row_count,
                    layout_row_count: row_count,
                    total_height_px: 10_000,
                    buffer_end_offset_px: 10_000,
                    rows,
                    offsets_px: Vec::new(),
                    mode: ViewportMode::FollowingTail,
                    request_generation: None,
                    scroll_top_target: None,
                    diagnostics: Vec::new(),
                },
            },
        }
    }

    fn visible_row(index: usize, text: String) -> TranscriptViewportRow {
        TranscriptViewportRow {
            row_id: format!("transcript:row-{index}"),
            source_entry_id: format!("row-{index}"),
            kind: TranscriptViewportRowKind::AssistantText,
            version: format!("v-{index}"),
            anchor_eligible: true,
            active_streaming_tail: None,
            operation_links: Vec::new(),
            interaction_links: Vec::new(),
            content: TranscriptViewportRowContent::Transcript {
                role: TranscriptEntryRole::Assistant,
                segments: vec![TranscriptSegment::Text {
                    segment_id: format!("row-{index}:text"),
                    text,
                }],
            },
        }
    }

    #[test]
    fn accepts_large_provider_command_catalog_capabilities() {
        let available_commands = (0..118)
            .map(|index| AvailableCommand {
                name: format!("command-{index}"),
                description:
                    "Provider command description with enough text to match a real Claude Code catalog entry."
                        .to_string(),
                input: None,
            })
            .collect();
        let capabilities = SessionGraphCapabilities {
            models: None,
            modes: None,
            available_commands: Some(available_commands),
            config_options: None,
            autonomous_enabled: Some(true),
        };

        let status =
            session_state_envelope_byte_budget_status(&capabilities_envelope(capabilities))
                .expect("large command catalog should fit capabilities budget");

        assert_eq!(status.kind, SessionStatePayloadKind::Capabilities);
    }

    #[test]
    fn rejects_oversized_capabilities() {
        let capabilities = SessionGraphCapabilities {
            models: None,
            modes: None,
            available_commands: Some(vec![AvailableCommand {
                name: "oversized".to_string(),
                description: "x".repeat(SessionStatePayloadKind::Capabilities.max_bytes()),
                input: None,
            }]),
            config_options: None,
            autonomous_enabled: Some(true),
        };

        let status =
            session_state_envelope_byte_budget_status(&capabilities_envelope(capabilities))
                .expect_err("oversized command catalog should be rejected");

        assert_eq!(status.kind, SessionStatePayloadKind::Capabilities);
        assert_eq!(
            status.max_bytes,
            SessionStatePayloadKind::Capabilities.max_bytes()
        );
    }

    #[test]
    fn viewport_buffer_push_has_its_own_budget() {
        let status =
            session_state_envelope_byte_budget_status(&buffer_push_envelope(vec![visible_row(
                1,
                "hello".to_string(),
            )]))
            .expect("small buffer push should fit");

        assert_eq!(status.kind, SessionStatePayloadKind::ViewportBufferPush);
        assert_eq!(
            status.max_bytes,
            SessionStatePayloadKind::ViewportBufferPush.max_bytes()
        );
    }

    #[test]
    fn viewport_buffer_push_budget_rejects_accidental_full_transcript_payload() {
        let rows = (0..6_000)
            .map(|index| visible_row(index, "x".repeat(120)))
            .collect();

        let status = session_state_envelope_byte_budget_status(&buffer_push_envelope(rows))
            .expect_err("full transcript shaped buffer push should be rejected");

        assert_eq!(status.kind, SessionStatePayloadKind::ViewportBufferPush);
    }
}
