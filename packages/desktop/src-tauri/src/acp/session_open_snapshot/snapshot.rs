use crate::acp::event_hub::AcpEventHubState;
use crate::acp::projections::{
    is_terminal_operation_state, InteractionState, ProjectionRegistry, SessionProjectionSnapshot,
    SessionSnapshot, SessionTurnState,
};
use crate::acp::session_descriptor::SessionReplayContext;
use crate::acp::session_materialization::materialize_provider_owned_thread_snapshot;
use crate::acp::session_state_engine::graph::select_active_streaming_tail;
use crate::acp::session_state_engine::protocol::ViewportBufferPush;
use crate::acp::session_state_engine::runtime_registry::SessionGraphRuntimeRegistry;
use crate::acp::session_state_engine::selectors::{
    select_session_graph_activity, SessionGraphCapabilities, SessionGraphLifecycle,
};
use crate::acp::session_state_engine::{
    SessionGraphRevision, SessionStateEnvelope, SessionStatePayload,
};
use crate::acp::session_thread_snapshot::{ProviderOwnedSessionSnapshot, SessionThreadSnapshot};
use crate::acp::transcript_projection::{
    assistant_boundary_entry_count_from_transcript_entries, TranscriptEntryRole,
    TranscriptProjectionRegistry, TranscriptSegment, TranscriptSnapshot,
};
use crate::acp::transcript_viewport::ledger::{
    SerializedTranscriptRowLedgerRow, SessionTranscriptRowLedgerOpenHeader,
    SessionTranscriptRowLedgerRead, SessionTranscriptRowLedgerStatus,
    TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
};
use crate::acp::transcript_viewport::TranscriptViewportRow;
use crate::db::repository::{
    SessionJournalEventRepository, SessionMetadataRepository, SessionTranscriptRowLedgerRepository,
};
use sea_orm::DbConn;
use std::collections::HashSet;
use std::sync::Arc;
use std::time::Instant;
use uuid::Uuid;

use super::operation_sanitize::{
    sanitize_interactions_for_historical_open, sanitize_operations_for_historical_open,
    warn_unresolved_tool_rows_in_open_graph,
};
use super::transcript_merge::merge_provider_tool_rows_into_local_transcript;
use super::types::{
    NewSessionOpenResultInput, SessionOpenError, SessionOpenFound, SessionOpenPath,
    SessionOpenResult, SessionOpenTranscriptRowPage,
};

/// Build a short display title from a session ID (first 8 chars).
pub(crate) fn default_session_title(session_id: &str) -> String {
    format!("Session {}", &session_id[..8.min(session_id.len())])
}

fn session_open_result_byte_len(result: &SessionOpenResult) -> usize {
    serde_json::to_vec(result)
        .map(|bytes| bytes.len())
        .unwrap_or(usize::MAX)
}

pub(crate) const SESSION_OPEN_TRANSCRIPT_COMPACTION_ENTRY_THRESHOLD: usize = 1_000;

