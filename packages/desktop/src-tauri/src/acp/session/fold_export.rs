//! Fold graph → backward-compat export shapes (Phase 2 compat; Phase 4 deletion target).

use std::collections::HashMap;

use crate::acp::parsers::AgentType;
use crate::acp::projections::OperationSnapshot;
use crate::acp::projections::{SessionProjectionSnapshot, SessionSnapshot};
use crate::acp::session::delivery::export::stored_entry_export::{
    stored_entries_from_transcript, timestamp_ms_to_rfc3339,
};
use crate::acp::session::engine::fold::{fold_full, FoldContext};
use crate::acp::session::ingress::canonical_events::{
    canonical_transcript_events_to_provider_events, full_session_to_provider_events,
};
use crate::acp::session::ingress::event::ProviderEvent;
use crate::acp::session::ingress::stored_entry_events::stored_entries_to_provider_events;
use crate::acp::session_descriptor::SessionReplayContext;
use crate::acp::session_state_engine::graph::SessionStateGraph;
use crate::acp::session_thread_snapshot::{ProviderOwnedSessionSnapshot, SessionThreadSnapshot};
use crate::acp::transcript_projection::TranscriptSnapshot;
use crate::acp::types::CanonicalAgentId;
use crate::session_jsonl::types::{FullSession, StoredEntry};

/// Default session title from a session id (first 8 chars), for history load fallbacks.
#[must_use]
pub fn default_session_title(session_id: &str) -> String {
    let short_id = session_id.chars().take(8).collect::<String>();
    format!("Session {short_id}")
}

/// Fold output packaged for session-open and session-command compat callers.
pub struct MaterializedThreadSnapshot {
    pub transcript_snapshot: TranscriptSnapshot,
    pub projection: SessionProjectionSnapshot,
    pub graph_revision: i64,
}

/// Fold ordered history events into a session graph (single fold spine).
#[must_use]
pub fn fold_graph_from_history_events(
    session_id: &str,
    agent_id: &CanonicalAgentId,
    project_path: &str,
    events: &[ProviderEvent],
) -> SessionStateGraph {
    let ctx = FoldContext::new(session_id, agent_id.clone(), project_path);
    fold_full(events, &ctx)
}

/// Fold events once and return transcript + projection (no StoredEntry round-trip).
#[must_use]
pub fn materialized_thread_snapshot_from_history_events(
    session_id: &str,
    agent_id: &CanonicalAgentId,
    project_path: &str,
    events: &[ProviderEvent],
    _title: String,
    transcript_revision: i64,
) -> MaterializedThreadSnapshot {
    let graph = fold_graph_from_history_events(session_id, agent_id, project_path, events);
    materialized_thread_snapshot_from_folded_graph(session_id, &graph, transcript_revision, 0)
}

/// Materialize a parsed full session through ingress events and fold.
#[must_use]
pub fn materialized_thread_snapshot_from_full_session(
    session: &FullSession,
    agent_id: CanonicalAgentId,
    agent_type: AgentType,
    transcript_revision: i64,
) -> MaterializedThreadSnapshot {
    let events = full_session_to_provider_events(session, agent_id.clone(), agent_type);
    materialized_thread_snapshot_from_history_events(
        &session.session_id,
        &agent_id,
        &session.project_path,
        &events,
        session.title.clone(),
        transcript_revision,
    )
}

/// Build fold materialized output from compat stored entries (audit / HTTP fallback seam).
#[must_use]
pub fn materialized_from_stored_entries(
    session_id: &str,
    agent_id: Option<CanonicalAgentId>,
    entries: &[StoredEntry],
    transcript_revision: i64,
) -> MaterializedThreadSnapshot {
    let transcript_snapshot = TranscriptSnapshot::from_stored_entries(transcript_revision, entries);
    let projection = crate::acp::projections::ProjectionRegistry::project_stored_entries(
        session_id, agent_id, entries,
    );
    MaterializedThreadSnapshot {
        transcript_snapshot,
        projection,
        graph_revision: 0,
    }
}

