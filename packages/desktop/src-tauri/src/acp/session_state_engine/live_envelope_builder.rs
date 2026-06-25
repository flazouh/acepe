//! Live session-state envelope construction for the runtime registry.
//!
//! Owns delta, assistant-text chunking, lifecycle, capabilities, telemetry, and
//! plan envelope builders plus UTF-8 char-boundary slicing utilities.

use crate::acp::session_state_engine::protocol::AssistantTextDeltaPayload;
use crate::acp::session_state_engine::selectors::{
    SessionGraphCapabilities, SessionGraphLifecycle,
};
use crate::acp::session_state_engine::{
    build_delta_envelope, session_state_envelope_byte_budget_status, turn_terminal_change_fields,
    CapabilityPreviewState, DeltaEnvelopeParts, DeltaSessionProjectionFields, SessionGraphRevision,
    SessionStateEnvelope, SessionStateField, SessionStatePayload,
};
use crate::acp::session_update::SessionUpdate;
use crate::acp::transcript_projection::{
    TranscriptDelta, TranscriptDeltaOperation, TranscriptEntry, TranscriptEntryRole,
    TranscriptSnapshot,
};

pub(crate) fn build_live_session_state_delta_envelope(
    delta: &TranscriptDelta,
    from_revision: SessionGraphRevision,
    to_revision: SessionGraphRevision,
    projection: DeltaSessionProjectionFields,
) -> SessionStateEnvelope {
    build_delta_envelope(DeltaEnvelopeParts {
        session_id: &delta.session_id,
        from_revision,
        to_revision,
        projection,
        transcript_operations: delta.operations.clone(),
        operation_patches: Vec::new(),
        interaction_patches: Vec::new(),
        changed_fields: {
            let mut fields = turn_terminal_change_fields();
            fields.insert(0, SessionStateField::TranscriptSnapshot);
            fields
        },
    })
}

pub(crate) fn build_assistant_text_delta_from_components(
    session_id: &str,
    update: &SessionUpdate,
    transcript_delta: &TranscriptDelta,
    snapshot: &TranscriptSnapshot,
    revision: SessionGraphRevision,
) -> Vec<SessionStateEnvelope> {
    let SessionUpdate::AgentMessageChunk {
        chunk,
        produced_at_monotonic_ms: Some(produced_at_monotonic_ms),
        ..
    } = update
    else {
        return Vec::new();
    };
    let Some(delta_text) = assistant_text_from_update_chunk(chunk) else {
        return Vec::new();
    };
    let Some(row_entry_id) = assistant_row_entry_id(transcript_delta) else {
        return Vec::new();
    };
    let Some((row_index, row_entry)) = snapshot.entries.iter().enumerate().find(|(_, entry)| {
        entry.role == TranscriptEntryRole::Assistant && entry.entry_id == row_entry_id
    }) else {
        return Vec::new();
    };
    let total_chars = transcript_entry_text_char_count(row_entry);
    let delta_chars = delta_text.chars().count();
    let char_offset_chars = total_chars.saturating_sub(delta_chars);
    let start_char_offset = match u32::try_from(char_offset_chars) {
        Ok(value) => value,
        Err(_) => {
            tracing::error!(
                session_id,
                row_entry_id,
                char_offset_chars,
                "Assistant text delta char offset exceeded u32::MAX; skipping envelope"
            );
            return Vec::new();
        }
    };
    // The token-stream rowId MUST be the canonical transcript entry_id verbatim.
    // It is the single streaming-row identity shared with activeStreamingTail.row_id
    // and the scene entries; the reveal controller looks the stream up by it. A
    // sanitized variant minted a second identity the consumer could never reconcile,
    // so the token stream was unreachable and token-reveal stayed dormant.
    let row_id = row_entry_id.to_string();
    let turn_id = assistant_turn_id_from_snapshot(snapshot, row_index, &row_id);
    build_budgeted_assistant_text_delta_state_envelopes(
        session_id,
        revision,
        turn_id,
        row_id,
        start_char_offset,
        delta_text,
        *produced_at_monotonic_ms,
    )
}

pub(crate) fn build_live_session_state_telemetry_envelope(
    session_id: &str,
    telemetry: crate::acp::session_update::UsageTelemetryData,
    revision: SessionGraphRevision,
) -> SessionStateEnvelope {
    SessionStateEnvelope {
        session_id: session_id.to_string(),
        graph_revision: revision.graph_revision,
        last_event_seq: revision.last_event_seq,
        payload: SessionStatePayload::Telemetry {
            telemetry,
            revision,
        },
    }
}