fn elapsed_ms(start: Instant) -> u128 {
    start.elapsed().as_millis()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CurrentRowLedgerInitialPagePolicy {
    pub max_rows: u64,
    pub min_rows: usize,
    pub max_row_payload_bytes: Option<u64>,
}

impl CurrentRowLedgerInitialPagePolicy {
    pub fn rows_only(max_rows: u64) -> Self {
        Self {
            max_rows,
            min_rows: max_rows as usize,
            max_row_payload_bytes: None,
        }
    }

    pub fn byte_bounded(max_rows: u64, min_rows: usize, max_row_payload_bytes: u64) -> Self {
        Self {
            max_rows,
            min_rows,
            max_row_payload_bytes: Some(max_row_payload_bytes),
        }
    }
}

fn trim_initial_ledger_rows_for_policy(
    rows: Vec<SerializedTranscriptRowLedgerRow>,
    policy: CurrentRowLedgerInitialPagePolicy,
) -> Vec<SerializedTranscriptRowLedgerRow> {
    let Some(max_row_payload_bytes) = policy.max_row_payload_bytes else {
        return rows;
    };
    if rows.is_empty() {
        return rows;
    }

    let min_rows = policy.min_rows.max(1).min(rows.len());
    let mut payload_bytes = rows
        .iter()
        .map(|row| row.row_json.len() as u64)
        .sum::<u64>();
    let mut first_kept_index = 0usize;

    while first_kept_index + min_rows < rows.len() && payload_bytes > max_row_payload_bytes {
        payload_bytes = payload_bytes.saturating_sub(rows[first_kept_index].row_json.len() as u64);
        first_kept_index += 1;
    }

    if first_kept_index == 0 {
        return rows;
    }

    rows.into_iter().skip(first_kept_index).collect()
}

pub fn apply_runtime_authority_to_session_open_result(
    mut result: SessionOpenResult,
    runtime_registry: Option<&SessionGraphRuntimeRegistry>,
) -> SessionOpenResult {
    let Some(runtime_registry) = runtime_registry else {
        return result;
    };
    let SessionOpenResult::Found(found) = &mut result else {
        return result;
    };
    let Some(runtime_snapshot) =
        runtime_registry.current_snapshot_for_session(&found.canonical_session_id)
    else {
        return result;
    };
    found.graph_revision = found.graph_revision.max(runtime_snapshot.graph_revision);
    found.lifecycle = runtime_snapshot.lifecycle;
    found.capabilities = runtime_snapshot.capabilities;
    found.activity = select_session_graph_activity(
        &found.lifecycle,
        &found.turn_state,
        &found.operations,
        &found.interactions,
        found.active_turn_failure.as_ref(),
    );

    if found.initial_transcript_row_page.is_none() {
        update_initial_viewport_envelope_graph_revision(
            &mut found.initial_viewport_envelope,
            found.graph_revision,
        );
    }

    result
}

fn update_initial_viewport_envelope_graph_revision(
    envelope: &mut Option<SessionStateEnvelope>,
    graph_revision: i64,
) {
    let Some(envelope) = envelope else {
        return;
    };
    envelope.graph_revision = graph_revision;
    if let SessionStatePayload::ViewportBufferPush { push } = &mut envelope.payload {
        push.graph_revision.graph_revision = graph_revision;
    }
}

pub(crate) fn session_projection_snapshot_from_open_found(
    found: &SessionOpenFound,
) -> SessionProjectionSnapshot {
    SessionProjectionSnapshot {
        session: Some(SessionSnapshot {
            session_id: found.canonical_session_id.clone(),
            agent_id: Some(found.agent_id.clone()),
            last_event_seq: found.last_event_seq,
            turn_state: found.turn_state.clone(),
            message_count: found.message_count,
            active_tool_call_ids: Vec::new(),
            completed_tool_call_ids: found
                .operations
                .iter()
                .filter(|operation| is_terminal_operation_state(&operation.operation_state))
                .map(|operation| operation.tool_call_id.clone())
                .collect(),
            active_turn_failure: found.active_turn_failure.clone(),
            last_terminal_turn_id: found.last_terminal_turn_id.clone(),
            assistant_boundary_entry_count: assistant_boundary_entry_count_from_transcript_entries(
                &found.transcript_snapshot.entries,
            ),
            transcript_entry_count: found.transcript_snapshot.entries.len(),
        }),
        operations: found.operations.clone(),
        interactions: found.interactions.clone(),
        runtime: None,
    }
}

fn build_initial_viewport_envelope(
    runtime_registry: Option<&SessionGraphRuntimeRegistry>,
    found: &SessionOpenFound,
) -> Option<SessionStateEnvelope> {
    if found.message_count == 0 {
        return None;
    }
    let runtime_registry = runtime_registry?;
    let projection_registry = ProjectionRegistry::new();
    projection_registry
        .restore_session_projection(session_projection_snapshot_from_open_found(found));
    let transcript_projection_registry = TranscriptProjectionRegistry::new();
    transcript_projection_registry.restore_session_snapshot(
        found.canonical_session_id.clone(),
        found.transcript_snapshot.clone(),
    );
    let revision = SessionGraphRevision::new(
        found.graph_revision,
        found.transcript_snapshot.revision,
        found.last_event_seq,
    );

    match runtime_registry.build_initial_viewport_buffer_envelope_for_session(
        &found.canonical_session_id,
        revision,
        &projection_registry,
        &transcript_projection_registry,
    ) {
        Ok(envelope) => Some(envelope),
        Err(error) => {
            tracing::warn!(
                session_id = %found.canonical_session_id,
                ?error,
                "Failed to attach initial viewport envelope to session-open result"
            );
            None
        }
    }
}

pub fn compact_oversized_session_open_result(result: SessionOpenResult) -> SessionOpenResult {
    let max_bytes = crate::acp::session_state_engine::SessionStatePayloadKind::Snapshot.max_bytes();

    let found = match result {
        SessionOpenResult::Found(found) => found,
        other => return other,
    };

    if found.transcript_snapshot.entries.len() > SESSION_OPEN_TRANSCRIPT_COMPACTION_ENTRY_THRESHOLD
    {
        return compact_found_session_open_result(found, max_bytes);
    }

    let result = SessionOpenResult::Found(found);
    if session_open_result_byte_len(&result) <= max_bytes {
        return result;
    }

    let SessionOpenResult::Found(found) = result else {
        return result;
    };

    compact_found_session_open_result(found, max_bytes)
}

fn compact_found_session_open_result(
    found: Box<SessionOpenFound>,
    max_bytes: usize,
) -> SessionOpenResult {
    if found.transcript_snapshot.entries.is_empty() {
        return SessionOpenResult::Found(found);
    }

    let mut compact_found = *found;
    let full_entry_count = compact_found.transcript_snapshot.entries.len();
    let full_operation_count = compact_found.operations.len();
    let (viewport_operation_ids, viewport_tool_call_ids) =
        initial_viewport_operation_refs(&compact_found);
    compact_found.transcript_snapshot.entries.clear();
    compact_found.operations =
        crate::acp::session_wire_compaction::compact_operations_for_ipc(compact_found.operations);
    let mut compacted = SessionOpenResult::Found(Box::new(compact_found));

    if session_open_result_byte_len(&compacted) > max_bytes
        && (!viewport_operation_ids.is_empty() || !viewport_tool_call_ids.is_empty())
    {
        compacted = match compacted {
            SessionOpenResult::Found(found) => {
                let mut compact_found = *found;
                compact_found.operations =
                    crate::acp::session_wire_compaction::compact_viewport_or_actionable_operations_for_ipc(
                        compact_found.operations,
                        &viewport_operation_ids,
                        &viewport_tool_call_ids,
                    );
                SessionOpenResult::Found(Box::new(compact_found))
            }
            other => other,
        };
    }

    if session_open_result_byte_len(&compacted) > max_bytes {
        compacted = match compacted {
            SessionOpenResult::Found(found) => {
                let mut compact_found = *found;
                compact_found.operations =
                    crate::acp::session_wire_compaction::compact_actionable_operations_for_ipc(
                        compact_found.operations,
                    );
                SessionOpenResult::Found(Box::new(compact_found))
            }
            other => other,
        };
    }

    if session_open_result_byte_len(&compacted) > max_bytes {
        compacted = match compacted {
            SessionOpenResult::Found(found) => {
                let mut compact_found = *found;
                compact_found.operations.clear();
                SessionOpenResult::Found(Box::new(compact_found))
            }
            other => other,
        };
    }

    let compacted_byte_len = session_open_result_byte_len(&compacted);
    let compacted_operation_count = match &compacted {
        SessionOpenResult::Found(found) => found.operations.len(),
        SessionOpenResult::Missing(_) | SessionOpenResult::Error(_) => 0,
    };
    let compacted_session_id = match &compacted {
        SessionOpenResult::Found(found) => found.canonical_session_id.as_str(),
        SessionOpenResult::Missing(missing) => missing.requested_session_id.as_str(),
        SessionOpenResult::Error(error) => error.requested_session_id.as_str(),
    };

    tracing::warn!(
        session_id = %compacted_session_id,
        full_entry_count,
        full_operation_count,
        compacted_operation_count,
        entry_threshold = SESSION_OPEN_TRANSCRIPT_COMPACTION_ENTRY_THRESHOLD,
        compacted_byte_len,
        max_bytes,
        "Compacted oversized session-open transcript body; viewport rows remain authoritative"
    );

    compacted
}

fn initial_viewport_operation_refs(found: &SessionOpenFound) -> (HashSet<String>, HashSet<String>) {
    let mut operation_ids = HashSet::new();
    let mut tool_call_ids = HashSet::new();
    let Some(envelope) = &found.initial_viewport_envelope else {
        return (operation_ids, tool_call_ids);
    };
    let crate::acp::session_state_engine::SessionStatePayload::ViewportBufferPush { push } =
        &envelope.payload
    else {
        return (operation_ids, tool_call_ids);
    };

    for row in &push.rows {
        for link in &row.operation_links {
            operation_ids.insert(link.operation_id.clone());
            tool_call_ids.insert(link.tool_call_id.clone());
        }
    }

    (operation_ids, tool_call_ids)
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CurrentRowLedgerOpenMiss {
    Missing,
    StaleProjection,
    RebuildNeeded,
    BehindJournal,
    SupersededOpen,
    MissingOpenHeader,
    CorruptOpenHeader,
    CorruptRow,
}

impl CurrentRowLedgerOpenMiss {
    pub fn timing_label(self) -> &'static str {
        match self {
            Self::Missing => "missing",
            Self::StaleProjection => "stale_projection",
            Self::RebuildNeeded => "rebuild_needed",
            Self::BehindJournal => "behind_journal",
            Self::SupersededOpen => "superseded_open",
            Self::MissingOpenHeader => "missing_open_header",
            Self::CorruptOpenHeader => "corrupt_open_header",
            Self::CorruptRow => "corrupt_row",
        }
    }
}

#[derive(Debug)]
pub enum CurrentRowLedgerOpenLookup {
    Found {
        result: SessionOpenResult,
        timing: CurrentRowLedgerOpenTiming,
    },
    Miss(CurrentRowLedgerOpenMiss),
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CurrentRowLedgerOpenTiming {
    pub journal_cutoff_ms: u128,
    pub page_read_ms: u128,
    pub header_decode_ms: u128,
    pub rows_decode_ms: u128,
    pub result_build_ms: u128,
    pub total_ms: u128,
}

pub async fn session_open_result_from_current_row_ledger_with_status(
    db: &DbConn,
    hub: &Arc<AcpEventHubState>,
    replay_context: &SessionReplayContext,
    requested_session_id: &str,
    limit: u64,
) -> Result<CurrentRowLedgerOpenLookup, String> {
    session_open_result_from_current_row_ledger_with_initial_page_policy(
        db,
        hub,
        replay_context,
        requested_session_id,
        CurrentRowLedgerInitialPagePolicy::rows_only(limit),
    )
    .await
}

pub async fn session_open_result_from_current_row_ledger_with_initial_page_policy(
    db: &DbConn,
    hub: &Arc<AcpEventHubState>,
    replay_context: &SessionReplayContext,
    requested_session_id: &str,
    policy: CurrentRowLedgerInitialPagePolicy,
) -> Result<CurrentRowLedgerOpenLookup, String> {
    let total_started_at = Instant::now();
    let canonical_session_id = &replay_context.local_session_id;
    let open_token = Uuid::new_v4();
    let epoch_ms = chrono::Utc::now().timestamp_millis().max(0) as u64;
    hub.arm_reservation(open_token, canonical_session_id.clone(), 0, epoch_ms);
    let journal_cutoff_started_at = Instant::now();
    let row_affecting_cutoff = match SessionJournalEventRepository::max_row_affecting_event_seq(
        db,
        canonical_session_id,
    )
    .await
    {
        Ok(cutoff) => cutoff.unwrap_or(0),
        Err(error) => {
            hub.supersede_reservation(open_token);
            return Err(format!(
                "Failed to determine row-affecting journal cutoff for session {canonical_session_id}: {error}"
            ));
        }
    };
    let journal_cutoff_ms = elapsed_ms(journal_cutoff_started_at);
    let page_read_started_at = Instant::now();
    let ledger_read = match SessionTranscriptRowLedgerRepository::read_tail_page(
        db,
        canonical_session_id,
        TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
        policy.max_rows,
    )
    .await
    {
        Ok(ledger_read) => ledger_read,
        Err(error) => {
            hub.supersede_reservation(open_token);
            return Err(format!(
                "Failed to read transcript row ledger for session {canonical_session_id}: {error}"
            ));
        }
    };
    let page_read_ms = elapsed_ms(page_read_started_at);

    let (metadata, rows) = match ledger_read {
        SessionTranscriptRowLedgerRead::Current { metadata, rows } => (metadata, rows),
        SessionTranscriptRowLedgerRead::Missing => {
            hub.supersede_reservation(open_token);
            return Ok(CurrentRowLedgerOpenLookup::Miss(
                CurrentRowLedgerOpenMiss::Missing,
            ));
        }
        SessionTranscriptRowLedgerRead::Stale { metadata } => {
            let miss = if metadata.rebuild_status == SessionTranscriptRowLedgerStatus::RebuildNeeded
            {
                CurrentRowLedgerOpenMiss::RebuildNeeded
            } else {
                CurrentRowLedgerOpenMiss::StaleProjection
            };
            hub.supersede_reservation(open_token);
            return Ok(CurrentRowLedgerOpenLookup::Miss(miss));
        }
    };
    if metadata.last_event_seq < row_affecting_cutoff {
        hub.supersede_reservation(open_token);
        return Ok(CurrentRowLedgerOpenLookup::Miss(
            CurrentRowLedgerOpenMiss::BehindJournal,
        ));
    }

    let Some(open_header_json) = metadata.open_header_json.as_deref() else {
        if let Err(error) = mark_current_row_ledger_rebuild_needed(
            db,
            &metadata,
            "missing transcript row ledger open header",
        )
        .await
        {
            hub.supersede_reservation(open_token);
            return Err(error);
        }
        hub.supersede_reservation(open_token);
        return Ok(CurrentRowLedgerOpenLookup::Miss(
            CurrentRowLedgerOpenMiss::MissingOpenHeader,
        ));
    };
    let header_decode_started_at = Instant::now();
    let open_header: SessionTranscriptRowLedgerOpenHeader =
        match serde_json::from_str(open_header_json) {
            Ok(open_header) => open_header,
            Err(error) => {
                tracing::warn!(
                    session_id = %canonical_session_id,
                    error = %error,
                    "Current transcript row ledger header is corrupt; marking rebuild-needed"
                );
                if let Err(message) = mark_current_row_ledger_rebuild_needed(
                    db,
                    &metadata,
                    "corrupt transcript row ledger open header",
                )
                .await
                {
                    hub.supersede_reservation(open_token);
                    return Err(message);
                }
                hub.supersede_reservation(open_token);
                return Ok(CurrentRowLedgerOpenLookup::Miss(
                    CurrentRowLedgerOpenMiss::CorruptOpenHeader,
                ));
            }
        };
    let header_decode_ms = elapsed_ms(header_decode_started_at);
    let rows = trim_initial_ledger_rows_for_policy(rows, policy);
    let start_row_index = rows.first().map(|row| row.row_index).unwrap_or(0);
    let row_payload_bytes = rows
        .iter()
        .map(|row| row.row_json.len() as u64)
        .sum::<u64>();
    let mut viewport_rows = Vec::with_capacity(rows.len());
    let rows_decode_started_at = Instant::now();
    for row in rows {
        match serde_json::from_str::<TranscriptViewportRow>(&row.row_json) {
            Ok(viewport_row) => viewport_rows.push(viewport_row),
            Err(error) => {
                tracing::warn!(
                    session_id = %canonical_session_id,
                    row_id = %row.row_id,
                    error = %error,
                    "Current transcript row ledger row is corrupt; marking rebuild-needed"
                );
                if let Err(message) = mark_current_row_ledger_rebuild_needed(
                    db,
                    &metadata,
                    "corrupt transcript row ledger row",
                )
                .await
                {
                    hub.supersede_reservation(open_token);
                    return Err(message);
                }
                hub.supersede_reservation(open_token);
                return Ok(CurrentRowLedgerOpenLookup::Miss(
                    CurrentRowLedgerOpenMiss::CorruptRow,
                ));
            }
        }
    }
    let rows_decode_ms = elapsed_ms(rows_decode_started_at);

    let result_build_started_at = Instant::now();
    if !hub.raise_reservation_frontier(open_token, canonical_session_id, metadata.last_event_seq) {
        hub.supersede_reservation(open_token);
        return Ok(CurrentRowLedgerOpenLookup::Miss(
            CurrentRowLedgerOpenMiss::SupersededOpen,
        ));
    }
    let revision = SessionGraphRevision::new(
        metadata.graph_revision,
        metadata.transcript_revision,
        metadata.last_event_seq,
    );
    let initial_transcript_row_page = SessionOpenTranscriptRowPage {
        projection_version: metadata.projection_version.clone(),
        start_row_index,
        total_row_count: metadata.row_count,
        row_payload_bytes,
        transcript_revision: metadata.transcript_revision,
        graph_revision: metadata.graph_revision,
        last_event_seq: metadata.last_event_seq,
        rows: viewport_rows.clone(),
    };
    let initial_viewport_envelope = SessionStateEnvelope {
        session_id: canonical_session_id.clone(),
        graph_revision: metadata.graph_revision,
        last_event_seq: metadata.last_event_seq,
        payload: SessionStatePayload::ViewportBufferPush {
            push: ViewportBufferPush {
                session_id: canonical_session_id.clone(),
                graph_revision: revision,
                emission_seq: 1,
                rows: viewport_rows,
                request_generation: None,
                diagnostics: Vec::new(),
            },
        },
    };

    let result = SessionOpenResult::Found(Box::new(SessionOpenFound {
        requested_session_id: requested_session_id.to_string(),
        canonical_session_id: canonical_session_id.clone(),
        is_alias: requested_session_id != canonical_session_id,
        last_event_seq: metadata.last_event_seq,
        graph_revision: metadata.graph_revision,
        open_token: open_token.to_string(),
        agent_id: open_header.agent_id,
        project_path: open_header.project_path,
        worktree_path: open_header.worktree_path,
        source_path: open_header.source_path,
        sequence_id: open_header.sequence_id,
        transcript_snapshot: TranscriptSnapshot {
            revision: metadata.transcript_revision,
            entries: Vec::new(),
        },
        session_title: open_header.session_title,
        operations: Vec::new(),
        interactions: Vec::new(),
        turn_state: open_header.turn_state,
        message_count: open_header.message_count,
        activity: open_header.activity,
        active_streaming_tail: open_header.active_streaming_tail,
        lifecycle: open_header.lifecycle,
        capabilities: open_header.capabilities,
        open_path: SessionOpenPath::HotLedger,
        initial_transcript_row_page: Some(initial_transcript_row_page),
        initial_viewport_envelope: Some(initial_viewport_envelope),
        open_result_timing: None,
        active_turn_failure: open_header.active_turn_failure,
        last_terminal_turn_id: open_header.last_terminal_turn_id,
    }));
    let result_build_ms = elapsed_ms(result_build_started_at);

    Ok(CurrentRowLedgerOpenLookup::Found {
        result,
        timing: CurrentRowLedgerOpenTiming {
            journal_cutoff_ms,
            page_read_ms,
            header_decode_ms,
            rows_decode_ms,
            result_build_ms,
            total_ms: elapsed_ms(total_started_at),
        },
    })
}

pub async fn session_open_result_from_current_row_ledger(
    db: &DbConn,
    hub: &Arc<AcpEventHubState>,
    replay_context: &SessionReplayContext,
    requested_session_id: &str,
    limit: u64,
) -> Result<Option<SessionOpenResult>, String> {
    match session_open_result_from_current_row_ledger_with_status(
        db,
        hub,
        replay_context,
        requested_session_id,
        limit,
    )
    .await?
    {
        CurrentRowLedgerOpenLookup::Found { result, .. } => Ok(Some(result)),
        CurrentRowLedgerOpenLookup::Miss(_) => Ok(None),
    }
}

async fn mark_current_row_ledger_rebuild_needed(
    db: &DbConn,
    metadata: &crate::acp::transcript_viewport::ledger::SessionTranscriptRowLedgerMetadata,
    reason: &str,
) -> Result<(), String> {
    SessionTranscriptRowLedgerRepository::mark_rebuild_needed(
        db,
        &metadata.session_id,
        &metadata.projection_version,
        metadata.transcript_revision,
        metadata.graph_revision,
        metadata.last_event_seq,
    )
    .await
    .map_err(|error| {
        format!(
            "Failed to mark transcript row ledger rebuild-needed for session {} after {reason}: {error}",
            metadata.session_id
        )
    })
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
    let total_started_at = Instant::now();
    let canonical_session_id = &replay_context.local_session_id;
    let is_alias = requested_session_id != canonical_session_id;
    let journal_cutoff_started_at = Instant::now();
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
    let journal_cutoff_ms = elapsed_ms(journal_cutoff_started_at);

    let open_token = Uuid::new_v4();
    let epoch_ms = chrono::Utc::now().timestamp_millis().max(0) as u64;
    hub.arm_reservation(
        open_token,
        canonical_session_id.clone(),
        last_event_seq,
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

    let materialize_started_at = Instant::now();
    let materialized = materialize_provider_owned_thread_snapshot(
        canonical_session_id,
        Some(replay_context.agent_id.clone()),
        last_event_seq,
        snapshot,
    );
    let materialize_ms = elapsed_ms(materialize_started_at);
    let projection = materialized.projection;
    let local_journal_started_at = Instant::now();
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
    let local_journal_ms = elapsed_ms(local_journal_started_at);
    let projection_started_at = Instant::now();
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
            journal_cutoff_ms,
            metadata_ms,
            materialize_ms,
            local_journal_ms,
            projection_ms,
            total_ms,
            transcript_entry_count = transcript_snapshot.entries.len(),
            operation_count = operations.len(),
            "Slow provider-owned session-open assembly"
        );
    }

    let mut found = SessionOpenFound {
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
        open_path: SessionOpenPath::CompatSnapshot,
        initial_transcript_row_page: None,
        initial_viewport_envelope: None,
        open_result_timing: None,
        active_turn_failure,
        last_terminal_turn_id,
    };
    found.initial_viewport_envelope = build_initial_viewport_envelope(runtime_registry, &found);

    SessionOpenResult::Found(Box::new(found))
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
        open_path: SessionOpenPath::LegacyRebuild,
        initial_transcript_row_page: None,
        initial_viewport_envelope: None,
        open_result_timing: None,
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

    let repaired_events =
        crate::acp::session_journal::repair_legacy_parent_tool_use_ids_from_streaming_log(
            replay_context,
            &journal_events,
        );

    Ok(
        crate::acp::session_journal::rebuild_completed_local_transcript_snapshot(
            replay_context,
            &repaired_events,
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

    let repaired_events =
        crate::acp::session_journal::repair_legacy_parent_tool_use_ids_from_streaming_log(
            replay_context,
            &journal_events,
        );

    Ok(
        crate::acp::session_journal::rebuild_local_transcript_snapshot(
            replay_context,
            &repaired_events,
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
        open_path: SessionOpenPath::CompatSnapshot,
        initial_transcript_row_page: None,
        initial_viewport_envelope: None,
        open_result_timing: None,
        active_turn_failure,
        last_terminal_turn_id: None,
    }))
}
