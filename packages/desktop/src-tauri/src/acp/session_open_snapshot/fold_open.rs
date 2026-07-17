//! Fold-based production history open — `ProviderEvent` stream → `SessionOpenResult`.

use crate::acp::event_hub::AcpEventHubState;
use crate::acp::projections::{is_terminal_operation_state, InteractionState, SessionTurnState};
use crate::acp::session::engine::fold::{fold_full, FoldContext};
use crate::acp::session::ingress::event::ProviderEvent;
use crate::acp::session_descriptor::SessionReplayContext;
use crate::acp::session_state_engine::graph::select_active_streaming_tail;
use crate::acp::session_state_engine::runtime_registry::SessionGraphRuntimeRegistry;
use crate::acp::session_state_engine::selectors::{
    select_session_graph_activity, SessionGraphCapabilities, SessionGraphLifecycle,
};
use crate::db::repository::{
    SessionEventSeq, SessionEventSequenceRepository, SessionJournalEventRepository,
    SessionMetadataRepository,
};
use sea_orm::DbConn;
use std::sync::Arc;
use std::time::Instant;
use uuid::Uuid;

use super::operation_sanitize::{
    sanitize_interactions_for_historical_open, sanitize_operations_for_historical_open,
    warn_unresolved_tool_rows_in_open_graph,
};
use super::snapshot::{
    build_initial_viewport_envelope, derive_title_from_transcript_snapshot, elapsed_ms,
    load_local_journal_transcript, resolve_canonical_session_title,
};
use super::transcript_merge::merge_provider_tool_rows_into_local_transcript;
use super::types::{SessionOpenError, SessionOpenFound, SessionOpenPath, SessionOpenResult};

