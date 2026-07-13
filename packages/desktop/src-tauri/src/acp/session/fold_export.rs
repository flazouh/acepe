//! Fold ordered provider events into canonical session graph projections.

use crate::acp::parsers::AgentType;
use crate::acp::projections::{SessionProjectionSnapshot, SessionSnapshot};
use crate::acp::session::engine::fold::{fold_full, FoldContext};
use crate::acp::session::ingress::canonical_events::full_session_to_provider_events;
use crate::acp::session::ingress::event::ProviderEvent;
use crate::acp::session_state_engine::graph::SessionStateGraph;
use crate::acp::transcript_projection::TranscriptSnapshot;
use crate::acp::types::CanonicalAgentId;
use crate::session_jsonl::types::FullSession;

/// Default session title from a session id (first 8 chars), for history load fallbacks.
#[must_use]
pub fn default_session_title(session_id: &str) -> String {
    let short_id = session_id.chars().take(8).collect::<String>();
    format!("Session {short_id}")
}

/// Fold output packaged for session-open and session-command compat callers.
pub(crate) struct MaterializedThreadSnapshot {
    pub transcript_snapshot: TranscriptSnapshot,
    pub projection: SessionProjectionSnapshot,
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
pub(crate) fn materialized_thread_snapshot_from_history_events(
    session_id: &str,
    agent_id: &CanonicalAgentId,
    project_path: &str,
    events: &[ProviderEvent],
    _title: String,
    transcript_revision: i64,
) -> MaterializedThreadSnapshot {
    let graph = fold_graph_from_history_events(session_id, agent_id, project_path, events);
    materialized_thread_snapshot_from_folded_graph(session_id, &graph, transcript_revision)
}

/// Materialize a parsed full session through ingress events and fold.
#[must_use]
pub(crate) fn materialized_thread_snapshot_from_full_session(
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

pub(crate) fn materialized_thread_snapshot_from_folded_graph(
    session_id: &str,
    graph: &SessionStateGraph,
    transcript_revision: i64,
) -> MaterializedThreadSnapshot {
    let mut transcript_snapshot = graph.transcript_snapshot.clone();
    transcript_snapshot.revision = transcript_snapshot.revision.max(transcript_revision);

    let session = SessionSnapshot {
        session_id: session_id.to_string(),
        agent_id: Some(graph.agent_id.clone()),
        last_event_seq: graph.revision.last_event_seq,
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
    }
}