/// Derive backward-compat `SessionThreadSnapshot` from fold output (export boundary only).
#[must_use]
pub fn session_thread_snapshot_from_materialized(
    materialized: &MaterializedThreadSnapshot,
    title: String,
) -> SessionThreadSnapshot {
    let operations_by_entry_id =
        index_operations_by_transcript_entry_id(&materialized.projection.operations);
    let operations_by_tool_call_id =
        index_operations_by_tool_call_id(&materialized.projection.operations);
    let entries = stored_entries_from_transcript(
        &materialized.transcript_snapshot.entries,
        &operations_by_entry_id,
        &operations_by_tool_call_id,
    );

    SessionThreadSnapshot {
        entries,
        title,
        created_at: materialized
            .transcript_snapshot
            .entries
            .first()
            .and_then(|entry| timestamp_ms_to_rfc3339(entry.timestamp_ms))
            .unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
        current_mode_id: None,
    }
}

/// Map fold materialization to `ProviderOwnedSessionSnapshot` (export / provider boundary only).
#[must_use]
pub fn provider_owned_snapshot_from_materialized(
    materialized: &MaterializedThreadSnapshot,
    title: String,
    canonical_transcript_events: Vec<crate::acp::transcript_projection::CanonicalTranscriptEvent>,
) -> ProviderOwnedSessionSnapshot {
    let thread_snapshot = session_thread_snapshot_from_materialized(materialized, title);
    if canonical_transcript_events.is_empty() {
        ProviderOwnedSessionSnapshot::from_thread_snapshot(thread_snapshot)
    } else {
        ProviderOwnedSessionSnapshot::with_canonical_transcript_events(
            thread_snapshot,
            canonical_transcript_events,
        )
    }
}

/// Map a folded session graph back to `ProviderOwnedSessionSnapshot` for repair/ledger compat.
#[must_use]
pub fn provider_owned_snapshot_from_folded_graph(
    graph: SessionStateGraph,
    title: String,
) -> ProviderOwnedSessionSnapshot {
    let materialized = materialized_thread_snapshot_from_folded_graph(
        &graph.canonical_session_id,
        &graph,
        graph.revision.transcript_revision,
        graph.revision.last_event_seq,
    );
    provider_owned_snapshot_from_materialized(&materialized, title, Vec::new())
}

fn index_operations_by_transcript_entry_id(
    operations: &[OperationSnapshot],
) -> HashMap<String, OperationSnapshot> {
    operations
        .iter()
        .filter_map(|operation| match &operation.source_link {
            crate::acp::projections::OperationSourceLink::TranscriptLinked { entry_id } => {
                Some((entry_id.clone(), operation.clone()))
            }
            _ => None,
        })
        .collect()
}

fn index_operations_by_tool_call_id(
    operations: &[OperationSnapshot],
) -> HashMap<String, OperationSnapshot> {
    operations
        .iter()
        .map(|operation| (operation.tool_call_id.clone(), operation.clone()))
        .collect()
}

/// Build transcript + projection from a thread snapshot via stored-entry ingress + fold.
#[must_use]
pub fn materialized_thread_snapshot_from_thread_snapshot_fold_first(
    session_id: &str,
    replay_context: &SessionReplayContext,
    snapshot: &SessionThreadSnapshot,
    last_event_seq: i64,
) -> MaterializedThreadSnapshot {
    let events =
        stored_entries_to_provider_events(&snapshot.entries, replay_context.agent_id.clone());
    let graph = fold_graph_from_history_events(
        &replay_context.local_session_id,
        &replay_context.agent_id,
        &replay_context.project_path,
        &events,
    );
    materialized_thread_snapshot_from_folded_graph(
        session_id,
        &graph,
        graph.transcript_snapshot.revision,
        last_event_seq,
    )
}

