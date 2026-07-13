//! Apply live transcript-bearing updates through `fold_step`.

use crate::acp::session::ingress::event::{ProviderEvent, ProviderEventKind};
use crate::acp::transcript_projection::delta::TranscriptDeltaOperation;
use crate::acp::transcript_projection::snapshot::{
    TranscriptEntry, TranscriptEntryRole, TranscriptSnapshot,
};
use crate::acp::transcript_projection::tool_call_id_from_authority_entry_id;

/// Derives transcript delta operations for one provider event from the
/// before/after transcript snapshots straddling its fold. Event-aware so
/// tool identity is resolved via the event's own tool-call id rather than
/// diffed positionally, which is what preserves tool identity rules (a
/// positional diff can misidentify a tool row when unrelated entries shift).
#[must_use]
pub(crate) fn transcript_delta_operations_for_event(
    event: &ProviderEvent,
    before: &TranscriptSnapshot,
    after: &TranscriptSnapshot,
) -> Vec<TranscriptDeltaOperation> {
    match &event.kind {
        ProviderEventKind::ToolCall(tool_call) => {
            let entry = after.entries.iter().find(|entry| {
                entry.role == TranscriptEntryRole::Tool
                    && tool_call_id_from_authority_entry_id(&entry.entry_id).as_deref()
                        == Some(tool_call.id.as_str())
            });
            entry
                .map(|entry| {
                    vec![TranscriptDeltaOperation::AppendEntry {
                        entry: entry.clone(),
                    }]
                })
                .unwrap_or_default()
        }
        ProviderEventKind::ToolCallUpdate(_) => Vec::new(),
        _ => diff_transcript_snapshots(before, after),
    }
}

#[must_use]
pub(crate) fn diff_transcript_snapshots(
    before: &TranscriptSnapshot,
    after: &TranscriptSnapshot,
) -> Vec<TranscriptDeltaOperation> {
    if after.revision <= before.revision && after.entries.len() <= before.entries.len() {
        return Vec::new();
    }

    let mut operations = Vec::new();
    let shared_prefix = before
        .entries
        .iter()
        .zip(after.entries.iter())
        .take_while(|(left, right)| left.entry_id == right.entry_id && left.role == right.role)
        .count();

    for index in 0..shared_prefix {
        append_new_segments(
            &mut operations,
            &before.entries[index],
            &after.entries[index],
        );
    }

    for (index, entry) in after.entries.iter().enumerate().skip(shared_prefix) {
        if index < before.entries.len() {
            let prior = &before.entries[index];
            if prior.entry_id == entry.entry_id && prior.role == entry.role {
                append_new_segments(&mut operations, prior, entry);
                continue;
            }
        }
        operations.push(TranscriptDeltaOperation::AppendEntry {
            entry: entry.clone(),
        });
    }

    operations
}

fn append_new_segments(
    operations: &mut Vec<TranscriptDeltaOperation>,
    before: &TranscriptEntry,
    after: &TranscriptEntry,
) {
    if after.segments.len() <= before.segments.len() {
        return;
    }

    for segment in after.segments.iter().skip(before.segments.len()) {
        operations.push(TranscriptDeltaOperation::AppendSegment {
            entry_id: after.entry_id.clone(),
            role: after.role.clone(),
            segment: segment.clone(),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::transcript_projection::TranscriptSegment;

    #[test]
    fn diff_emits_append_segment_for_streaming_assistant_chunks() {
        let before = TranscriptSnapshot {
            revision: 1,
            entries: vec![TranscriptEntry {
                entry_id: "assistant-1".to_string(),
                role: TranscriptEntryRole::Assistant,
                segments: vec![TranscriptSegment::Text {
                    segment_id: "seg-1".to_string(),
                    text: "hello".to_string(),
                }],
                attempt_id: None,
                timestamp_ms: None,
            }],
        };
        let after = TranscriptSnapshot {
            revision: 2,
            entries: vec![TranscriptEntry {
                entry_id: "assistant-1".to_string(),
                role: TranscriptEntryRole::Assistant,
                segments: vec![
                    TranscriptSegment::Text {
                        segment_id: "seg-1".to_string(),
                        text: "hello".to_string(),
                    },
                    TranscriptSegment::Text {
                        segment_id: "seg-2".to_string(),
                        text: " world".to_string(),
                    },
                ],
                attempt_id: None,
                timestamp_ms: None,
            }],
        };

        let ops = diff_transcript_snapshots(&before, &after);
        assert_eq!(ops.len(), 1);
        assert!(matches!(
            ops[0],
            TranscriptDeltaOperation::AppendSegment { .. }
        ));
    }
}
