//! Apply live transcript-bearing updates through `fold_step`.

use std::collections::HashSet;

use crate::acp::projections::RouteDecision;
use crate::acp::session::engine::fold::FoldContext;
use crate::acp::session::ingress::event::{ProviderEvent, ProviderEventKind};
use crate::acp::session::ingress::plugin::live_source_for;
use crate::acp::session_state_engine::graph::SessionStateGraph;
use crate::acp::session_update::SessionUpdate;
use crate::acp::transcript_projection::delta::TranscriptDeltaOperation;
use crate::acp::transcript_projection::snapshot::{
    TranscriptEntry, TranscriptEntryRole, TranscriptSnapshot,
};
use crate::acp::transcript_projection::tool_call_id_from_authority_entry_id;
use crate::acp::types::CanonicalAgentId;

pub(crate) fn fold_backed_session_update(
    graph: &mut SessionStateGraph,
    applied_keys: &mut HashSet<String>,
    source: &CanonicalAgentId,
    event_seq: i64,
    update: &SessionUpdate,
    decision: RouteDecision,
    ingress_fold_event: Option<&ProviderEvent>,
) -> Option<Vec<TranscriptDeltaOperation>> {
    let event = if let Some(event) = ingress_fold_event {
        event.clone()
    } else {
        let live = live_source_for(source)?;
        live.normalize_update(event_seq, update, decision)?
    };
    fold_backed_provider_event(graph, applied_keys, &event)
}

pub(crate) fn fold_backed_provider_event(
    graph: &mut SessionStateGraph,
    applied_keys: &mut HashSet<String>,
    event: &ProviderEvent,
) -> Option<Vec<TranscriptDeltaOperation>> {
    let dedup_key = dedup_key_for_event(event);
    if applied_keys.contains(&dedup_key) {
        return None;
    }

    let before = graph.transcript_snapshot.clone();
    let (next, _delta) =
        crate::acp::session::engine::fold::fold_step_with_dedup(graph, event, &mut None);
    *graph = next;

    let after = graph.transcript_snapshot.clone();
    let operations = transcript_delta_operations_for_event(event, &before, &after);
    if operations.is_empty() {
        return None;
    }

    applied_keys.insert(dedup_key);
    Some(operations)
}

fn transcript_delta_operations_for_event(
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
pub(crate) fn graph_from_transcript_snapshot(
    session_id: &str,
    source: CanonicalAgentId,
    snapshot: TranscriptSnapshot,
) -> SessionStateGraph {
    let mut graph = crate::acp::session::engine::fold::fold_full(
        &[],
        &FoldContext::new(session_id, source, ""),
    );
    graph.transcript_snapshot = snapshot;
    graph.revision.transcript_revision = graph.transcript_snapshot.revision;
    graph
}

fn dedup_key_for_event(event: &ProviderEvent) -> String {
    format!("{}:{}", event.provider_row_id, event.kind_discriminant())
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
    use crate::acp::session::engine::fold::{fold_full, FoldContext};
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

    #[test]
    fn fold_backed_update_is_idempotent_on_duplicate_row_id() {
        let ctx = FoldContext::new("sess-live", CanonicalAgentId::ClaudeCode, "/tmp");
        let mut graph = fold_full(&[], &ctx);
        let mut applied = HashSet::new();
        let update = SessionUpdate::UserMessageChunk {
            session_id: Some("sess-live".to_string()),
            chunk: crate::acp::session_update::ContentChunk {
                content: crate::acp::types::ContentBlock::Text {
                    text: "hello".to_string(),
                },
                aggregation_hint: None,
            },
            attempt_id: None,
        };

        let first = fold_backed_session_update(
            &mut graph,
            &mut applied,
            &CanonicalAgentId::ClaudeCode,
            1,
            &update,
            RouteDecision::default(),
            None,
        );
        assert!(first.is_some());

        let second = fold_backed_session_update(
            &mut graph,
            &mut applied,
            &CanonicalAgentId::ClaudeCode,
            1,
            &update,
            RouteDecision::default(),
            None,
        );
        assert!(second.is_none());
        assert_eq!(graph.transcript_snapshot.entries.len(), 1);
    }
}
