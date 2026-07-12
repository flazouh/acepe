use crate::acp::projections::SessionSnapshot;
use crate::acp::session_descriptor::SessionReplayContext;
use crate::acp::session_journal::{
    decode_serialized_events, rebuild_local_transcript_snapshot, rebuild_session_projection,
    repair_legacy_parent_tool_use_ids_from_streaming_log, SessionJournalEvent,
};
use crate::acp::session_materialization::materialize_provider_owned_thread_snapshot;
use crate::acp::session_open_snapshot::{
    derive_title_from_transcript_snapshot, resolve_canonical_session_title,
    sanitize_interactions_for_historical_open, sanitize_operations_for_historical_open,
};
use crate::acp::session_state_engine::graph::{
    select_active_streaming_tail, ActiveStreamingTail, SessionStateGraph,
};
use crate::acp::session_state_engine::selectors::{
    select_session_graph_activity, SessionGraphActivity, SessionGraphCapabilities,
    SessionGraphLifecycle,
};
use crate::acp::session_state_engine::SessionGraphRevision;
use crate::acp::session_thread_snapshot::ProviderOwnedSessionSnapshot;
use crate::acp::transcript_projection::TranscriptSnapshot;
use crate::acp::transcript_viewport::ledger::{
    serialize_viewport_rows_for_ledger, SerializedTranscriptRowLedgerRow,
    SessionTranscriptRowLedgerOpenHeader, TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
};
use crate::acp::transcript_viewport::projection::project_transcript_viewport_rows;
use crate::db::repository::{
    SessionJournalEventRepository, SessionMetadataRepository, SessionTranscriptRowLedgerRepository,
};
use anyhow::{anyhow, Result};
use sea_orm::DbConn;

