use crate::acp::event_hub::AcpEventHubState;
use crate::acp::projections::{is_terminal_operation_state, InteractionState, SessionTurnState};
use crate::acp::session_descriptor::SessionReplayContext;
use crate::acp::session_materialization::materialize_provider_owned_thread_snapshot;
use crate::acp::session_state_engine::graph::select_active_streaming_tail;
use crate::acp::session_state_engine::runtime_registry::SessionGraphRuntimeRegistry;
use crate::acp::session_state_engine::selectors::{
    select_session_graph_activity, SessionGraphCapabilities, SessionGraphLifecycle,
};
use crate::acp::session_thread_snapshot::{ProviderOwnedSessionSnapshot, SessionThreadSnapshot};
use crate::acp::transcript_projection::{
    TranscriptEntryRole, TranscriptSegment, TranscriptSnapshot,
};
use crate::db::repository::{SessionJournalEventRepository, SessionMetadataRepository};
use sea_orm::DbConn;
use std::sync::Arc;
use uuid::Uuid;

use super::operation_sanitize::{
    sanitize_interactions_for_historical_open, sanitize_operations_for_historical_open,
    warn_unresolved_tool_rows_in_open_graph,
};
use super::transcript_merge::merge_provider_tool_rows_into_local_transcript;
use super::types::{
    NewSessionOpenResultInput, SessionOpenError, SessionOpenFound, SessionOpenResult,
};

/// Build a short display title from a session ID (first 8 chars).
pub(crate) fn default_session_title(session_id: &str) -> String {
    format!("Session {}", &session_id[..8.min(session_id.len())])
}

pub(crate) fn resolve_canonical_session_title(
    metadata: Option<&crate::db::repository::SessionMetadataRow>,
    session_id: &str,
    first_user_title: Option<&str>,
) -> String {
    if let Some(row) = metadata {
        if row.title_overridden {
            let display = row.display.trim();
            if !display.is_empty() {
                return display.to_string();
            }
        }
    }

    if let Some(title) = first_user_title {
        let trimmed = title.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }

    if let Some(row) = metadata {
        let display = row.display.trim();
        if !display.is_empty() {
            return display.to_string();
        }
    }

    default_session_title(session_id)
}

pub(crate) fn derive_title_from_transcript_snapshot(
    transcript_snapshot: &TranscriptSnapshot,
) -> Option<String> {
    for entry in &transcript_snapshot.entries {
        if entry.role != TranscriptEntryRole::User {
            continue;
        }

        let mut text = String::new();
        for segment in &entry.segments {
            match segment {
                TranscriptSegment::Text {
                    text: segment_text, ..
                }
                | TranscriptSegment::Thought {
                    text: segment_text, ..
                } => {
                    if !text.is_empty() {
                        text.push('\n');
                    }
                    text.push_str(segment_text);
                }
                TranscriptSegment::LocalCommand {
                    command,
                    message,
                    stdout,
                    ..
                } => {
                    if !text.is_empty() {
                        text.push('\n');
                    }
                    if !stdout.is_empty() {
                        text.push_str(stdout);
                    } else if !command.is_empty() {
                        text.push_str(command);
                    } else {
                        text.push_str(message);
                    }
                }
            }
        }

        return crate::history::title_utils::derive_session_title(&text, 100);
    }

    None
}

pub async fn session_open_result_from_thread_snapshot(
    db: &DbConn,
    hub: &Arc<AcpEventHubState>,
    runtime_registry: Option<&SessionGraphRuntimeRegistry>,
    replay_context: &SessionReplayContext,
    requested_session_id: &str,
    snapshot: &SessionThreadSnapshot,
) -> SessionOpenResult {
    let provider_snapshot = ProviderOwnedSessionSnapshot::from_thread_snapshot(snapshot.clone());
    session_open_result_from_provider_owned_snapshot(
        db,
        hub,
        runtime_registry,
        replay_context,
        requested_session_id,
        &provider_snapshot,
    )
    .await
}