/// Build transcript + projection from a provider snapshot via fold.
#[must_use]
pub fn materialized_thread_snapshot_from_provider_fold_first(
    session_id: &str,
    replay_context: &SessionReplayContext,
    snapshot: &ProviderOwnedSessionSnapshot,
    last_event_seq: i64,
) -> MaterializedThreadSnapshot {
    let graph = fold_graph_from_provider_snapshot(replay_context, snapshot);
    materialized_thread_snapshot_from_folded_graph(
        session_id,
        &graph,
        graph.transcript_snapshot.revision,
        last_event_seq,
    )
}

/// Fold a provider-owned snapshot into a session graph (canonical events or stored entries).
#[must_use]
pub fn fold_graph_from_provider_snapshot(
    replay_context: &SessionReplayContext,
    snapshot: &ProviderOwnedSessionSnapshot,
) -> SessionStateGraph {
    let events = provider_events_from_snapshot(snapshot, replay_context);
    let ctx = FoldContext::new(
        replay_context.local_session_id.clone(),
        replay_context.agent_id.clone(),
        replay_context.project_path.clone(),
    );
    fold_full(&events, &ctx)
}

fn provider_events_from_snapshot(
    snapshot: &ProviderOwnedSessionSnapshot,
    replay_context: &SessionReplayContext,
) -> Vec<ProviderEvent> {
    if !snapshot.canonical_transcript_events.is_empty() {
        return canonical_transcript_events_to_provider_events(
            &snapshot.canonical_transcript_events,
            replay_context.agent_id.clone(),
            AgentType::from_canonical(&replay_context.agent_id),
        );
    }

    stored_entries_to_provider_events(
        &snapshot.thread_snapshot.entries,
        replay_context.agent_id.clone(),
    )
}

pub(crate) fn materialized_thread_snapshot_from_folded_graph(
    session_id: &str,
    graph: &SessionStateGraph,
    transcript_revision: i64,
    last_event_seq: i64,
) -> MaterializedThreadSnapshot {
    let mut transcript_snapshot = graph.transcript_snapshot.clone();
    transcript_snapshot.revision = transcript_snapshot.revision.max(transcript_revision);

    let session = SessionSnapshot {
        session_id: session_id.to_string(),
        agent_id: Some(graph.agent_id.clone()),
        last_event_seq,
        turn_state: graph.turn_state.clone(),
        message_count: graph.message_count,
        active_tool_call_ids: Vec::new(),
        completed_tool_call_ids: Vec::new(),
        active_turn_failure: graph.active_turn_failure.clone(),
        last_terminal_turn_id: graph.last_terminal_turn_id.clone(),
        assistant_boundary_entry_count: 0,
        transcript_entry_count: transcript_snapshot.entries.len(),
    };

    MaterializedThreadSnapshot {
        transcript_snapshot,
        projection: SessionProjectionSnapshot {
            session: Some(session),
            operations: graph.operations.clone(),
            interactions: graph.interactions.clone(),
            runtime: None,
        },
        graph_revision: graph.revision.graph_revision,
    }
}

#[cfg(test)]
mod tests {
    use super::{fold_graph_from_history_events, materialized_thread_snapshot_from_folded_graph};
    use crate::acp::session_state_engine::revision::SessionGraphRevision;
    use crate::acp::types::CanonicalAgentId;

    #[test]
    fn folded_provider_projection_preserves_the_durable_event_frontier() {
        let session_id = "provider-frontier-session";
        let mut graph = fold_graph_from_history_events(
            session_id,
            &CanonicalAgentId::ClaudeCode,
            "/test/project",
            &[],
        );
        graph.revision = SessionGraphRevision::new(7, 3, 99);

        let materialized =
            materialized_thread_snapshot_from_folded_graph(session_id, &graph, 3, 41);

        assert_eq!(
            materialized
                .projection
                .session
                .expect("materialized session projection")
                .last_event_seq,
            41
        );
        assert_eq!(materialized.graph_revision, 7);
    }
}