#[derive(Debug, Clone)]
pub(crate) struct RebuiltTranscriptRowLedger {
    pub revision: SessionGraphRevision,
    pub projection_version: &'static str,
    pub rows: Vec<SerializedTranscriptRowLedgerRow>,
    session: SessionSnapshot,
    first_user_title: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct RebuiltProviderTranscriptRowLedger {
    pub revision: SessionGraphRevision,
    pub projection_version: &'static str,
    pub rows: Vec<SerializedTranscriptRowLedgerRow>,
    session: SessionSnapshot,
    first_user_title: Option<String>,
    activity: SessionGraphActivity,
    active_streaming_tail: Option<ActiveStreamingTail>,
}

pub(crate) async fn rebuild_and_replace_current_transcript_row_ledger_from_journal(
    db: &DbConn,
    replay_context: &SessionReplayContext,
    lifecycle: &SessionGraphLifecycle,
    capabilities: &SessionGraphCapabilities,
) -> Result<Option<SessionGraphRevision>> {
    let serialized_events =
        SessionJournalEventRepository::list_serialized(db, &replay_context.local_session_id)
            .await?;
    let events = decode_serialized_events(replay_context, serialized_events)?;
    let Some(rebuilt) = rebuild_transcript_row_ledger_from_journal(replay_context, &events)? else {
        return Ok(None);
    };
    let session_metadata =
        SessionMetadataRepository::get_by_id(db, &replay_context.local_session_id)
            .await?
            .ok_or_else(|| {
                anyhow!(
                    "session metadata missing for {}",
                    replay_context.local_session_id
                )
            })?;
    let open_header_json = serde_json::to_string(&open_header_for_rebuilt_ledger(
        replay_context,
        &session_metadata,
        lifecycle,
        capabilities,
        &rebuilt,
    )?)?;
    let revision = rebuilt.revision;

    SessionTranscriptRowLedgerRepository::replace_current(
        db,
        &replay_context.local_session_id,
        rebuilt.projection_version,
        revision.transcript_revision,
        revision.graph_revision,
        revision.last_event_seq,
        Some(open_header_json),
        rebuilt.rows,
    )
    .await?;

    Ok(Some(revision))
}

pub(crate) fn rebuild_transcript_row_ledger_from_journal(
    replay_context: &SessionReplayContext,
    events: &[SessionJournalEvent],
) -> Result<Option<RebuiltTranscriptRowLedger>> {
    let Some(last_event_seq) = max_session_event_seq(replay_context, events) else {
        return Ok(None);
    };

    let repaired_events =
        repair_legacy_parent_tool_use_ids_from_streaming_log(replay_context, events);
    let events = repaired_events.as_slice();
    let projection = rebuild_session_projection(replay_context, events);
    let session = projection.session.clone().unwrap_or_else(|| {
        SessionSnapshot::new(
            replay_context.local_session_id.clone(),
            Some(replay_context.agent_id.clone()),
        )
    });
    let transcript_snapshot = rebuild_local_transcript_snapshot(replay_context, events)
        .unwrap_or_else(|| empty_transcript_snapshot(last_event_seq));
    let first_user_title = derive_title_from_transcript_snapshot(&transcript_snapshot);
    let graph_revision = projection
        .session
        .as_ref()
        .map(|session| session.last_event_seq)
        .unwrap_or(last_event_seq)
        .max(last_event_seq);
    let revision =
        SessionGraphRevision::new(graph_revision, transcript_snapshot.revision, last_event_seq);
    let viewport_rows = project_transcript_viewport_rows(
        &transcript_snapshot,
        &projection.operations,
        &projection.interactions,
        None,
        false,
        None,
    );
    let rows = serialize_viewport_rows_for_ledger(
        &replay_context.local_session_id,
        revision.transcript_revision,
        revision.graph_revision,
        TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
        &viewport_rows,
    )?;

    Ok(Some(RebuiltTranscriptRowLedger {
        revision,
        projection_version: TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
        rows,
        session,
        first_user_title,
    }))
}

pub(crate) async fn rebuild_and_replace_current_transcript_row_ledger_from_provider_snapshot(
    db: &DbConn,
    replay_context: &SessionReplayContext,
    lifecycle: &SessionGraphLifecycle,
    capabilities: &SessionGraphCapabilities,
    snapshot: &ProviderOwnedSessionSnapshot,
) -> Result<Option<SessionGraphRevision>> {
    let last_event_seq =
        SessionJournalEventRepository::max_event_seq(db, &replay_context.local_session_id)
            .await?
            .unwrap_or(0);
    let projection_event_seq = SessionJournalEventRepository::max_row_affecting_event_seq(
        db,
        &replay_context.local_session_id,
    )
    .await?
    .unwrap_or(0);
    let mut rebuilt = rebuild_transcript_row_ledger_from_provider_snapshot(
        replay_context,
        lifecycle,
        snapshot,
        last_event_seq,
    )?;
    let serialized_events =
        SessionJournalEventRepository::list_serialized(db, &replay_context.local_session_id)
            .await?;
    let journal_events =
        crate::acp::session_journal::decode_serialized_events(replay_context, serialized_events)?;
    let repaired_events =
        crate::acp::session_journal::repair_legacy_parent_tool_use_ids_from_streaming_log(
            replay_context,
            &journal_events,
        );
    let local_projection =
        crate::acp::session_journal::rebuild_session_projection(replay_context, &repaired_events);
    if let Some(local_session) = local_projection.session.filter(|session| {
        session.last_event_seq >= projection_event_seq && session.active_turn_failure.is_some()
    }) {
        rebuilt.session = local_session;
        rebuilt.revision = SessionGraphRevision::new(
            rebuilt.session.last_event_seq,
            rebuilt.revision.transcript_revision,
            last_event_seq,
        );
        let operations =
            sanitize_operations_for_historical_open(local_projection.operations, false);
        let interactions = sanitize_interactions_for_historical_open(local_projection.interactions);
        rebuilt.activity = select_session_graph_activity(
            lifecycle,
            &rebuilt.session.turn_state,
            &operations,
            &interactions,
            rebuilt.session.active_turn_failure.as_ref(),
        );
        rebuilt.active_streaming_tail = None;
    }
    let session_metadata =
        SessionMetadataRepository::get_by_id(db, &replay_context.local_session_id)
            .await?
            .ok_or_else(|| {
                anyhow!(
                    "session metadata missing for {}",
                    replay_context.local_session_id
                )
            })?;
    let open_header_json = serde_json::to_string(&open_header_for_rebuilt_provider_ledger(
        replay_context,
        &session_metadata,
        lifecycle,
        capabilities,
        &rebuilt,
    )?)?;
    let revision = rebuilt.revision;

    SessionTranscriptRowLedgerRepository::replace_current(
        db,
        &replay_context.local_session_id,
        rebuilt.projection_version,
        revision.transcript_revision,
        revision.graph_revision,
        revision.last_event_seq,
        Some(open_header_json),
        rebuilt.rows,
    )
    .await?;

    Ok(Some(revision))
}

pub(crate) async fn rebuild_and_replace_current_transcript_row_ledger_from_session_graph(
    db: &DbConn,
    replay_context: &SessionReplayContext,
    lifecycle: &SessionGraphLifecycle,
    capabilities: &SessionGraphCapabilities,
    graph: &SessionStateGraph,
) -> Result<Option<SessionGraphRevision>> {
    let last_event_seq =
        SessionJournalEventRepository::max_event_seq(db, &replay_context.local_session_id)
            .await?
            .unwrap_or(0);
    let projection_event_seq = SessionJournalEventRepository::max_row_affecting_event_seq(
        db,
        &replay_context.local_session_id,
    )
    .await?
    .unwrap_or(0);
    let mut rebuilt = rebuild_transcript_row_ledger_from_session_graph(
        replay_context,
        lifecycle,
        graph,
        last_event_seq,
    )?;
    let serialized_events =
        SessionJournalEventRepository::list_serialized(db, &replay_context.local_session_id)
            .await?;
    let journal_events =
        crate::acp::session_journal::decode_serialized_events(replay_context, serialized_events)?;
    let repaired_events =
        crate::acp::session_journal::repair_legacy_parent_tool_use_ids_from_streaming_log(
            replay_context,
            &journal_events,
        );
    let local_projection =
        crate::acp::session_journal::rebuild_session_projection(replay_context, &repaired_events);
    if let Some(local_session) = local_projection.session.filter(|session| {
        session.last_event_seq >= projection_event_seq && session.active_turn_failure.is_some()
    }) {
        rebuilt.session = local_session;
        rebuilt.revision = SessionGraphRevision::new(
            rebuilt.session.last_event_seq,
            rebuilt.revision.transcript_revision,
            last_event_seq,
        );
        let operations =
            sanitize_operations_for_historical_open(local_projection.operations, false);
        let interactions = sanitize_interactions_for_historical_open(local_projection.interactions);
        rebuilt.activity = select_session_graph_activity(
            lifecycle,
            &rebuilt.session.turn_state,
            &operations,
            &interactions,
            rebuilt.session.active_turn_failure.as_ref(),
        );
        rebuilt.active_streaming_tail = None;
    }
    let session_metadata =
        SessionMetadataRepository::get_by_id(db, &replay_context.local_session_id)
            .await?
            .ok_or_else(|| {
                anyhow!(
                    "session metadata missing for {}",
                    replay_context.local_session_id
                )
            })?;
    let open_header_json = serde_json::to_string(&open_header_for_rebuilt_provider_ledger(
        replay_context,
        &session_metadata,
        lifecycle,
        capabilities,
        &rebuilt,
    )?)?;
    let revision = rebuilt.revision;

    SessionTranscriptRowLedgerRepository::replace_current(
        db,
        &replay_context.local_session_id,
        rebuilt.projection_version,
        revision.transcript_revision,
        revision.graph_revision,
        revision.last_event_seq,
        Some(open_header_json),
        rebuilt.rows,
    )
    .await?;

    Ok(Some(revision))
}

pub(crate) fn rebuild_transcript_row_ledger_from_session_graph(
    replay_context: &SessionReplayContext,
    lifecycle: &SessionGraphLifecycle,
    graph: &SessionStateGraph,
    last_event_seq: i64,
) -> Result<RebuiltProviderTranscriptRowLedger> {
    let transcript_snapshot = graph.transcript_snapshot.clone();
    let operations = sanitize_operations_for_historical_open(graph.operations.clone(), false);
    let interactions = sanitize_interactions_for_historical_open(graph.interactions.clone());
    let session = SessionSnapshot {
        session_id: replay_context.local_session_id.clone(),
        agent_id: Some(replay_context.agent_id.clone()),
        last_event_seq: graph.revision.graph_revision.max(last_event_seq),
        turn_state: graph.turn_state.clone(),
        message_count: graph.message_count,
        active_tool_call_ids: Vec::new(),
        completed_tool_call_ids: Vec::new(),
        active_turn_failure: graph.active_turn_failure.clone(),
        last_terminal_turn_id: graph.last_terminal_turn_id.clone(),
        assistant_boundary_entry_count: 0,
        transcript_entry_count: transcript_snapshot.entries.len(),
    };
    let active_turn_failure = session.active_turn_failure.clone();
    let activity = select_session_graph_activity(
        lifecycle,
        &session.turn_state,
        &operations,
        &interactions,
        active_turn_failure.as_ref(),
    );
    let active_streaming_tail =
        select_active_streaming_tail(&session.turn_state, &activity, &transcript_snapshot);
    let first_user_title = derive_title_from_transcript_snapshot(&transcript_snapshot);
    let graph_revision = session.last_event_seq.max(last_event_seq);
    let revision = SessionGraphRevision::new(
        graph_revision,
        transcript_snapshot.revision,
        last_event_seq,
    );
    let viewport_rows = project_transcript_viewport_rows(
        &transcript_snapshot,
        &operations,
        &interactions,
        None,
        false,
        None,
    );
    let rows = serialize_viewport_rows_for_ledger(
        &replay_context.local_session_id,
        revision.transcript_revision,
        revision.graph_revision,
        TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
        &viewport_rows,
    )?;

    Ok(RebuiltProviderTranscriptRowLedger {
        revision,
        projection_version: TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
        rows,
        session,
        first_user_title,
        activity,
        active_streaming_tail,
    })
}

pub(crate) fn rebuild_transcript_row_ledger_from_provider_snapshot(
    replay_context: &SessionReplayContext,
    lifecycle: &SessionGraphLifecycle,
    snapshot: &ProviderOwnedSessionSnapshot,
    last_event_seq: i64,
) -> Result<RebuiltProviderTranscriptRowLedger> {
    let materialized = materialize_provider_owned_thread_snapshot(
        &replay_context.local_session_id,
        Some(replay_context.agent_id.clone()),
        last_event_seq,
        snapshot,
    );
    let transcript_snapshot = materialized.transcript_snapshot;
    let projection = materialized.projection;
    let session = projection.session.clone().unwrap_or_else(|| {
        SessionSnapshot::new(
            replay_context.local_session_id.clone(),
            Some(replay_context.agent_id.clone()),
        )
    });
    let operations = sanitize_operations_for_historical_open(projection.operations, false);
    let interactions = sanitize_interactions_for_historical_open(projection.interactions);
    let active_turn_failure = session.active_turn_failure.clone();
    let activity = select_session_graph_activity(
        lifecycle,
        &session.turn_state,
        &operations,
        &interactions,
        active_turn_failure.as_ref(),
    );
    let active_streaming_tail =
        select_active_streaming_tail(&session.turn_state, &activity, &transcript_snapshot);
    let first_user_title = derive_title_from_transcript_snapshot(&transcript_snapshot);
    let graph_revision = session.last_event_seq.max(last_event_seq);
    let revision =
        SessionGraphRevision::new(graph_revision, transcript_snapshot.revision, last_event_seq);
    let viewport_rows = project_transcript_viewport_rows(
        &transcript_snapshot,
        &operations,
        &interactions,
        None,
        false,
        None,
    );
    let rows = serialize_viewport_rows_for_ledger(
        &replay_context.local_session_id,
        revision.transcript_revision,
        revision.graph_revision,
        TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
        &viewport_rows,
    )?;

    Ok(RebuiltProviderTranscriptRowLedger {
        revision,
        projection_version: TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
        rows,
        session,
        first_user_title,
        activity,
        active_streaming_tail,
    })
}

fn open_header_for_rebuilt_ledger(
    replay_context: &SessionReplayContext,
    session_metadata: &crate::db::repository::SessionMetadataRow,
    lifecycle: &SessionGraphLifecycle,
    capabilities: &SessionGraphCapabilities,
    rebuilt: &RebuiltTranscriptRowLedger,
) -> Result<SessionTranscriptRowLedgerOpenHeader> {
    let agent_id = session_metadata
        .agent_id_enum()
        .unwrap_or_else(|| replay_context.agent_id.clone());
    let project_path = if session_metadata.project_path.trim().is_empty() {
        replay_context.project_path.clone()
    } else {
        session_metadata.project_path.clone()
    };
    let worktree_path = session_metadata
        .worktree_path
        .clone()
        .or_else(|| replay_context.worktree_path.clone());
    let active_turn_failure = rebuilt.session.active_turn_failure.clone();
    let activity = select_session_graph_activity(
        lifecycle,
        &rebuilt.session.turn_state,
        &[],
        &[],
        active_turn_failure.as_ref(),
    );

    Ok(SessionTranscriptRowLedgerOpenHeader {
        agent_id,
        project_path,
        worktree_path,
        source_path: replay_context.source_path.clone(),
        sequence_id: session_metadata.sequence_id,
        session_title: resolve_canonical_session_title(
            Some(session_metadata),
            &replay_context.local_session_id,
            rebuilt.first_user_title.as_deref(),
        ),
        turn_state: rebuilt.session.turn_state.clone(),
        message_count: rebuilt.session.message_count,
        activity,
        active_streaming_tail: None,
        lifecycle: lifecycle.clone(),
        capabilities: capabilities.clone(),
        active_turn_failure,
        last_terminal_turn_id: rebuilt.session.last_terminal_turn_id.clone(),
    })
}

fn open_header_for_rebuilt_provider_ledger(
    replay_context: &SessionReplayContext,
    session_metadata: &crate::db::repository::SessionMetadataRow,
    lifecycle: &SessionGraphLifecycle,
    capabilities: &SessionGraphCapabilities,
    rebuilt: &RebuiltProviderTranscriptRowLedger,
) -> Result<SessionTranscriptRowLedgerOpenHeader> {
    let agent_id = session_metadata
        .agent_id_enum()
        .unwrap_or_else(|| replay_context.agent_id.clone());
    let project_path = if session_metadata.project_path.trim().is_empty() {
        replay_context.project_path.clone()
    } else {
        session_metadata.project_path.clone()
    };
    let worktree_path = session_metadata
        .worktree_path
        .clone()
        .or_else(|| replay_context.worktree_path.clone());

    Ok(SessionTranscriptRowLedgerOpenHeader {
        agent_id,
        project_path,
        worktree_path,
        source_path: replay_context.source_path.clone(),
        sequence_id: session_metadata.sequence_id,
        session_title: resolve_canonical_session_title(
            Some(session_metadata),
            &replay_context.local_session_id,
            rebuilt.first_user_title.as_deref(),
        ),
        turn_state: rebuilt.session.turn_state.clone(),
        message_count: rebuilt.session.message_count,
        activity: rebuilt.activity.clone(),
        active_streaming_tail: rebuilt.active_streaming_tail.clone(),
        lifecycle: lifecycle.clone(),
        capabilities: capabilities.clone(),
        active_turn_failure: rebuilt.session.active_turn_failure.clone(),
        last_terminal_turn_id: rebuilt.session.last_terminal_turn_id.clone(),
    })
}

fn max_session_event_seq(
    replay_context: &SessionReplayContext,
    events: &[SessionJournalEvent],
) -> Option<i64> {
    events
        .iter()
        .filter(|event| event.session_id == replay_context.local_session_id)
        .map(|event| event.event_seq)
        .max()
}

fn empty_transcript_snapshot(revision: i64) -> TranscriptSnapshot {
    TranscriptSnapshot {
        revision,
        entries: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        rebuild_transcript_row_ledger_from_journal,
        rebuild_transcript_row_ledger_from_provider_snapshot,
    };
    use crate::acp::parsers::AgentType;
    use crate::acp::session_descriptor::{SessionDescriptorCompatibility, SessionReplayContext};
    use crate::acp::session_journal::{
        rebuild_local_transcript_snapshot, rebuild_session_projection, ProjectionJournalUpdate,
        SessionJournalEvent, SessionJournalEventPayload,
    };
    use crate::acp::session_state_engine::selectors::SessionGraphLifecycle;
    use crate::acp::session_thread_snapshot::{
        ProviderOwnedSessionSnapshot, SessionThreadSnapshot,
    };
    use crate::acp::session_update::{
        ContentChunk, SessionUpdate, ToolArguments, ToolCallData, ToolCallStatus, ToolKind,
    };
    use crate::acp::streaming_log::{clear_session_log, log_emitted_event, log_streaming_event};
    use crate::acp::transcript_viewport::ledger::{
        serialize_viewport_rows_for_ledger, TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
    };
    use crate::acp::transcript_viewport::projection::project_transcript_viewport_rows;
    use crate::acp::transcript_viewport::row::TranscriptViewportRow;
    use crate::acp::types::{CanonicalAgentId, ContentBlock};
    use crate::session_jsonl::types::StoredEntry;
    use serde_json::json;

    #[test]
    fn transcript_row_ledger_rebuild_from_journal_matches_full_projection() {
        let replay_context = replay_context();
        let events = vec![
            event_from_update(
                1,
                SessionUpdate::UserMessageChunk {
                    chunk: text_chunk("hello"),
                    session_id: Some("local-session".to_string()),
                    attempt_id: Some("attempt-1".to_string()),
                },
            ),
            event_from_update(
                2,
                SessionUpdate::AgentMessageChunk {
                    chunk: text_chunk("world"),
                    part_id: Some("assistant-part-1".to_string()),
                    message_id: Some("assistant-1".to_string()),
                    parent_tool_use_id: None,
                    session_id: Some("local-session".to_string()),
                    produced_at_monotonic_ms: None,
                },
            ),
            event_from_update(
                3,
                SessionUpdate::TurnComplete {
                    session_id: Some("local-session".to_string()),
                    turn_id: Some("turn-1".to_string()),
                },
            ),
        ];

        let rebuilt = rebuild_transcript_row_ledger_from_journal(&replay_context, &events)
            .expect("journal rebuild should succeed")
            .expect("session events should rebuild a ledger");
        let projection = rebuild_session_projection(&replay_context, &events);
        let transcript_snapshot = rebuild_local_transcript_snapshot(&replay_context, &events)
            .expect("transcript should rebuild");
        let viewport_rows = project_transcript_viewport_rows(
            &transcript_snapshot,
            &projection.operations,
            &projection.interactions,
            None,
            false,
            None,
        );
        let expected_rows = serialize_viewport_rows_for_ledger(
            &replay_context.local_session_id,
            rebuilt.revision.transcript_revision,
            rebuilt.revision.graph_revision,
            TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
            &viewport_rows,
        )
        .expect("full projection rows should serialize");

        assert_eq!(
            rebuilt.projection_version,
            TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION
        );
        assert_eq!(rebuilt.revision.last_event_seq, 3);
        assert_eq!(rebuilt.rows, expected_rows);
    }

    #[test]
    fn transcript_row_ledger_rebuild_repairs_legacy_subagent_chunks_from_streaming_log() {
        let mut replay_context = replay_context();
        replay_context.local_session_id =
            format!("legacy-subagent-repair-{}", uuid::Uuid::new_v4());
        let _ = clear_session_log(&replay_context.local_session_id);
        log_streaming_event(
            &replay_context.local_session_id,
            &json!({
                "type": "assistant",
                "message": {
                    "parent_tool_use_id": "toolu_task_parent",
                    "content": [
                        {
                            "type": "text",
                            "text": "child report"
                        }
                    ]
                }
            }),
        );
        log_emitted_event(
            &replay_context.local_session_id,
            &json!({
                "type": "agentMessageChunk",
                "session_id": replay_context.local_session_id,
                "chunk": {
                    "content": {
                        "type": "text",
                        "text": "child report"
                    }
                }
            }),
        );
        let events = vec![
            event_from_update_for_session(
                &replay_context.local_session_id,
                1,
                SessionUpdate::UserMessageChunk {
                    chunk: text_chunk("hello"),
                    session_id: Some(replay_context.local_session_id.clone()),
                    attempt_id: Some("attempt-1".to_string()),
                },
            ),
            event_from_update_for_session(
                &replay_context.local_session_id,
                2,
                SessionUpdate::AgentMessageChunk {
                    chunk: text_chunk("main before"),
                    part_id: None,
                    message_id: None,
                    parent_tool_use_id: None,
                    session_id: Some(replay_context.local_session_id.clone()),
                    produced_at_monotonic_ms: None,
                },
            ),
            event_from_update_for_session(
                &replay_context.local_session_id,
                3,
                SessionUpdate::AgentMessageChunk {
                    chunk: text_chunk("child report"),
                    part_id: None,
                    message_id: None,
                    parent_tool_use_id: None,
                    session_id: Some(replay_context.local_session_id.clone()),
                    produced_at_monotonic_ms: None,
                },
            ),
            event_from_update_for_session(
                &replay_context.local_session_id,
                4,
                SessionUpdate::AgentMessageChunk {
                    chunk: text_chunk(" main after"),
                    part_id: None,
                    message_id: None,
                    parent_tool_use_id: None,
                    session_id: Some(replay_context.local_session_id.clone()),
                    produced_at_monotonic_ms: None,
                },
            ),
            event_from_update_for_session(
                &replay_context.local_session_id,
                5,
                SessionUpdate::TurnComplete {
                    session_id: Some(replay_context.local_session_id.clone()),
                    turn_id: Some("turn-1".to_string()),
                },
            ),
        ];

        let rebuilt = rebuild_transcript_row_ledger_from_journal(&replay_context, &events)
            .expect("journal rebuild should succeed")
            .expect("session events should rebuild a ledger");
        let combined_rows = rebuilt
            .rows
            .iter()
            .map(|row| row.row_json.as_str())
            .collect::<String>();

        assert!(combined_rows.contains("main before"));
        assert!(combined_rows.contains("main after"));
        assert!(!combined_rows.contains("child report"));
        let _ = clear_session_log(&replay_context.local_session_id);
    }

    #[test]
    fn transcript_row_ledger_rebuild_records_empty_barrier_session() {
        let replay_context = replay_context();
        let events = vec![
            SessionJournalEvent::new(
                "local-session",
                1,
                SessionJournalEventPayload::MaterializationBarrier,
            ),
            SessionJournalEvent::new(
                "local-session",
                2,
                SessionJournalEventPayload::MaterializationBarrier,
            ),
        ];

        let rebuilt = rebuild_transcript_row_ledger_from_journal(&replay_context, &events)
            .expect("barrier-only rebuild should succeed")
            .expect("barrier-only session should materialize an empty ledger");

        assert_eq!(rebuilt.revision.graph_revision, 2);
        assert_eq!(rebuilt.revision.transcript_revision, 2);
        assert_eq!(rebuilt.revision.last_event_seq, 2);
        assert!(rebuilt.rows.is_empty());
    }

    #[test]
    fn transcript_row_ledger_rebuild_ignores_other_sessions() {
        let replay_context = replay_context();
        let events = vec![SessionJournalEvent::new(
            "other-session",
            1,
            SessionJournalEventPayload::MaterializationBarrier,
        )];

        let rebuilt = rebuild_transcript_row_ledger_from_journal(&replay_context, &events)
            .expect("other session events should not fail");

        assert!(rebuilt.is_none());
    }

    #[test]
    fn transcript_row_ledger_rebuild_from_provider_snapshot_keeps_tool_display_facts() {
        let replay_context = replay_context();
        let provider_snapshot =
            ProviderOwnedSessionSnapshot::from_thread_snapshot(SessionThreadSnapshot {
                entries: vec![StoredEntry::ToolCall {
                    id: "tool-entry-1".to_string(),
                    message: ToolCallData {
                        id: "toolu_01read".to_string(),
                        name: "Read".to_string(),
                        arguments: ToolArguments::Read {
                            file_path: Some("/repo/README.md".to_string()),
                            source_context: None,
                        },
                        diagnostic_input: None,
                        status: ToolCallStatus::Completed,
                        result: Some(json!({ "content": "README contents" })),
                        kind: Some(ToolKind::Read),
                        title: Some("Read README.md".to_string()),
                        locations: None,
                        skill_meta: None,
                        normalized_questions: None,
                        normalized_todos: None,
                        normalized_todo_update: None,
                        parent_tool_use_id: None,
                        task_children: None,
                        question_answer: None,
                        awaiting_plan_approval: false,
                        plan_approval_request_id: None,
                    },
                    timestamp: None,
                }],
                title: "Provider session".to_string(),
                created_at: "2026-07-06T00:00:00Z".to_string(),
                current_mode_id: None,
            });

        let rebuilt = rebuild_transcript_row_ledger_from_provider_snapshot(
            &replay_context,
            &SessionGraphLifecycle::detached(
                crate::acp::lifecycle::DetachedReason::RestoredRequiresAttach,
            ),
            &provider_snapshot,
            0,
        )
        .expect("provider snapshot should rebuild a ledger");

        assert_eq!(
            rebuilt.projection_version,
            TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION
        );
        assert_eq!(rebuilt.revision.last_event_seq, 0);
        assert!(!rebuilt.rows.is_empty());
        let row = rebuilt
            .rows
            .iter()
            .find_map(|row| serde_json::from_str::<TranscriptViewportRow>(&row.row_json).ok())
            .expect("provider ledger should contain a viewport row");
        let link = row
            .operation_links
            .first()
            .expect("tool row should link to an operation");
        let facts = link
            .display_facts
            .as_ref()
            .expect("tool operation link should include display facts");
        assert_eq!(facts.title, "Read README.md");
    }

    fn replay_context() -> SessionReplayContext {
        SessionReplayContext {
            local_session_id: "local-session".to_string(),
            history_session_id: "provider-session".to_string(),
            agent_id: CanonicalAgentId::Copilot,
            parser_agent_type: AgentType::Copilot,
            project_path: "/repo".to_string(),
            worktree_path: None,
            effective_cwd: "/repo".to_string(),
            source_path: None,
            compatibility: SessionDescriptorCompatibility::Canonical,
        }
    }

    fn event_from_update(event_seq: i64, update: SessionUpdate) -> SessionJournalEvent {
        event_from_update_for_session("local-session", event_seq, update)
    }

    fn event_from_update_for_session(
        session_id: &str,
        event_seq: i64,
        update: SessionUpdate,
    ) -> SessionJournalEvent {
        SessionJournalEvent::new(
            session_id,
            event_seq,
            SessionJournalEventPayload::ProjectionUpdate {
                update: Box::new(
                    ProjectionJournalUpdate::from_session_update(&update)
                        .expect("update should be supported by the session journal"),
                ),
            },
        )
    }

    fn text_chunk(text: &str) -> ContentChunk {
        ContentChunk {
            content: ContentBlock::Text {
                text: text.to_string(),
            },
            aggregation_hint: None,
        }
    }
}