/// Assemble a session-open result by folding ordered provider history events.
pub async fn session_open_result_from_history_events(
    db: &DbConn,
    hub: &Arc<AcpEventHubState>,
    runtime_registry: Option<&SessionGraphRuntimeRegistry>,
    replay_context: &SessionReplayContext,
    requested_session_id: &str,
    events: &[ProviderEvent],
) -> SessionOpenResult {
    let total_started_at = Instant::now();
    let canonical_session_id = &replay_context.local_session_id;
    let is_alias = requested_session_id != canonical_session_id;
    let event_sequence_frontier_started_at = Instant::now();
    let last_event_seq = match SessionEventSequenceRepository::last_assigned_event_seq(
        db,
        canonical_session_id,
    )
    .await
    {
        Ok(seq) => seq.unwrap_or(SessionEventSeq::ZERO),
        Err(err) => {
            return SessionOpenResult::Error(SessionOpenError::internal(
                    requested_session_id,
                    format!(
                        "Failed to determine delivery event-sequence frontier for session {canonical_session_id}: {err}"
                ),
                ));
        }
    };
    let projection_event_seq = match SessionJournalEventRepository::max_row_affecting_event_seq(
        db,
        canonical_session_id,
    )
    .await
    {
        Ok(seq) => seq.unwrap_or(0),
        Err(err) => {
            return SessionOpenResult::Error(SessionOpenError::internal(
                requested_session_id,
                format!(
                    "Failed to determine projection cutoff for session {canonical_session_id}: {err}"
                ),
            ));
        }
    };
    let event_sequence_frontier_ms = elapsed_ms(event_sequence_frontier_started_at);

    let open_token = Uuid::new_v4();
    let epoch_ms = chrono::Utc::now().timestamp_millis().max(0) as u64;
    hub.arm_reservation(
        open_token,
        canonical_session_id.clone(),
        last_event_seq.get(),
        epoch_ms,
    );

    let metadata_started_at = Instant::now();
    let session_metadata =
        match SessionMetadataRepository::get_by_id(db, canonical_session_id).await {
            Ok(metadata) => metadata,
            Err(err) => {
                hub.supersede_reservation(open_token);
                return SessionOpenResult::Error(SessionOpenError::internal(
                    requested_session_id,
                    format!(
                        "Failed to load session metadata for session {canonical_session_id}: {err}"
                    ),
                ));
            }
        };
    let Some(session_metadata) = session_metadata else {
        hub.supersede_reservation(open_token);
        return SessionOpenResult::Error(SessionOpenError::internal(
            requested_session_id,
            format!("Session metadata missing for session {canonical_session_id}"),
        ));
    };
    let metadata_ms = elapsed_ms(metadata_started_at);

    let fold_started_at = Instant::now();
    let ctx = FoldContext::new(
        canonical_session_id.clone(),
        replay_context.agent_id.clone(),
        replay_context.project_path.clone(),
    );
    let graph = fold_full(events, &ctx);
    let fold_ms = elapsed_ms(fold_started_at);

    let local_journal_started_at = Instant::now();
    let (transcript_snapshot, transcript_from_local_journal, local_projection) =
        match load_local_journal_transcript(db, replay_context, canonical_session_id).await {
            Ok(Some(local_replay)) => (
                merge_provider_tool_rows_into_local_transcript(
                    local_replay.transcript_snapshot,
                    &graph.transcript_snapshot,
                    &graph.operations,
                ),
                true,
                Some(local_replay.projection),
            ),
            Ok(None) => (graph.transcript_snapshot.clone(), false, None),
            Err(message) => {
                hub.supersede_reservation(open_token);
                return SessionOpenResult::Error(SessionOpenError::internal(
                    requested_session_id,
                    message,
                ));
            }
        };
    let local_journal_ms = elapsed_ms(local_journal_started_at);

    let projection_started_at = Instant::now();
    let use_local_projection = local_projection.as_ref().is_some_and(|local| {
        local
            .session
            .as_ref()
            .is_some_and(|session| session.last_event_seq >= projection_event_seq)
    });
    let session_snap = if use_local_projection {
        local_projection
            .as_ref()
            .and_then(|local| local.session.as_ref())
    } else {
        None
    };

    let mut operations = graph.operations.clone();
    let interactions = graph.interactions.clone();
    let projected_last_event_seq = session_snap
        .map(|session| session.last_event_seq)
        .unwrap_or(last_event_seq.get());
    let projection_frontier = if use_local_projection {
        projection_event_seq
    } else {
        last_event_seq.get()
    };
    let projection_is_behind_journal = projected_last_event_seq < projection_frontier;
    let graph_revision = graph.revision.graph_revision;
    let raw_turn_state = graph.turn_state.clone();
    let had_historical_active_state = raw_turn_state == SessionTurnState::Running
        || operations
            .iter()
            .any(|operation| !is_terminal_operation_state(&operation.operation_state))
        || interactions
            .iter()
            .any(|interaction| interaction.state == InteractionState::Pending);
    let turn_state = if projection_is_behind_journal {
        SessionTurnState::Idle
    } else if raw_turn_state == SessionTurnState::Failed {
        raw_turn_state
    } else if had_historical_active_state {
        if events.is_empty() {
            SessionTurnState::Idle
        } else {
            SessionTurnState::Completed
        }
    } else {
        raw_turn_state
    };
    let message_count = if transcript_from_local_journal {
        transcript_snapshot.entries.len() as u64
    } else if projection_is_behind_journal {
        0
    } else {
        graph.message_count
    };
    let active_turn_failure = if projection_is_behind_journal {
        None
    } else {
        graph.active_turn_failure.clone()
    };
    let last_terminal_turn_id = if projection_is_behind_journal {
        None
    } else {
        graph.last_terminal_turn_id.clone()
    };
    let first_user_title = derive_title_from_transcript_snapshot(&transcript_snapshot);
    operations = sanitize_operations_for_historical_open(operations, projection_is_behind_journal);
    let interactions = sanitize_interactions_for_historical_open(interactions);
    warn_unresolved_tool_rows_in_open_graph(
        canonical_session_id,
        &replay_context.agent_id,
        &transcript_snapshot,
        &operations,
    );

    let lifecycle = SessionGraphLifecycle::reconnecting();
    let capabilities = SessionGraphCapabilities::empty();

    if let Some(runtime_registry) = runtime_registry {
        runtime_registry.restore_open_session_state(
            canonical_session_id.clone(),
            graph_revision,
            lifecycle.clone(),
            capabilities.clone(),
        );
    }
    let activity = select_session_graph_activity(
        &lifecycle,
        &turn_state,
        &operations,
        &interactions,
        active_turn_failure.as_ref(),
    );
    let active_streaming_tail =
        select_active_streaming_tail(&turn_state, &activity, &transcript_snapshot);
    let projection_ms = elapsed_ms(projection_started_at);
    let total_ms = elapsed_ms(total_started_at);
    if total_ms > 500 {
        tracing::warn!(
            session_id = %canonical_session_id,
            requested_session_id = %requested_session_id,
            agent_id = %replay_context.agent_id,
            event_sequence_frontier_ms,
            metadata_ms,
            fold_ms,
            local_journal_ms,
            projection_ms,
            total_ms,
            transcript_entry_count = transcript_snapshot.entries.len(),
            operation_count = operations.len(),
            "Slow fold-based session-open assembly"
        );
    }

    let mut found = SessionOpenFound {
        requested_session_id: requested_session_id.to_string(),
        canonical_session_id: canonical_session_id.clone(),
        is_alias,
        last_event_seq: last_event_seq.get(),
        graph_revision,
        open_token: open_token.to_string(),
        agent_id: replay_context.agent_id.clone(),
        project_path: replay_context.project_path.clone(),
        worktree_path: replay_context.worktree_path.clone(),
        source_path: replay_context.source_path.clone(),
        sequence_id: session_metadata.sequence_id,
        transcript_snapshot,
        session_title: resolve_canonical_session_title(
            Some(&session_metadata),
            canonical_session_id,
            first_user_title.as_deref(),
        ),
        operations,
        interactions,
        turn_state,
        message_count,
        activity,
        active_streaming_tail,
        lifecycle,
        capabilities,
        open_path: SessionOpenPath::FoldHistory,
        initial_transcript_row_page: None,
        initial_viewport_envelope: None,
        open_result_timing: None,
        active_turn_failure,
        last_terminal_turn_id,
    };
    found.initial_viewport_envelope = build_initial_viewport_envelope(runtime_registry, &found);

    SessionOpenResult::Found(Box::new(found))
}
