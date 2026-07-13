//! History open delivery: fold output → `SessionOpenFound` (Phase 2 test seam).

use crate::acp::session::engine::fold::FoldContext;
use crate::acp::session::fold_export::fold_graph_from_history_events;
use crate::acp::session::ingress::event::ProviderEvent;
use crate::acp::session_open_snapshot::{
    derive_title_from_transcript_snapshot, resolve_canonical_session_title, SessionOpenFound,
    SessionOpenPath,
};
use crate::acp::session_state_engine::graph::{select_active_streaming_tail, SessionStateGraph};
use crate::acp::session_state_engine::selectors::{
    select_session_graph_activity, SessionGraphCapabilities, SessionGraphLifecycle,
};

/// Fold a full ordered history event stream into a session graph.
#[must_use]
pub fn graph_from_history_events(events: &[ProviderEvent], ctx: &FoldContext) -> SessionStateGraph {
    fold_graph_from_history_events(&ctx.session_id, &ctx.agent_id, &ctx.project_path, events)
}

/// Map a folded session graph into the session-open `found` payload.
#[must_use]
pub fn session_open_found_from_fold(
    graph: SessionStateGraph,
    open_token: &str,
) -> SessionOpenFound {
    let first_user_title = derive_title_from_transcript_snapshot(&graph.transcript_snapshot);
    let session_title = resolve_canonical_session_title(
        None,
        &graph.canonical_session_id,
        first_user_title.as_deref(),
    );

    let lifecycle = SessionGraphLifecycle::reconnecting();
    let capabilities = SessionGraphCapabilities::empty();
    let activity = select_session_graph_activity(
        &lifecycle,
        &graph.turn_state,
        &graph.operations,
        &graph.interactions,
        graph.active_turn_failure.as_ref(),
    );
    let active_streaming_tail =
        select_active_streaming_tail(&graph.turn_state, &activity, &graph.transcript_snapshot);

    SessionOpenFound {
        requested_session_id: graph.requested_session_id,
        canonical_session_id: graph.canonical_session_id,
        is_alias: graph.is_alias,
        last_event_seq: graph.revision.last_event_seq,
        graph_revision: graph.revision.graph_revision,
        open_token: open_token.to_string(),
        agent_id: graph.agent_id,
        project_path: graph.project_path,
        worktree_path: graph.worktree_path,
        source_path: graph.source_path,
        sequence_id: graph.sequence_id,
        transcript_snapshot: graph.transcript_snapshot,
        session_title,
        operations: graph.operations,
        interactions: graph.interactions,
        turn_state: graph.turn_state,
        message_count: graph.message_count,
        activity,
        active_streaming_tail,
        lifecycle,
        capabilities,
        open_path: SessionOpenPath::FoldHistory,
        initial_transcript_row_page: None,
        initial_viewport_envelope: None,
        open_result_timing: None,
        active_turn_failure: graph.active_turn_failure,
        last_terminal_turn_id: graph.last_terminal_turn_id,
    }
}