pub(crate) fn build_live_session_state_plan_envelope(
    session_id: &str,
    plan: crate::acp::session_update::PlanData,
    revision: SessionGraphRevision,
) -> SessionStateEnvelope {
    SessionStateEnvelope {
        session_id: session_id.to_string(),
        graph_revision: revision.graph_revision,
        last_event_seq: revision.last_event_seq,
        payload: SessionStatePayload::Plan { plan, revision },
    }
}

pub(crate) fn build_live_session_state_lifecycle_envelope(
    session_id: &str,
    lifecycle: SessionGraphLifecycle,
    revision: SessionGraphRevision,
) -> SessionStateEnvelope {
    SessionStateEnvelope {
        session_id: session_id.to_string(),
        graph_revision: revision.graph_revision,
        last_event_seq: revision.last_event_seq,
        payload: SessionStatePayload::Lifecycle {
            lifecycle,
            revision,
        },
    }
}

pub(crate) fn build_live_session_state_capabilities_envelope(
    session_id: &str,
    capabilities: SessionGraphCapabilities,
    revision: SessionGraphRevision,
    pending_mutation_id: Option<String>,
    preview_state: CapabilityPreviewState,
) -> SessionStateEnvelope {
    SessionStateEnvelope {
        session_id: session_id.to_string(),
        graph_revision: revision.graph_revision,
        last_event_seq: revision.last_event_seq,
        payload: SessionStatePayload::Capabilities {
            capabilities: Box::new(capabilities),
            revision,
            pending_mutation_id,
            preview_state,
        },
    }
}

fn build_budgeted_assistant_text_delta_state_envelopes(
    session_id: &str,
    revision: SessionGraphRevision,
    turn_id: String,
    row_id: String,
    start_char_offset: u32,
    delta_text: &str,
    produced_at_monotonic_ms: u64,
) -> Vec<SessionStateEnvelope> {
    if delta_text.is_empty() {
        return vec![build_assistant_text_delta_state_envelope(
            session_id,
            revision,
            AssistantTextDeltaPayload {
                turn_id,
                row_id,
                char_offset: start_char_offset,
                delta_text: String::new(),
                produced_at_monotonic_ms,
                revision: revision.transcript_revision,
            },
        )];
    }

    const INITIAL_CHUNK_BYTES: usize = 6_000;
    let mut envelopes = Vec::new();
    let mut offset = 0;
    let mut char_offset = start_char_offset;

    while offset < delta_text.len() {
        let mut chunk_end = next_char_boundary(delta_text, offset, INITIAL_CHUNK_BYTES);
        let mut accepted = None;

        while chunk_end > offset {
            let chunk = &delta_text[offset..chunk_end];
            let envelope = build_assistant_text_delta_state_envelope(
                session_id,
                revision,
                AssistantTextDeltaPayload {
                    turn_id: turn_id.clone(),
                    row_id: row_id.clone(),
                    char_offset,
                    delta_text: chunk.to_string(),
                    produced_at_monotonic_ms,
                    revision: revision.transcript_revision,
                },
            );

            match session_state_envelope_byte_budget_status(&envelope) {
                Ok(_) => {
                    accepted = Some((envelope, chunk.chars().count()));
                    break;
                }
                Err(status) => {
                    if chunk.chars().count() <= 1 {
                        tracing::warn!(
                            session_id,
                            byte_len = status.byte_len,
                            max_bytes = status.max_bytes,
                            "Skipping assistant text delta chunk that cannot fit byte budget"
                        );
                        return envelopes;
                    }
                    chunk_end = previous_midpoint_char_boundary(delta_text, offset, chunk_end);
                }
            }
        }

        let Some((envelope, chunk_chars)) = accepted else {
            break;
        };
        envelopes.push(envelope);
        offset = chunk_end;
        char_offset = char_offset.saturating_add(chunk_chars as u32);
    }

    envelopes
}

pub(crate) fn next_char_boundary(value: &str, start: usize, max_bytes: usize) -> usize {
    let mut end = value.len().min(start.saturating_add(max_bytes));
    while end > start && !value.is_char_boundary(end) {
        end -= 1;
    }
    if end == start {
        value[start..]
            .char_indices()
            .nth(1)
            .map(|(index, _)| start + index)
            .unwrap_or(value.len())
    } else {
        end
    }
}

pub(crate) fn previous_midpoint_char_boundary(value: &str, start: usize, end: usize) -> usize {
    let mut midpoint = start + (end - start) / 2;
    while midpoint > start && !value.is_char_boundary(midpoint) {
        midpoint -= 1;
    }
    midpoint
}

fn build_assistant_text_delta_state_envelope(
    session_id: &str,
    revision: SessionGraphRevision,
    delta: AssistantTextDeltaPayload,
) -> SessionStateEnvelope {
    SessionStateEnvelope {
        session_id: session_id.to_string(),
        graph_revision: revision.graph_revision,
        last_event_seq: revision.last_event_seq,
        payload: SessionStatePayload::AssistantTextDelta { delta },
    }
}