pub async fn session_open_result_from_provider_owned_snapshot(
    db: &DbConn,
    hub: &Arc<AcpEventHubState>,
    runtime_registry: Option<&SessionGraphRuntimeRegistry>,
    replay_context: &SessionReplayContext,
    requested_session_id: &str,
    snapshot: &ProviderOwnedSessionSnapshot,
) -> SessionOpenResult {
    let canonical_session_id = &replay_context.local_session_id;
    let is_alias = requested_session_id != canonical_session_id;
    let last_event_seq =
        match SessionJournalEventRepository::max_event_seq(db, canonical_session_id).await {
            Ok(seq) => seq.unwrap_or(0),
            Err(err) => {
                return SessionOpenResult::Error(SessionOpenError::internal(
                    requested_session_id,
                    format!(
                    "Failed to determine journal cutoff for session {canonical_session_id}: {err}"
                ),
                ));
            }
        };

    let open_token = Uuid::new_v4();
    let epoch_ms = chrono::Utc::now().timestamp_millis().max(0) as u64;
    hub.arm_reservation(
        open_token,
        canonical_session_id.clone(),
        last_event_seq,
        epoch_ms,
    );

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

    let materialized = materialize_provider_owned_thread_snapshot(
        canonical_session_id,
        Some(replay_context.agent_id.clone()),
        last_event_seq,
        snapshot,
    );
    let projection = materialized.projection;
    let (transcript_snapshot, transcript_from_local_journal) =
        match load_local_journal_transcript(db, replay_context, canonical_session_id).await {
            Ok(Some(transcript_snapshot)) => (
                merge_provider_tool_rows_into_local_transcript(
                    transcript_snapshot,
                    &materialized.transcript_snapshot,
                    &projection.operations,
                ),
                true,
            ),
            Ok(None) => (materialized.transcript_snapshot, false),
            Err(message) => {
                hub.supersede_reservation(open_token);
                return SessionOpenResult::Error(SessionOpenError::internal(
                    requested_session_id,
                    message,
                ));
            }
        };
    let session_snap = projection.session.as_ref();
    let operations = projection.operations;
    let interactions = projection.interactions;
    let projected_graph_revision = session_snap
        .map(|session| session.last_event_seq)
        .unwrap_or(last_event_seq);
    // Provider history can lag behind the canonical journal frontier. In that
    // case, preserve transcript content but do not resurrect stale active work.
    let projection_is_behind_journal = projected_graph_revision < last_event_seq;
    let graph_revision = projected_graph_revision.max(last_event_seq);
    let raw_turn_state = session_snap
        .map(|session| session.turn_state.clone())
        .unwrap_or(SessionTurnState::Idle);
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
        if snapshot.thread_snapshot.entries.is_empty() {
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
        session_snap
            .map(|session| session.message_count)
            .unwrap_or(0)
    };
    let active_turn_failure = if projection_is_behind_journal {
        None
    } else {
        session_snap.and_then(|session| session.active_turn_failure.clone())
    };
    let last_terminal_turn_id = if projection_is_behind_journal {
        None
    } else {
        session_snap.and_then(|session| session.last_terminal_turn_id.clone())
    };
    let first_user_title = derive_title_from_transcript_snapshot(&transcript_snapshot);
    let operations =
        sanitize_operations_for_historical_open(operations, projection_is_behind_journal);
    let interactions = sanitize_interactions_for_historical_open(interactions);
    warn_unresolved_tool_rows_in_open_graph(
        canonical_session_id,
        &replay_context.agent_id,
        &transcript_snapshot,
        &operations,
    );

    let lifecycle = SessionGraphLifecycle::detached(
        crate::acp::lifecycle::DetachedReason::RestoredRequiresAttach,
    );
    let capabilities = SessionGraphCapabilities::empty();

    // Viewport authority is keyed only by the canonical session id; the frontend
    // re-keys to the canonical id at open time, so no alias duplication is needed.
    if let Some(runtime_registry) = runtime_registry {
        runtime_registry.restore_session_state(
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

    SessionOpenResult::Found(Box::new(SessionOpenFound {
        requested_session_id: requested_session_id.to_string(),
        canonical_session_id: canonical_session_id.clone(),
        is_alias,
        last_event_seq,
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
        active_turn_failure,
        last_terminal_turn_id,
    }))
}

pub async fn session_open_result_from_completed_local_journal(
    db: &DbConn,
    hub: &Arc<AcpEventHubState>,
    replay_context: &SessionReplayContext,
    requested_session_id: &str,
    lifecycle: SessionGraphLifecycle,
    capabilities: SessionGraphCapabilities,
) -> Result<Option<SessionOpenResult>, String> {
    let canonical_session_id = &replay_context.local_session_id;
    let last_event_seq = SessionJournalEventRepository::max_event_seq(db, canonical_session_id)
        .await
        .map_err(|error| {
            format!(
                "Failed to determine journal cutoff for session {canonical_session_id}: {error}"
            )
        })?
        .unwrap_or(0);

    let open_token = Uuid::new_v4();
    let epoch_ms = chrono::Utc::now().timestamp_millis().max(0) as u64;
    hub.arm_reservation(
        open_token,
        canonical_session_id.clone(),
        last_event_seq,
        epoch_ms,
    );

    let transcript_snapshot =
        match load_completed_local_journal_transcript(db, replay_context, canonical_session_id)
            .await?
        {
            Some(transcript_snapshot) => transcript_snapshot,
            None => {
                hub.supersede_reservation(open_token);
                return Ok(None);
            }
        };

    let session_metadata = SessionMetadataRepository::get_by_id(db, canonical_session_id)
        .await
        .map_err(|error| {
            format!("Failed to load metadata for session {canonical_session_id}: {error}")
        })?;
    let Some(session_metadata) = session_metadata else {
        hub.supersede_reservation(open_token);
        return Err(format!(
            "Session metadata missing for session {canonical_session_id}"
        ));
    };

    let operations = vec![];
    let interactions = vec![];
    let turn_state = SessionTurnState::Idle;
    let active_turn_failure = None;
    let activity = select_session_graph_activity(
        &lifecycle,
        &turn_state,
        &operations,
        &interactions,
        active_turn_failure.as_ref(),
    );
    let active_streaming_tail =
        select_active_streaming_tail(&turn_state, &activity, &transcript_snapshot);
    let first_user_title = derive_title_from_transcript_snapshot(&transcript_snapshot);
    let message_count = transcript_snapshot.entries.len() as u64;

    Ok(Some(SessionOpenResult::Found(Box::new(SessionOpenFound {
        requested_session_id: requested_session_id.to_string(),
        canonical_session_id: canonical_session_id.clone(),
        is_alias: requested_session_id != canonical_session_id,
        last_event_seq,
        graph_revision: last_event_seq,
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
        active_turn_failure,
        last_terminal_turn_id: None,
    }))))
}

async fn load_completed_local_journal_transcript(
    db: &DbConn,
    replay_context: &SessionReplayContext,
    canonical_session_id: &str,
) -> Result<Option<TranscriptSnapshot>, String> {
    let serialized_events =
        SessionJournalEventRepository::list_serialized(db, canonical_session_id)
            .await
            .map_err(|error| {
                format!(
            "Failed to load local transcript journal for session {canonical_session_id}: {error}"
        )
            })?;
    let journal_events =
        crate::acp::session_journal::decode_serialized_events(replay_context, serialized_events)
            .map_err(|error| {
                format!(
            "Failed to decode local transcript journal for session {canonical_session_id}: {error}"
        )
            })?;

    Ok(
        crate::acp::session_journal::rebuild_completed_local_transcript_snapshot(
            replay_context,
            &journal_events,
        ),
    )
}

async fn load_local_journal_transcript(
    db: &DbConn,
    replay_context: &SessionReplayContext,
    canonical_session_id: &str,
) -> Result<Option<TranscriptSnapshot>, String> {
    let serialized_events =
        SessionJournalEventRepository::list_serialized(db, canonical_session_id)
            .await
            .map_err(|error| {
                format!(
            "Failed to load local transcript journal for session {canonical_session_id}: {error}"
        )
            })?;
    let journal_events =
        crate::acp::session_journal::decode_serialized_events(replay_context, serialized_events)
            .map_err(|error| {
                format!(
            "Failed to decode local transcript journal for session {canonical_session_id}: {error}"
        )
            })?;

    Ok(
        crate::acp::session_journal::rebuild_local_transcript_snapshot(
            replay_context,
            &journal_events,
        ),
    )
}

pub async fn session_open_result_for_new_session(
    db: &DbConn,
    hub: &Arc<AcpEventHubState>,
    input: NewSessionOpenResultInput,
) -> SessionOpenResult {
    let session_id = input.session_id;
    let last_event_seq = match SessionJournalEventRepository::max_event_seq(db, &session_id).await {
        Ok(seq) => seq.unwrap_or(0),
        Err(err) => {
            return SessionOpenResult::Error(SessionOpenError::internal(
                &session_id,
                format!("Failed to determine journal cutoff for new session {session_id}: {err}"),
            ));
        }
    };

    let open_token = Uuid::new_v4();
    let epoch_ms = chrono::Utc::now().timestamp_millis().max(0) as u64;
    hub.arm_reservation(open_token, session_id.clone(), last_event_seq, epoch_ms);

    let replay_context = SessionReplayContext {
        local_session_id: session_id.clone(),
        history_session_id: session_id.clone(),
        agent_id: input.agent_id.clone(),
        parser_agent_type: crate::acp::parsers::AgentType::from_canonical(&input.agent_id),
        project_path: input.project_path.clone(),
        worktree_path: input.worktree_path.clone(),
        effective_cwd: input
            .worktree_path
            .clone()
            .unwrap_or_else(|| input.project_path.clone()),
        source_path: input.source_path.clone(),
        compatibility: crate::acp::session_descriptor::SessionDescriptorCompatibility::Canonical,
    };
    let transcript_snapshot =
        match load_local_journal_transcript(db, &replay_context, &session_id).await {
            Ok(Some(transcript_snapshot)) => transcript_snapshot,
            Ok(None) => TranscriptSnapshot::from_stored_entries(last_event_seq, &[]),
            Err(message) => {
                hub.supersede_reservation(open_token);
                return SessionOpenResult::Error(SessionOpenError::internal(&session_id, message));
            }
        };
    let first_user_title = derive_title_from_transcript_snapshot(&transcript_snapshot);
    let message_count = transcript_snapshot.entries.len() as u64;
    let operations = vec![];
    let interactions = vec![];
    let turn_state = SessionTurnState::Idle;
    let active_turn_failure = None;
    let activity = select_session_graph_activity(
        &input.lifecycle,
        &turn_state,
        &operations,
        &interactions,
        active_turn_failure.as_ref(),
    );
    let session_metadata = match SessionMetadataRepository::get_by_id(db, &session_id).await {
        Ok(metadata) => metadata,
        Err(err) => {
            return SessionOpenResult::Error(SessionOpenError::internal(
                &session_id,
                format!("Failed to load metadata for new session {session_id}: {err}"),
            ));
        }
    };

    SessionOpenResult::Found(Box::new(SessionOpenFound {
        requested_session_id: session_id.clone(),
        canonical_session_id: session_id.clone(),
        is_alias: false,
        last_event_seq,
        graph_revision: last_event_seq,
        open_token: open_token.to_string(),
        agent_id: input.agent_id,
        project_path: input.project_path,
        worktree_path: input.worktree_path,
        source_path: input.source_path,
        sequence_id: session_metadata
            .as_ref()
            .and_then(|metadata| metadata.sequence_id),
        transcript_snapshot,
        session_title: resolve_canonical_session_title(
            session_metadata.as_ref(),
            &session_id,
            first_user_title.as_deref(),
        ),
        operations,
        interactions,
        turn_state,
        message_count,
        activity,
        active_streaming_tail: None,
        lifecycle: input.lifecycle,
        capabilities: input.capabilities,
        active_turn_failure,
        last_terminal_turn_id: None,
    }))
}