fn assistant_text_from_update_chunk(
    chunk: &crate::acp::session_update::ContentChunk,
) -> Option<&str> {
    match &chunk.content {
        crate::acp::types::ContentBlock::Text { text } => Some(text.as_str()),
        _ => None,
    }
}

fn assistant_row_entry_id(delta: &TranscriptDelta) -> Option<&str> {
    delta
        .operations
        .iter()
        .find_map(|operation| match operation {
            TranscriptDeltaOperation::AppendEntry { entry }
                if entry.role == TranscriptEntryRole::Assistant =>
            {
                Some(entry.entry_id.as_str())
            }
            TranscriptDeltaOperation::AppendSegment { entry_id, role, .. }
                if role == &TranscriptEntryRole::Assistant =>
            {
                Some(entry_id.as_str())
            }
            _ => None,
        })
}

fn transcript_entry_text_char_count(entry: &TranscriptEntry) -> usize {
    entry
        .segments
        .iter()
        .map(|segment| segment.primary_text().chars().count())
        .sum()
}

fn assistant_turn_id_from_snapshot(
    snapshot: &TranscriptSnapshot,
    row_index: usize,
    fallback_row_id: &str,
) -> String {
    snapshot
        .entries
        .iter()
        .take(row_index)
        .rev()
        .find(|entry| entry.role == TranscriptEntryRole::User)
        .map(|entry| entry.entry_id.clone())
        .unwrap_or_else(|| fallback_row_id.to_string())
}

#[cfg(test)]
mod tests {
    use super::{next_char_boundary, previous_midpoint_char_boundary};

    #[test]
    fn next_char_boundary_respects_utf8_codepoints() {
        let value = "a🙂b";
        assert_eq!(next_char_boundary(value, 0, 2), 1);
        assert_eq!(next_char_boundary(value, 1, 4), 5);
        assert_eq!(next_char_boundary(value, 1, 5), value.len());
    }

    #[test]
    fn previous_midpoint_char_boundary_steps_back_to_boundary() {
        let value = "abcdef";
        assert_eq!(previous_midpoint_char_boundary(value, 0, 4), 2);
    }

    #[test]
    fn assistant_text_delta_row_id_is_the_canonical_entry_id() {
        use super::build_assistant_text_delta_from_components;
        use crate::acp::session_state_engine::protocol::SessionStatePayload;
        use crate::acp::session_state_engine::revision::SessionGraphRevision;
        use crate::acp::session_update::{ContentChunk, SessionUpdate};
        use crate::acp::transcript_projection::{
            TranscriptDelta, TranscriptDeltaOperation, TranscriptEntry, TranscriptEntryRole,
            TranscriptSegment, TranscriptSnapshot,
        };
        use crate::acp::types::ContentBlock;

        // The canonical transcript entry_id contains ':' and '.' — sanitizing it
        // would mint a second identity the reveal consumer can never reconcile.
        let entry_id = "acepe::entry::assistant-boundary:1::assistant::.";
        let entry = TranscriptEntry {
            entry_id: entry_id.to_string(),
            role: TranscriptEntryRole::Assistant,
            segments: vec![TranscriptSegment::Text {
                segment_id: format!("{entry_id}:block:0"),
                text: "Hello".to_string(),
            }],
            attempt_id: None,
            timestamp_ms: None,
        };
        let snapshot = TranscriptSnapshot {
            revision: 1,
            entries: vec![entry.clone()],
        };
        let delta = TranscriptDelta {
            event_seq: 1,
            session_id: "session-1".to_string(),
            snapshot_revision: 1,
            operations: vec![TranscriptDeltaOperation::AppendEntry { entry }],
        };
        let update = SessionUpdate::AgentMessageChunk {
            chunk: ContentChunk {
                content: ContentBlock::Text {
                    text: "Hello".to_string(),
                },
                aggregation_hint: None,
            },
            part_id: None,
            message_id: None,
            session_id: Some("session-1".to_string()),
            produced_at_monotonic_ms: Some(1_000),
        };

        let envelopes = build_assistant_text_delta_from_components(
            "session-1",
            &update,
            &delta,
            &snapshot,
            SessionGraphRevision::new(5, 2, 8),
        );

        assert_eq!(envelopes.len(), 1);
        let SessionStatePayload::AssistantTextDelta { delta: payload } = &envelopes[0].payload else {
            panic!("expected an AssistantTextDelta payload");
        };
        assert_eq!(
            payload.row_id, entry_id,
            "token-stream rowId must be the canonical entry_id (matches activeStreamingTail.row_id and scene ids), not a sanitized variant"
        );
    }
}
