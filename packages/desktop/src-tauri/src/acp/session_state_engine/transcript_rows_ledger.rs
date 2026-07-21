use crate::acp::projections::{
    OperationSnapshot, OperationSourceLink, ProjectionRegistry, SessionSnapshot, SessionTurnState,
};
use crate::acp::session_state_engine::graph::{
    select_active_streaming_tail, select_active_streaming_tail_for_known_last_entry,
    ActiveStreamingTail,
};
use crate::acp::session_state_engine::protocol::{ViewportBufferDiagnostic, ViewportBufferPush};
use crate::acp::session_state_engine::runtime_registry::{
    SessionGraphRuntimeSnapshot, VisibleTranscriptWindowMiss,
};
use crate::acp::session_state_engine::selectors::{
    merge_session_graph_activity_timing, select_session_graph_activity, SessionGraphActivity,
    SessionGraphActivityKind, SessionGraphCapabilities, SessionGraphLifecycle,
};
use crate::acp::session_state_engine::timing::wall_clock_ms;
use crate::acp::session_state_engine::{
    session_state_envelope_byte_budget_status, SessionGraphRevision, SessionStateEnvelope,
    SessionStatePayload,
};
use crate::acp::transcript_projection::{
    TranscriptEntry, TranscriptEntryRole, TranscriptProjectionRegistry, TranscriptScope,
};
use crate::acp::transcript_viewport::ledger::{
    serialize_transcript_scopes_for_ledger, serialize_viewport_rows_for_ledger_from_index,
    SerializedTranscriptRowLedgerRow, SerializedTranscriptRowLedgerScope,
    TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
};
use crate::acp::transcript_viewport::{
    project_transcript_viewport_entry_rows, project_transcript_viewport_rows, TranscriptViewportRow,
};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone)]
pub struct TranscriptRowsLedger {
    activity_by_session: Arc<Mutex<HashMap<String, SessionGraphActivity>>>,
}

#[derive(Debug, Clone)]
pub(crate) struct TranscriptRowsMaterialization {
    pub rows: Vec<TranscriptViewportRow>,
    pub operations: Vec<OperationSnapshot>,
    pub session: SessionSnapshot,
    pub activity: SessionGraphActivity,
    pub active_streaming_tail: Option<ActiveStreamingTail>,
    pub lifecycle: SessionGraphLifecycle,
    pub capabilities: SessionGraphCapabilities,
    pub effective_revision: SessionGraphRevision,
    pub tail_limited: bool,
}

#[derive(Debug, Clone)]
pub(crate) struct PersistedTranscriptRowsMaterialization {
    pub projection_version: &'static str,
    pub effective_revision: SessionGraphRevision,
    pub total_row_count: i64,
    pub start_row_index: i64,
    pub replace_all: bool,
    pub force_full_replace: bool,
    pub session: SessionSnapshot,
    pub activity: SessionGraphActivity,
    pub active_streaming_tail: Option<ActiveStreamingTail>,
    pub lifecycle: SessionGraphLifecycle,
    pub capabilities: SessionGraphCapabilities,
    pub rows: Vec<SerializedTranscriptRowLedgerRow>,
    pub scopes: Vec<SerializedTranscriptRowLedgerScope>,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct TranscriptRowsLedgerWriteHint {
    pub force_full_replace: bool,
    pub changed_source_entry_ids: Vec<String>,
    pub changed_tool_call_ids: Vec<String>,
    pub changed_interaction_ids: Vec<String>,
}

impl TranscriptRowsLedgerWriteHint {
    pub(crate) fn full_replace() -> Self {
        Self {
            force_full_replace: true,
            changed_source_entry_ids: Vec::new(),
            changed_tool_call_ids: Vec::new(),
            changed_interaction_ids: Vec::new(),
        }
    }
}

impl TranscriptRowsLedger {
    #[must_use]
    pub fn new() -> Self {
        Self {
            activity_by_session: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn remove_session(&self, session_id: &str) {
        self.activity_by_session
            .lock()
            .expect("activity_by_session mutex poisoned")
            .remove(session_id);
    }

    pub(crate) fn materialize_rows(
        &self,
        runtime_snapshot: SessionGraphRuntimeSnapshot,
        session_id: &str,
        revision: SessionGraphRevision,
        projection_registry: &ProjectionRegistry,
        transcript_projection_registry: &TranscriptProjectionRegistry,
    ) -> Result<TranscriptRowsMaterialization, VisibleTranscriptWindowMiss> {
        self.materialize_rows_with_tail_limit(
            runtime_snapshot,
            session_id,
            revision,
            projection_registry,
            transcript_projection_registry,
            None,
        )
    }

    pub(crate) fn materialize_tail_rows(
        &self,
        runtime_snapshot: SessionGraphRuntimeSnapshot,
        session_id: &str,
        revision: SessionGraphRevision,
        projection_registry: &ProjectionRegistry,
        transcript_projection_registry: &TranscriptProjectionRegistry,
        tail_limit: usize,
    ) -> Result<TranscriptRowsMaterialization, VisibleTranscriptWindowMiss> {
        self.materialize_rows_with_tail_limit(
            runtime_snapshot,
            session_id,
            revision,
            projection_registry,
            transcript_projection_registry,
            Some(tail_limit),
        )
    }

    pub(crate) fn materialize_persisted_rows(
        &self,
        runtime_snapshot: SessionGraphRuntimeSnapshot,
        session_id: &str,
        revision: SessionGraphRevision,
        projection_registry: &ProjectionRegistry,
        transcript_projection_registry: &TranscriptProjectionRegistry,
        write_hint: &TranscriptRowsLedgerWriteHint,
    ) -> anyhow::Result<Option<PersistedTranscriptRowsMaterialization>> {
        if let Some(materialized) = self.materialize_changed_entry_suffix_persisted_rows(
            &runtime_snapshot,
            session_id,
            revision,
            projection_registry,
            transcript_projection_registry,
            write_hint,
        )? {
            return Ok(Some(materialized));
        }

        let materialized = match self.materialize_rows(
            runtime_snapshot,
            session_id,
            revision,
            projection_registry,
            transcript_projection_registry,
        ) {
            Ok(materialized) => materialized,
            Err(VisibleTranscriptWindowMiss::SessionNotAttached) => return Ok(None),
            Err(VisibleTranscriptWindowMiss::BudgetExceeded) => return Ok(None),
        };
        let rows = enrich_rows_with_operations(materialized.rows, &materialized.operations);
        let transcript_snapshot = transcript_projection_registry
            .snapshot_for_session(session_id)
            .ok_or_else(|| anyhow::anyhow!("transcript snapshot missing for {session_id}"))?;
        let projection_snapshot = projection_registry.session_projection(session_id);
        let scopes = serialize_transcript_scopes_for_ledger(
            session_id,
            materialized.effective_revision.transcript_revision,
            materialized.effective_revision.graph_revision,
            TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
            &transcript_snapshot,
            &materialized.operations,
            &projection_snapshot.interactions,
            materialized.active_streaming_tail.as_ref(),
            materialized.activity.kind_started_at_ms,
        )?;
        let start_row_index = first_changed_row_index(&rows, write_hint);
        let suffix_rows = &rows[start_row_index..];
        let serialized = serialize_viewport_rows_for_ledger_from_index(
            session_id,
            materialized.effective_revision.transcript_revision,
            materialized.effective_revision.graph_revision,
            TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
            start_row_index as i64,
            suffix_rows,
        )?;
        let replace_all = write_hint.force_full_replace || start_row_index == 0;

        Ok(Some(PersistedTranscriptRowsMaterialization {
            projection_version: TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
            effective_revision: materialized.effective_revision,
            total_row_count: rows.len() as i64,
            start_row_index: start_row_index as i64,
            replace_all,
            force_full_replace: write_hint.force_full_replace,
            session: materialized.session,
            activity: materialized.activity,
            active_streaming_tail: materialized.active_streaming_tail,
            lifecycle: materialized.lifecycle,
            capabilities: materialized.capabilities,
            rows: serialized,
            scopes,
        }))
    }

    fn materialize_changed_entry_suffix_persisted_rows(
        &self,
        runtime_snapshot: &SessionGraphRuntimeSnapshot,
        session_id: &str,
        revision: SessionGraphRevision,
        projection_registry: &ProjectionRegistry,
        transcript_projection_registry: &TranscriptProjectionRegistry,
        write_hint: &TranscriptRowsLedgerWriteHint,
    ) -> anyhow::Result<Option<PersistedTranscriptRowsMaterialization>> {
        let Some(changed_entry_ids) =
            changed_entry_ids_for_fast_path(projection_registry, session_id, write_hint)
        else {
            return Ok(None);
        };
        let Some(entry_slice) =
            transcript_projection_registry.entry_slice_for_session(session_id, &changed_entry_ids)
        else {
            return Ok(None);
        };
        if entry_slice.entries.len() != changed_entry_ids.len() {
            return Ok(None);
        }
        if entry_slice
            .entries
            .iter()
            .any(|entry| entry.entry.scope != TranscriptScope::Root)
        {
            return Ok(None);
        }
        let indexed_entry = entry_slice
            .entries
            .iter()
            .min_by_key(|entry| entry.index)
            .expect("entry slice length checked above");
        if indexed_entry.entry.entry_id.trim().is_empty() {
            return Ok(None);
        }

        let projection_snapshot = projection_registry.session_projection(session_id);
        let Some(session_snapshot) = projection_snapshot.session else {
            return Ok(None);
        };
        let operations = projection_snapshot.operations;
        let interactions = projection_snapshot.interactions;
        let effective_revision = SessionGraphRevision {
            graph_revision: if runtime_snapshot.graph_revision != 0 {
                runtime_snapshot.graph_revision
            } else {
                revision.graph_revision
            },
            transcript_revision: entry_slice.revision,
            last_event_seq: revision.last_event_seq,
        };

        let selected_activity = select_session_graph_activity(
            &runtime_snapshot.lifecycle,
            &session_snapshot.turn_state,
            &operations,
            &interactions,
            session_snapshot.active_turn_failure.as_ref(),
        );
        let activity = self.resolve_rows_activity(session_id, selected_activity, wall_clock_ms());
        let changed_entry_is_final =
            indexed_entry.index.saturating_add(1) == entry_slice.total_entry_count;
        if !changed_entry_is_final
            && non_tail_change_may_have_active_tail_ambiguity(
                &session_snapshot.turn_state,
                &activity,
            )
        {
            return Ok(None);
        }
        if changed_entry_is_final
            && last_entry_change_may_need_placeholder(
                &session_snapshot.turn_state,
                &activity,
                &indexed_entry.entry,
            )
        {
            return Ok(None);
        }
        let Some(suffix_slice) = transcript_projection_registry
            .entry_suffix_for_session(session_id, indexed_entry.index)
        else {
            return Ok(None);
        };
        if suffix_slice.entries.is_empty()
            || suffix_slice.revision != entry_slice.revision
            || suffix_slice.total_entry_count != entry_slice.total_entry_count
        {
            return Ok(None);
        }
        let Some(last_suffix_entry) = suffix_slice.entries.last() else {
            return Ok(None);
        };
        let active_streaming_tail = select_active_streaming_tail_for_known_last_entry(
            &session_snapshot.turn_state,
            &activity,
            &last_suffix_entry.entry,
        );
        let suffix_entries = suffix_slice
            .entries
            .iter()
            .map(|entry| entry.entry.clone())
            .collect::<Vec<_>>();
        let rows = project_transcript_viewport_entry_rows(
            &suffix_entries,
            &operations,
            &interactions,
            active_streaming_tail.as_ref(),
            activity.kind_started_at_ms,
        );
        if rows.len() != suffix_entries.len() {
            return Ok(None);
        }
        let rows = enrich_rows_with_operations(rows, &operations);
        let start_row_index = indexed_entry.index as i64;
        let serialized = serialize_viewport_rows_for_ledger_from_index(
            session_id,
            effective_revision.transcript_revision,
            effective_revision.graph_revision,
            TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
            start_row_index,
            &rows,
        )?;

        Ok(Some(PersistedTranscriptRowsMaterialization {
            projection_version: TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
            effective_revision,
            total_row_count: suffix_slice.total_entry_count as i64,
            start_row_index,
            replace_all: false,
            force_full_replace: false,
            session: session_snapshot,
            activity,
            active_streaming_tail,
            lifecycle: runtime_snapshot.lifecycle.clone(),
            capabilities: runtime_snapshot.capabilities.clone(),
            rows: serialized,
            scopes: Vec::new(),
        }))
    }

    fn materialize_rows_with_tail_limit(
        &self,
        runtime_snapshot: SessionGraphRuntimeSnapshot,
        session_id: &str,
        revision: SessionGraphRevision,
        projection_registry: &ProjectionRegistry,
        transcript_projection_registry: &TranscriptProjectionRegistry,
        tail_limit: Option<usize>,
    ) -> Result<TranscriptRowsMaterialization, VisibleTranscriptWindowMiss> {
        let transcript_snapshot = transcript_projection_registry
            .snapshot_for_session(session_id)
            .ok_or(VisibleTranscriptWindowMiss::SessionNotAttached)?;
        let projection_snapshot = projection_registry.session_projection(session_id);
        let session_snapshot = projection_snapshot
            .session
            .ok_or(VisibleTranscriptWindowMiss::SessionNotAttached)?;
        let effective_revision = SessionGraphRevision {
            graph_revision: if runtime_snapshot.graph_revision != 0 {
                runtime_snapshot.graph_revision
            } else {
                revision.graph_revision
            },
            transcript_revision: transcript_snapshot.revision,
            last_event_seq: revision.last_event_seq,
        };

        let operations = projection_snapshot.operations;
        let interactions = projection_snapshot.interactions;
        let selected_activity = select_session_graph_activity(
            &runtime_snapshot.lifecycle,
            &session_snapshot.turn_state,
            &operations,
            &interactions,
            session_snapshot.active_turn_failure.as_ref(),
        );
        let activity = self.resolve_rows_activity(session_id, selected_activity, wall_clock_ms());
        let active_streaming_tail = select_active_streaming_tail(
            &session_snapshot.turn_state,
            &activity,
            &transcript_snapshot,
        );
        let (viewport_transcript_snapshot, tail_limited) =
            tail_limited_transcript_snapshot(transcript_snapshot, tail_limit);
        let rows = project_transcript_viewport_rows(
            &viewport_transcript_snapshot,
            &operations,
            &interactions,
            active_streaming_tail.as_ref(),
            activity.kind_started_at_ms,
        );

        Ok(TranscriptRowsMaterialization {
            rows,
            operations,
            session: session_snapshot,
            activity,
            active_streaming_tail,
            lifecycle: runtime_snapshot.lifecycle,
            capabilities: runtime_snapshot.capabilities,
            effective_revision,
            tail_limited,
        })
    }

    pub(crate) fn finalize_rows_envelope(
        &self,
        session_id: &str,
        effective_revision: SessionGraphRevision,
        payload: SessionStatePayload,
        operations: &[OperationSnapshot],
        budget_label: &str,
    ) -> Result<SessionStateEnvelope, VisibleTranscriptWindowMiss> {
        let envelope = SessionStateEnvelope {
            session_id: session_id.to_string(),
            graph_revision: effective_revision.graph_revision,
            last_event_seq: effective_revision.last_event_seq,
            payload,
        };

        let budgeted_envelope = match session_state_envelope_byte_budget_status(&envelope) {
            Ok(_) => envelope,
            Err(status) => match envelope.payload {
                SessionStatePayload::ViewportBufferPush { push } => self
                    .finalize_shrunk_viewport_push(
                        session_id,
                        effective_revision,
                        push,
                        status.byte_len,
                        status.max_bytes,
                    )?,
                _ => {
                    tracing::warn!(
                        session_id,
                        kind = budget_label,
                        byte_len = status.byte_len,
                        max_bytes = status.max_bytes,
                        "transcript rows envelope exceeded byte budget; skipping"
                    );
                    return Err(VisibleTranscriptWindowMiss::BudgetExceeded);
                }
            },
        };

        let enriched_envelope = enrich_viewport_envelope_operations(budgeted_envelope, operations);
        match session_state_envelope_byte_budget_status(&enriched_envelope) {
            Ok(_) => Ok(enriched_envelope),
            Err(status) => match enriched_envelope.payload {
                SessionStatePayload::ViewportBufferPush { push } => self
                    .finalize_shrunk_viewport_push(
                        session_id,
                        effective_revision,
                        push,
                        status.byte_len,
                        status.max_bytes,
                    ),
                _ => {
                    tracing::warn!(
                        session_id,
                        kind = budget_label,
                        byte_len = status.byte_len,
                        max_bytes = status.max_bytes,
                        "enriched transcript rows envelope exceeded byte budget; skipping"
                    );
                    Err(VisibleTranscriptWindowMiss::BudgetExceeded)
                }
            },
        }
    }

    fn finalize_shrunk_viewport_push(
        &self,
        session_id: &str,
        effective_revision: SessionGraphRevision,
        mut push: ViewportBufferPush,
        original_byte_len: usize,
        max_bytes: usize,
    ) -> Result<SessionStateEnvelope, VisibleTranscriptWindowMiss> {
        let original_row_count = push.rows.len();
        if !push
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "viewport_buffer_rows_shrunk_for_budget")
        {
            push.diagnostics.push(ViewportBufferDiagnostic {
                code: "viewport_buffer_rows_shrunk_for_budget".to_string(),
                row_id: None,
            });
        }
        let Some(shrunk_rows) =
            largest_budgeted_row_suffix(session_id, effective_revision, &push, max_bytes)
        else {
            tracing::warn!(
                session_id,
                kind = "viewport_buffer_push",
                byte_len = original_byte_len,
                max_bytes,
                row_count = original_row_count,
                "transcript rows envelope exceeded byte budget and could not be shrunk"
            );
            return Err(VisibleTranscriptWindowMiss::BudgetExceeded);
        };

        let shrunk_row_count = shrunk_rows.len();
        if shrunk_row_count == 0 || shrunk_row_count == original_row_count {
            tracing::warn!(
                session_id,
                kind = "viewport_buffer_push",
                byte_len = original_byte_len,
                max_bytes,
                row_count = original_row_count,
                shrunk_row_count,
                "transcript rows envelope exceeded byte budget without a useful shrink"
            );
            return Err(VisibleTranscriptWindowMiss::BudgetExceeded);
        }

        push.rows = shrunk_rows;
        let envelope = SessionStateEnvelope {
            session_id: session_id.to_string(),
            graph_revision: effective_revision.graph_revision,
            last_event_seq: effective_revision.last_event_seq,
            payload: SessionStatePayload::ViewportBufferPush { push },
        };

        match session_state_envelope_byte_budget_status(&envelope) {
            Ok(_) => {
                tracing::warn!(
                    session_id,
                    kind = "viewport_buffer_push",
                    byte_len = original_byte_len,
                    max_bytes,
                    original_row_count,
                    shrunk_row_count,
                    "Shrunk transcript rows envelope to fit byte budget"
                );
                Ok(envelope)
            }
            Err(status) => {
                tracing::warn!(
                    session_id,
                    kind = "viewport_buffer_push",
                    byte_len = status.byte_len,
                    max_bytes = status.max_bytes,
                    original_row_count,
                    shrunk_row_count,
                    "shrunk transcript rows envelope still exceeded byte budget"
                );
                Err(VisibleTranscriptWindowMiss::BudgetExceeded)
            }
        }
    }

    fn resolve_rows_activity(
        &self,
        session_id: &str,
        selected: SessionGraphActivity,
        now_ms: u64,
    ) -> SessionGraphActivity {
        let mut store = self
            .activity_by_session
            .lock()
            .expect("activity_by_session mutex poisoned");
        let previous = store
            .get(session_id)
            .cloned()
            .unwrap_or_else(SessionGraphActivity::idle);
        let merged = merge_session_graph_activity_timing(&previous, selected, now_ms);
        store.insert(session_id.to_string(), merged.clone());
        merged
    }
}

fn first_changed_row_index(
    rows: &[TranscriptViewportRow],
    write_hint: &TranscriptRowsLedgerWriteHint,
) -> usize {
    if write_hint.force_full_replace
        || (write_hint.changed_source_entry_ids.is_empty()
            && write_hint.changed_tool_call_ids.is_empty()
            && write_hint.changed_interaction_ids.is_empty())
    {
        return 0;
    }

    rows.iter()
        .position(|row| {
            write_hint
                .changed_source_entry_ids
                .iter()
                .any(|entry_id| entry_id == &row.source_entry_id)
                || row.operation_links.iter().any(|link| {
                    write_hint
                        .changed_tool_call_ids
                        .iter()
                        .any(|tool_call_id| tool_call_id == &link.tool_call_id)
                })
                || row.interaction_links.iter().any(|link| {
                    write_hint
                        .changed_interaction_ids
                        .iter()
                        .any(|interaction_id| interaction_id == &link.interaction_id)
                })
        })
        .unwrap_or(rows.len())
}

fn changed_entry_ids_for_fast_path(
    projection_registry: &ProjectionRegistry,
    session_id: &str,
    write_hint: &TranscriptRowsLedgerWriteHint,
) -> Option<Vec<String>> {
    if write_hint.force_full_replace {
        return None;
    }

    let mut entry_ids = Vec::new();
    for entry_id in &write_hint.changed_source_entry_ids {
        push_unique_entry_id(&mut entry_ids, entry_id.clone());
    }
    for tool_call_id in &write_hint.changed_tool_call_ids {
        let operation = projection_registry.operation_for_tool_call(session_id, tool_call_id)?;
        if operation.session_id != session_id {
            return None;
        }
        let OperationSourceLink::TranscriptLinked { entry_id } = operation.source_link else {
            return None;
        };
        push_unique_entry_id(&mut entry_ids, entry_id);
    }
    for interaction_id in &write_hint.changed_interaction_ids {
        let interaction = projection_registry.interaction(interaction_id)?;
        if interaction.session_id != session_id {
            return None;
        }
        let operation_id = interaction.canonical_operation_id?;
        let operation = projection_registry.operation(&operation_id)?;
        if operation.session_id != session_id {
            return None;
        }
        let OperationSourceLink::TranscriptLinked { entry_id } = operation.source_link else {
            return None;
        };
        push_unique_entry_id(&mut entry_ids, entry_id);
    }

    if entry_ids.is_empty() {
        return None;
    }

    Some(entry_ids)
}

fn push_unique_entry_id(entry_ids: &mut Vec<String>, entry_id: String) {
    if entry_ids.iter().any(|candidate| candidate == &entry_id) {
        return;
    }
    entry_ids.push(entry_id);
}

fn last_entry_change_may_need_placeholder(
    turn_state: &SessionTurnState,
    activity: &SessionGraphActivity,
    entry: &TranscriptEntry,
) -> bool {
    matches!(turn_state, SessionTurnState::Running)
        && activity.kind == SessionGraphActivityKind::AwaitingModel
        && entry.role != TranscriptEntryRole::Assistant
}

fn non_tail_change_may_have_active_tail_ambiguity(
    turn_state: &SessionTurnState,
    activity: &SessionGraphActivity,
) -> bool {
    matches!(turn_state, SessionTurnState::Running)
        && activity.kind == SessionGraphActivityKind::AwaitingModel
}

fn enrich_viewport_envelope_operations(
    envelope: SessionStateEnvelope,
    operations: &[OperationSnapshot],
) -> SessionStateEnvelope {
    match envelope.payload {
        SessionStatePayload::ViewportBufferPush { mut push } => {
            push.rows = enrich_rows_with_operations(push.rows, operations);
            SessionStateEnvelope {
                session_id: envelope.session_id,
                graph_revision: envelope.graph_revision,
                last_event_seq: envelope.last_event_seq,
                payload: SessionStatePayload::ViewportBufferPush { push },
            }
        }
        SessionStatePayload::ViewportBufferDelta { mut delta } => {
            delta.prepended_rows = enrich_rows_with_operations(delta.prepended_rows, operations);
            delta.appended_rows = enrich_rows_with_operations(delta.appended_rows, operations);
            SessionStateEnvelope {
                session_id: envelope.session_id,
                graph_revision: envelope.graph_revision,
                last_event_seq: envelope.last_event_seq,
                payload: SessionStatePayload::ViewportBufferDelta { delta },
            }
        }
        payload => SessionStateEnvelope {
            session_id: envelope.session_id,
            graph_revision: envelope.graph_revision,
            last_event_seq: envelope.last_event_seq,
            payload,
        },
    }
}

fn enrich_rows_with_operations(
    mut rows: Vec<TranscriptViewportRow>,
    operations: &[OperationSnapshot],
) -> Vec<TranscriptViewportRow> {
    let operations_by_id = operations
        .iter()
        .map(|operation| (operation.id.as_str(), operation))
        .collect::<HashMap<_, _>>();

    for row in &mut rows {
        for link in &mut row.operation_links {
            let Some(operation) = operations_by_id.get(link.operation_id.as_str()) else {
                continue;
            };
            if link.display_facts.is_none() {
                link.display_facts =
                    crate::acp::transcript_viewport::TranscriptViewportOperationDisplayFacts::from_operation(
                        operation,
                        Vec::new(),
                    );
            }
            link.operation = Some(Box::new(
                crate::acp::session_wire_compaction::compact_operation_snapshot_for_ipc(
                    (*operation).clone(),
                ),
            ));
        }
    }

    rows
}

fn largest_budgeted_row_suffix(
    session_id: &str,
    effective_revision: SessionGraphRevision,
    push: &ViewportBufferPush,
    max_bytes: usize,
) -> Option<Vec<TranscriptViewportRow>> {
    let mut low = 0usize;
    let mut high = push.rows.len();
    let mut best: Option<Vec<TranscriptViewportRow>> = None;

    while low <= high {
        let candidate_count = low + (high - low) / 2;
        let candidate_rows = suffix_rows(&push.rows, candidate_count);
        let candidate_push = ViewportBufferPush {
            session_id: push.session_id.clone(),
            graph_revision: push.graph_revision,
            emission_seq: push.emission_seq,
            rows: candidate_rows,
            request_generation: push.request_generation,
            diagnostics: push.diagnostics.clone(),
        };
        let envelope = SessionStateEnvelope {
            session_id: session_id.to_string(),
            graph_revision: effective_revision.graph_revision,
            last_event_seq: effective_revision.last_event_seq,
            payload: SessionStatePayload::ViewportBufferPush {
                push: candidate_push,
            },
        };
        let fits = session_state_envelope_byte_budget_status(&envelope)
            .map(|status| status.byte_len <= max_bytes)
            .unwrap_or(false);

        if fits {
            let SessionStatePayload::ViewportBufferPush { push } = envelope.payload else {
                return None;
            };
            best = Some(push.rows);
            low = candidate_count.saturating_add(1);
        } else if candidate_count == 0 {
            break;
        } else {
            high = candidate_count.saturating_sub(1);
        }
    }

    best
}

fn suffix_rows(rows: &[TranscriptViewportRow], count: usize) -> Vec<TranscriptViewportRow> {
    if count == 0 {
        return Vec::new();
    }
    let start = rows.len().saturating_sub(count);
    rows[start..].to_vec()
}

fn tail_limited_transcript_snapshot(
    transcript_snapshot: crate::acp::transcript_projection::TranscriptSnapshot,
    tail_limit: Option<usize>,
) -> (crate::acp::transcript_projection::TranscriptSnapshot, bool) {
    let Some(tail_limit) = tail_limit else {
        return (transcript_snapshot, false);
    };
    if tail_limit == 0 || transcript_snapshot.entries.len() <= tail_limit {
        return (transcript_snapshot, false);
    }

    let start = transcript_snapshot.entries.len().saturating_sub(tail_limit);
    (
        crate::acp::transcript_projection::TranscriptSnapshot {
            revision: transcript_snapshot.revision,
            entries: transcript_snapshot.entries[start..].to_vec(),
        },
        true,
    )
}

impl Default for TranscriptRowsLedger {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use crate::acp::projections::{
        InteractionKind, InteractionPayload, InteractionSnapshot, InteractionState,
        OperationSnapshot, OperationSourceLink, OperationState, PlanApprovalSource,
        ProjectionRegistry, SessionProjectionSnapshot, SessionSnapshot, SessionTurnState,
    };
    use crate::acp::session_state_engine::protocol::{
        ViewportBufferDiagnostic, ViewportBufferPush,
    };
    use crate::acp::session_state_engine::runtime_registry::SessionGraphRuntimeSnapshot;
    use crate::acp::session_state_engine::selectors::{
        SessionGraphActivity, SessionGraphActivityKind, SessionGraphCapabilities,
        SessionGraphLifecycle,
    };
    use crate::acp::session_state_engine::{
        session_state_envelope_byte_budget_status, SessionGraphRevision, SessionStateEnvelope,
        SessionStatePayload,
    };
    use crate::acp::session_update::{ToolArguments, ToolCallStatus, ToolKind};
    use crate::acp::transcript_projection::{
        TranscriptEntry, TranscriptEntryRole, TranscriptProjectionRegistry, TranscriptSegment,
        TranscriptSnapshot,
    };
    use crate::acp::transcript_viewport::{
        TranscriptViewportOperationLink, TranscriptViewportRow, TranscriptViewportRowContent,
        TranscriptViewportRowKind,
    };
    use crate::acp::types::CanonicalAgentId;
    use serde_json::json;

    #[test]
    fn resolve_rows_activity_preserves_awaiting_anchor_across_reselection() {
        let ledger = super::TranscriptRowsLedger::new();
        let selected = SessionGraphActivity {
            kind: SessionGraphActivityKind::AwaitingModel,
            active_operation_count: 0,
            active_subagent_count: 0,
            dominant_operation_id: None,
            blocking_interaction_id: None,
            kind_started_at_ms: None,
        };
        let first = ledger.resolve_rows_activity("session-1", selected.clone(), 1_000);
        let second = ledger.resolve_rows_activity("session-1", selected, 9_000);
        assert_eq!(first.kind_started_at_ms, Some(1_000));
        assert_eq!(second.kind_started_at_ms, Some(1_000));
    }

    #[test]
    fn running_awaiting_model_materializes_only_canonical_transcript_rows() {
        let ledger = super::TranscriptRowsLedger::new();
        let session_id = "session-running-awaiting-model";
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        let mut session =
            SessionSnapshot::new(session_id.to_string(), Some(CanonicalAgentId::OpenCode));
        session.turn_state = SessionTurnState::Running;
        session.message_count = 1;
        session.transcript_entry_count = 1;
        projection_registry.restore_session_projection(SessionProjectionSnapshot {
            session: Some(session),
            operations: Vec::new(),
            interactions: Vec::new(),
            runtime: None,
        });
        transcript_projection_registry.restore_session_snapshot(
            session_id.to_string(),
            TranscriptSnapshot {
                revision: 7,
                entries: vec![transcript_entry(
                    "entry-1",
                    TranscriptEntryRole::User,
                    "prompt",
                )],
            },
        );

        let materialized = ledger
            .materialize_rows(
                SessionGraphRuntimeSnapshot {
                    graph_revision: 11,
                    lifecycle: SessionGraphLifecycle::ready(),
                    capabilities: SessionGraphCapabilities::empty(),
                },
                session_id,
                SessionGraphRevision::new(11, 7, 11),
                &projection_registry,
                &transcript_projection_registry,
            )
            .expect("canonical rows should materialize");

        assert_eq!(
            materialized.activity.kind,
            SessionGraphActivityKind::AwaitingModel
        );
        assert_eq!(materialized.rows.len(), 1);
        assert_eq!(materialized.rows[0].row_id, "transcript:root:entry-1");
        assert_eq!(materialized.rows[0].kind, TranscriptViewportRowKind::User);
    }

    #[test]
    fn shrunk_viewport_push_accounts_for_diagnostic_wire_overhead() {
        let ledger = super::TranscriptRowsLedger::new();
        let session_id = "session-budget-edge";
        let revision = SessionGraphRevision::new(7, 7, 7);
        let rows: Vec<TranscriptViewportRow> =
            (0..6).map(|index| viewport_row(index, 1_000)).collect();
        let push = viewport_push(session_id, rows, Vec::new());
        let diagnostic = ViewportBufferDiagnostic {
            code: "viewport_buffer_rows_shrunk_for_budget".to_string(),
            row_id: None,
        };
        let max_bytes = viewport_push_byte_len(
            session_id,
            revision,
            viewport_push(session_id, super::suffix_rows(&push.rows, 3), Vec::new()),
        );

        assert!(
            viewport_push_byte_len(
                session_id,
                revision,
                viewport_push(
                    session_id,
                    super::suffix_rows(&push.rows, 3),
                    vec![diagnostic.clone()],
                ),
            ) > max_bytes,
            "regression setup must make 3 rows overflow only after the diagnostic is included"
        );
        assert!(
            viewport_push_byte_len(
                session_id,
                revision,
                viewport_push(
                    session_id,
                    super::suffix_rows(&push.rows, 2),
                    vec![diagnostic],
                ),
            ) <= max_bytes,
            "regression setup must leave room for a smaller suffix plus the diagnostic"
        );

        let envelope = ledger
            .finalize_shrunk_viewport_push(
                session_id,
                revision,
                push,
                max_bytes.saturating_add(1),
                max_bytes,
            )
            .expect("shrinker should pick a smaller suffix that includes diagnostic overhead");

        session_state_envelope_byte_budget_status(&envelope)
            .expect("final viewport push must fit the real wire budget");
        let SessionStatePayload::ViewportBufferPush { push } = envelope.payload else {
            panic!("expected viewport buffer push");
        };
        assert_eq!(push.rows.len(), 2);
        assert!(push
            .diagnostics
            .iter()
            .any(|item| item.code == "viewport_buffer_rows_shrunk_for_budget"));
    }

    #[test]
    fn finalized_viewport_push_embeds_compact_operation_snapshots() {
        let ledger = super::TranscriptRowsLedger::new();
        let session_id = "session-embedded-operation";
        let revision = SessionGraphRevision::new(7, 7, 7);
        let operation = operation_snapshot(session_id, "entry-1", "operation-1", "tool-1");
        let mut row = viewport_row(1, 10);
        row.kind = TranscriptViewportRowKind::Tool;
        row.source_entry_id = "entry-1".to_string();
        row.operation_links = vec![TranscriptViewportOperationLink {
            operation_id: "operation-1".to_string(),
            tool_call_id: "tool-1".to_string(),
            name: "exec_command".to_string(),
            state: OperationState::Completed,
            display_facts: None,
            operation: None,
        }];
        let payload = SessionStatePayload::ViewportBufferPush {
            push: viewport_push(session_id, vec![row], Vec::new()),
        };

        let envelope = ledger
            .finalize_rows_envelope(session_id, revision, payload, &[operation], "test")
            .expect("viewport push should fit");
        let SessionStatePayload::ViewportBufferPush { push } = envelope.payload else {
            panic!("expected viewport push");
        };
        let embedded = push.rows[0].operation_links[0]
            .operation
            .as_ref()
            .expect("emitted viewport row should carry compact operation data");
        let display_facts = push.rows[0].operation_links[0]
            .display_facts
            .as_ref()
            .expect("emitted viewport row should carry compact operation display facts");

        assert_eq!(embedded.command.as_deref(), Some("bun test"));
        assert_eq!(display_facts.title, "Run");
        assert_eq!(display_facts.command_summary.as_deref(), Some("bun test"));
        assert_eq!(
            embedded.arguments,
            ToolArguments::Execute {
                command: Some("bun test".to_string())
            }
        );
        assert!(
            serde_json::to_vec(embedded)
                .expect("embedded operation serializes")
                .len()
                < 32_000
        );
    }

    #[test]
    fn materialized_persisted_rows_embed_compact_operation_snapshots() {
        let ledger = super::TranscriptRowsLedger::new();
        let session_id = "session-persisted-operation";
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        let operation = operation_snapshot(session_id, "entry-1", "operation-1", "tool-1");
        let mut session =
            SessionSnapshot::new(session_id.to_string(), Some(CanonicalAgentId::ClaudeCode));
        session.message_count = 1;
        session.transcript_entry_count = 1;
        projection_registry.restore_session_projection(SessionProjectionSnapshot {
            session: Some(session),
            operations: vec![operation],
            interactions: Vec::new(),
            runtime: None,
        });
        transcript_projection_registry.restore_session_snapshot(
            session_id.to_string(),
            TranscriptSnapshot {
                revision: 7,
                entries: vec![TranscriptEntry {
                    scope: crate::acp::transcript_projection::TranscriptScope::Root,
                    entry_id: "entry-1".to_string(),
                    role: TranscriptEntryRole::Tool,
                    segments: vec![TranscriptSegment::Text {
                        segment_id: "entry-1:tool".to_string(),
                        text: "exec_command".to_string(),
                    }],
                    attempt_id: None,
                    timestamp_ms: None,
                }],
            },
        );

        let materialized = ledger
            .materialize_persisted_rows(
                crate::acp::session_state_engine::runtime_registry::SessionGraphRuntimeSnapshot::default(),
                session_id,
                SessionGraphRevision::new(11, 7, 11),
                &projection_registry,
                &transcript_projection_registry,
                &super::TranscriptRowsLedgerWriteHint::full_replace(),
            )
            .expect("persistent rows should materialize")
            .expect("session should be attached");

        assert_eq!(materialized.effective_revision.graph_revision, 11);
        assert_eq!(materialized.effective_revision.transcript_revision, 7);
        assert_eq!(materialized.rows.len(), 1);
        assert_eq!(materialized.rows[0].row_id, "transcript:root:entry-1");
        let row_json: serde_json::Value =
            serde_json::from_str(&materialized.rows[0].row_json).expect("row json should parse");
        assert_eq!(row_json["operationLinks"][0]["operationId"], "operation-1");
        assert_eq!(
            row_json["operationLinks"][0]["displayFacts"]["title"],
            "Run"
        );
        assert_eq!(
            row_json["operationLinks"][0]["displayFacts"]["commandSummary"],
            "bun test"
        );
        assert_eq!(
            row_json["operationLinks"][0]["operation"]["command"],
            "bun test"
        );
    }

    #[test]
    fn last_changed_entry_persisted_rows_materializes_single_row_suffix() {
        let ledger = super::TranscriptRowsLedger::new();
        let session_id = "session-last-row-suffix";
        let runtime_snapshot = SessionGraphRuntimeSnapshot::default();
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        let mut session =
            SessionSnapshot::new(session_id.to_string(), Some(CanonicalAgentId::ClaudeCode));
        session.message_count = 3;
        session.transcript_entry_count = 3;
        projection_registry.restore_session_projection(SessionProjectionSnapshot {
            session: Some(session),
            operations: Vec::new(),
            interactions: Vec::new(),
            runtime: None,
        });
        transcript_projection_registry.restore_session_snapshot(
            session_id.to_string(),
            TranscriptSnapshot {
                revision: 7,
                entries: vec![
                    transcript_entry("entry-0", TranscriptEntryRole::User, "first"),
                    transcript_entry("entry-1", TranscriptEntryRole::Assistant, "second"),
                    transcript_entry("entry-2", TranscriptEntryRole::Assistant, "third"),
                ],
            },
        );
        let hint = super::TranscriptRowsLedgerWriteHint {
            force_full_replace: false,
            changed_source_entry_ids: vec!["entry-2".to_string()],
            changed_tool_call_ids: Vec::new(),
            changed_interaction_ids: Vec::new(),
        };

        let fast = ledger
            .materialize_changed_entry_suffix_persisted_rows(
                &runtime_snapshot,
                session_id,
                SessionGraphRevision::new(11, 7, 11),
                &projection_registry,
                &transcript_projection_registry,
                &hint,
            )
            .expect("last-row fast materialization should not error")
            .expect("last-row fast materialization should apply");
        let full = ledger
            .materialize_persisted_rows(
                runtime_snapshot,
                session_id,
                SessionGraphRevision::new(11, 7, 11),
                &projection_registry,
                &transcript_projection_registry,
                &super::TranscriptRowsLedgerWriteHint::full_replace(),
            )
            .expect("full persistent rows should materialize")
            .expect("session should be attached");

        assert_eq!(fast.total_row_count, 3);
        assert_eq!(fast.start_row_index, 2);
        assert!(!fast.replace_all);
        assert_eq!(fast.rows.len(), 1);
        assert_eq!(fast.rows[0].row_index, 2);
        assert_eq!(fast.rows[0].row_id, "transcript:root:entry-2");
        assert_eq!(fast.rows[0].row_json, full.rows[2].row_json);
    }

    #[test]
    fn middle_changed_entry_persisted_rows_materializes_suffix_from_changed_row() {
        let ledger = super::TranscriptRowsLedger::new();
        let session_id = "session-middle-row-suffix";
        let runtime_snapshot = SessionGraphRuntimeSnapshot::default();
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        let mut session =
            SessionSnapshot::new(session_id.to_string(), Some(CanonicalAgentId::ClaudeCode));
        session.message_count = 4;
        session.transcript_entry_count = 4;
        projection_registry.restore_session_projection(SessionProjectionSnapshot {
            session: Some(session),
            operations: Vec::new(),
            interactions: Vec::new(),
            runtime: None,
        });
        transcript_projection_registry.restore_session_snapshot(
            session_id.to_string(),
            TranscriptSnapshot {
                revision: 7,
                entries: vec![
                    transcript_entry("entry-0", TranscriptEntryRole::User, "first"),
                    transcript_entry("entry-1", TranscriptEntryRole::Assistant, "second"),
                    transcript_entry("entry-2", TranscriptEntryRole::Tool, "third"),
                    transcript_entry("entry-3", TranscriptEntryRole::Assistant, "fourth"),
                ],
            },
        );
        let hint = super::TranscriptRowsLedgerWriteHint {
            force_full_replace: false,
            changed_source_entry_ids: vec!["entry-1".to_string()],
            changed_tool_call_ids: Vec::new(),
            changed_interaction_ids: Vec::new(),
        };

        let fast = ledger
            .materialize_changed_entry_suffix_persisted_rows(
                &runtime_snapshot,
                session_id,
                SessionGraphRevision::new(11, 7, 11),
                &projection_registry,
                &transcript_projection_registry,
                &hint,
            )
            .expect("middle-row fast materialization should not error")
            .expect("middle-row fast materialization should apply");
        let full = ledger
            .materialize_persisted_rows(
                runtime_snapshot,
                session_id,
                SessionGraphRevision::new(11, 7, 11),
                &projection_registry,
                &transcript_projection_registry,
                &super::TranscriptRowsLedgerWriteHint::full_replace(),
            )
            .expect("full persistent rows should materialize")
            .expect("session should be attached");

        assert_eq!(fast.total_row_count, 4);
        assert_eq!(fast.start_row_index, 1);
        assert!(!fast.replace_all);
        assert_eq!(fast.rows.len(), 3);
        assert_eq!(fast.rows[0].row_index, 1);
        assert_eq!(fast.rows[0].row_id, "transcript:root:entry-1");
        assert_eq!(fast.rows[2].row_index, 3);
        assert_eq!(fast.rows[2].row_id, "transcript:root:entry-3");
        assert_eq!(fast.rows[0].row_json, full.rows[1].row_json);
        assert_eq!(fast.rows[2].row_json, full.rows[3].row_json);
    }

    #[test]
    fn middle_changed_tool_call_persisted_rows_materializes_suffix_from_linked_row() {
        let ledger = super::TranscriptRowsLedger::new();
        let session_id = "session-middle-tool-suffix";
        let runtime_snapshot = SessionGraphRuntimeSnapshot::default();
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        let operation = operation_snapshot(session_id, "entry-1", "operation-1", "tool-1");
        let mut session =
            SessionSnapshot::new(session_id.to_string(), Some(CanonicalAgentId::ClaudeCode));
        session.message_count = 4;
        session.transcript_entry_count = 4;
        projection_registry.restore_session_projection(SessionProjectionSnapshot {
            session: Some(session),
            operations: vec![operation],
            interactions: Vec::new(),
            runtime: None,
        });
        transcript_projection_registry.restore_session_snapshot(
            session_id.to_string(),
            TranscriptSnapshot {
                revision: 7,
                entries: vec![
                    transcript_entry("entry-0", TranscriptEntryRole::User, "first"),
                    transcript_entry("entry-1", TranscriptEntryRole::Tool, "exec_command"),
                    transcript_entry("entry-2", TranscriptEntryRole::Assistant, "third"),
                    transcript_entry("entry-3", TranscriptEntryRole::Assistant, "fourth"),
                ],
            },
        );
        let hint = super::TranscriptRowsLedgerWriteHint {
            force_full_replace: false,
            changed_source_entry_ids: Vec::new(),
            changed_tool_call_ids: vec!["tool-1".to_string()],
            changed_interaction_ids: Vec::new(),
        };

        let fast = ledger
            .materialize_changed_entry_suffix_persisted_rows(
                &runtime_snapshot,
                session_id,
                SessionGraphRevision::new(11, 7, 11),
                &projection_registry,
                &transcript_projection_registry,
                &hint,
            )
            .expect("middle-tool fast materialization should not error")
            .expect("middle-tool fast materialization should apply");

        assert_eq!(fast.total_row_count, 4);
        assert_eq!(fast.start_row_index, 1);
        assert!(!fast.replace_all);
        assert_eq!(fast.rows.len(), 3);
        assert_eq!(fast.rows[0].row_id, "transcript:root:entry-1");
        assert_eq!(fast.rows[2].row_id, "transcript:root:entry-3");
    }

    #[test]
    fn middle_changed_interaction_persisted_rows_materializes_suffix_from_linked_row() {
        let ledger = super::TranscriptRowsLedger::new();
        let session_id = "session-middle-interaction-suffix";
        let runtime_snapshot = SessionGraphRuntimeSnapshot::default();
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        let operation = operation_snapshot(session_id, "entry-1", "operation-1", "tool-1");
        let interaction = interaction_snapshot(session_id, "interaction-1", "operation-1");
        let mut session =
            SessionSnapshot::new(session_id.to_string(), Some(CanonicalAgentId::ClaudeCode));
        session.message_count = 4;
        session.transcript_entry_count = 4;
        projection_registry.restore_session_projection(SessionProjectionSnapshot {
            session: Some(session),
            operations: vec![operation],
            interactions: vec![interaction],
            runtime: None,
        });
        transcript_projection_registry.restore_session_snapshot(
            session_id.to_string(),
            TranscriptSnapshot {
                revision: 7,
                entries: vec![
                    transcript_entry("entry-0", TranscriptEntryRole::User, "first"),
                    transcript_entry("entry-1", TranscriptEntryRole::Tool, "exec_command"),
                    transcript_entry("entry-2", TranscriptEntryRole::Assistant, "third"),
                    transcript_entry("entry-3", TranscriptEntryRole::Assistant, "fourth"),
                ],
            },
        );
        let hint = super::TranscriptRowsLedgerWriteHint {
            force_full_replace: false,
            changed_source_entry_ids: Vec::new(),
            changed_tool_call_ids: Vec::new(),
            changed_interaction_ids: vec!["interaction-1".to_string()],
        };

        let fast = ledger
            .materialize_changed_entry_suffix_persisted_rows(
                &runtime_snapshot,
                session_id,
                SessionGraphRevision::new(11, 7, 11),
                &projection_registry,
                &transcript_projection_registry,
                &hint,
            )
            .expect("middle-interaction fast materialization should not error")
            .expect("middle-interaction fast materialization should apply");

        assert_eq!(fast.total_row_count, 4);
        assert_eq!(fast.start_row_index, 1);
        assert!(!fast.replace_all);
        assert_eq!(fast.rows.len(), 3);
        assert_eq!(fast.rows[0].row_id, "transcript:root:entry-1");
        assert_eq!(fast.rows[2].row_id, "transcript:root:entry-3");
    }

    #[test]
    fn multiple_changed_source_entries_materialize_suffix_from_earliest_changed_row() {
        let ledger = super::TranscriptRowsLedger::new();
        let session_id = "session-multiple-source-suffix";
        let runtime_snapshot = SessionGraphRuntimeSnapshot::default();
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        let mut session =
            SessionSnapshot::new(session_id.to_string(), Some(CanonicalAgentId::ClaudeCode));
        session.message_count = 5;
        session.transcript_entry_count = 5;
        projection_registry.restore_session_projection(SessionProjectionSnapshot {
            session: Some(session),
            operations: Vec::new(),
            interactions: Vec::new(),
            runtime: None,
        });
        transcript_projection_registry.restore_session_snapshot(
            session_id.to_string(),
            TranscriptSnapshot {
                revision: 7,
                entries: vec![
                    transcript_entry("entry-0", TranscriptEntryRole::User, "first"),
                    transcript_entry("entry-1", TranscriptEntryRole::Assistant, "second"),
                    transcript_entry("entry-2", TranscriptEntryRole::Tool, "third"),
                    transcript_entry("entry-3", TranscriptEntryRole::Assistant, "fourth"),
                    transcript_entry("entry-4", TranscriptEntryRole::Assistant, "fifth"),
                ],
            },
        );
        let hint = super::TranscriptRowsLedgerWriteHint {
            force_full_replace: false,
            changed_source_entry_ids: vec!["entry-3".to_string(), "entry-1".to_string()],
            changed_tool_call_ids: Vec::new(),
            changed_interaction_ids: Vec::new(),
        };

        let fast = ledger
            .materialize_changed_entry_suffix_persisted_rows(
                &runtime_snapshot,
                session_id,
                SessionGraphRevision::new(11, 7, 11),
                &projection_registry,
                &transcript_projection_registry,
                &hint,
            )
            .expect("multi-source fast materialization should not error")
            .expect("multi-source fast materialization should apply");

        assert_eq!(fast.total_row_count, 5);
        assert_eq!(fast.start_row_index, 1);
        assert!(!fast.replace_all);
        assert_eq!(fast.rows.len(), 4);
        assert_eq!(fast.rows[0].row_id, "transcript:root:entry-1");
        assert_eq!(fast.rows[3].row_id, "transcript:root:entry-4");
    }

    #[test]
    fn mixed_changed_hints_materialize_suffix_from_earliest_linked_row() {
        let ledger = super::TranscriptRowsLedger::new();
        let session_id = "session-mixed-hint-suffix";
        let runtime_snapshot = SessionGraphRuntimeSnapshot::default();
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        let interaction_operation =
            operation_snapshot(session_id, "entry-1", "operation-1", "tool-1");
        let tool_operation = operation_snapshot(session_id, "entry-2", "operation-2", "tool-2");
        let interaction = interaction_snapshot(session_id, "interaction-1", "operation-1");
        let mut session =
            SessionSnapshot::new(session_id.to_string(), Some(CanonicalAgentId::ClaudeCode));
        session.message_count = 5;
        session.transcript_entry_count = 5;
        projection_registry.restore_session_projection(SessionProjectionSnapshot {
            session: Some(session),
            operations: vec![interaction_operation, tool_operation],
            interactions: vec![interaction],
            runtime: None,
        });
        transcript_projection_registry.restore_session_snapshot(
            session_id.to_string(),
            TranscriptSnapshot {
                revision: 7,
                entries: vec![
                    transcript_entry("entry-0", TranscriptEntryRole::User, "first"),
                    transcript_entry("entry-1", TranscriptEntryRole::Tool, "approval"),
                    transcript_entry("entry-2", TranscriptEntryRole::Tool, "exec_command"),
                    transcript_entry("entry-3", TranscriptEntryRole::Assistant, "fourth"),
                    transcript_entry("entry-4", TranscriptEntryRole::Assistant, "fifth"),
                ],
            },
        );
        let hint = super::TranscriptRowsLedgerWriteHint {
            force_full_replace: false,
            changed_source_entry_ids: vec!["entry-3".to_string()],
            changed_tool_call_ids: vec!["tool-2".to_string()],
            changed_interaction_ids: vec!["interaction-1".to_string()],
        };

        let fast = ledger
            .materialize_changed_entry_suffix_persisted_rows(
                &runtime_snapshot,
                session_id,
                SessionGraphRevision::new(11, 7, 11),
                &projection_registry,
                &transcript_projection_registry,
                &hint,
            )
            .expect("mixed-hint fast materialization should not error")
            .expect("mixed-hint fast materialization should apply");
        let full = ledger
            .materialize_persisted_rows(
                runtime_snapshot,
                session_id,
                SessionGraphRevision::new(11, 7, 11),
                &projection_registry,
                &transcript_projection_registry,
                &super::TranscriptRowsLedgerWriteHint::full_replace(),
            )
            .expect("full persistent rows should materialize")
            .expect("session should be attached");

        assert_eq!(fast.total_row_count, 5);
        assert_eq!(fast.start_row_index, 1);
        assert!(!fast.replace_all);
        assert_eq!(fast.rows.len(), 4);
        assert_eq!(fast.rows[0].row_id, "transcript:root:entry-1");
        assert_eq!(fast.rows[3].row_id, "transcript:root:entry-4");
        assert_suffix_rows_match_full_materialization(&fast, &full);
    }

    #[test]
    fn operation_scoped_changed_entry_skips_root_suffix_fast_path() {
        let ledger = super::TranscriptRowsLedger::new();
        let session_id = "session-operation-scope-suffix";
        let runtime_snapshot = SessionGraphRuntimeSnapshot::default();
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        let mut session =
            SessionSnapshot::new(session_id.to_string(), Some(CanonicalAgentId::ClaudeCode));
        session.message_count = 1;
        session.transcript_entry_count = 1;
        projection_registry.restore_session_projection(SessionProjectionSnapshot {
            session: Some(session),
            operations: Vec::new(),
            interactions: Vec::new(),
            runtime: None,
        });
        transcript_projection_registry.restore_session_snapshot(
            session_id.to_string(),
            TranscriptSnapshot {
                revision: 7,
                entries: vec![operation_transcript_entry(
                    "operation-1",
                    "entry-child",
                    TranscriptEntryRole::Assistant,
                    "child report",
                )],
            },
        );
        let hint = super::TranscriptRowsLedgerWriteHint {
            force_full_replace: false,
            changed_source_entry_ids: vec!["entry-child".to_string()],
            changed_tool_call_ids: Vec::new(),
            changed_interaction_ids: Vec::new(),
        };

        let fast = ledger
            .materialize_changed_entry_suffix_persisted_rows(
                &runtime_snapshot,
                session_id,
                SessionGraphRevision::new(11, 7, 11),
                &projection_registry,
                &transcript_projection_registry,
                &hint,
            )
            .expect("operation-scoped fast-path check should not error");

        assert!(
            fast.is_none(),
            "operation-scoped transcript entries must use full scoped ledger materialization"
        );
    }

    #[test]
    fn last_changed_tool_call_persisted_rows_materializes_single_row_suffix() {
        let ledger = super::TranscriptRowsLedger::new();
        let session_id = "session-last-tool-suffix";
        let runtime_snapshot = SessionGraphRuntimeSnapshot::default();
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        let operation = operation_snapshot(session_id, "entry-2", "operation-2", "tool-2");
        let mut session =
            SessionSnapshot::new(session_id.to_string(), Some(CanonicalAgentId::ClaudeCode));
        session.message_count = 3;
        session.transcript_entry_count = 3;
        projection_registry.restore_session_projection(SessionProjectionSnapshot {
            session: Some(session),
            operations: vec![operation],
            interactions: Vec::new(),
            runtime: None,
        });
        transcript_projection_registry.restore_session_snapshot(
            session_id.to_string(),
            TranscriptSnapshot {
                revision: 7,
                entries: vec![
                    transcript_entry("entry-0", TranscriptEntryRole::User, "first"),
                    transcript_entry("entry-1", TranscriptEntryRole::Assistant, "second"),
                    transcript_entry("entry-2", TranscriptEntryRole::Tool, "exec_command"),
                ],
            },
        );
        let hint = super::TranscriptRowsLedgerWriteHint {
            force_full_replace: false,
            changed_source_entry_ids: Vec::new(),
            changed_tool_call_ids: vec!["tool-2".to_string()],
            changed_interaction_ids: Vec::new(),
        };

        let fast = ledger
            .materialize_changed_entry_suffix_persisted_rows(
                &runtime_snapshot,
                session_id,
                SessionGraphRevision::new(11, 7, 11),
                &projection_registry,
                &transcript_projection_registry,
                &hint,
            )
            .expect("last-tool fast materialization should not error")
            .expect("last-tool fast materialization should apply");

        assert_eq!(fast.total_row_count, 3);
        assert_eq!(fast.start_row_index, 2);
        assert!(!fast.replace_all);
        assert_eq!(fast.rows.len(), 1);
        assert_eq!(fast.rows[0].row_index, 2);
        assert_eq!(fast.rows[0].row_id, "transcript:root:entry-2");
    }

    #[test]
    fn last_changed_interaction_persisted_rows_materializes_single_row_suffix() {
        let ledger = super::TranscriptRowsLedger::new();
        let session_id = "session-last-interaction-suffix";
        let runtime_snapshot = SessionGraphRuntimeSnapshot::default();
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        let operation = operation_snapshot(session_id, "entry-2", "operation-2", "tool-2");
        let interaction = interaction_snapshot(session_id, "interaction-2", "operation-2");
        let mut session =
            SessionSnapshot::new(session_id.to_string(), Some(CanonicalAgentId::ClaudeCode));
        session.message_count = 3;
        session.transcript_entry_count = 3;
        projection_registry.restore_session_projection(SessionProjectionSnapshot {
            session: Some(session),
            operations: vec![operation],
            interactions: vec![interaction],
            runtime: None,
        });
        transcript_projection_registry.restore_session_snapshot(
            session_id.to_string(),
            TranscriptSnapshot {
                revision: 7,
                entries: vec![
                    transcript_entry("entry-0", TranscriptEntryRole::User, "first"),
                    transcript_entry("entry-1", TranscriptEntryRole::Assistant, "second"),
                    transcript_entry("entry-2", TranscriptEntryRole::Tool, "exec_command"),
                ],
            },
        );
        let hint = super::TranscriptRowsLedgerWriteHint {
            force_full_replace: false,
            changed_source_entry_ids: Vec::new(),
            changed_tool_call_ids: Vec::new(),
            changed_interaction_ids: vec!["interaction-2".to_string()],
        };

        let fast = ledger
            .materialize_changed_entry_suffix_persisted_rows(
                &runtime_snapshot,
                session_id,
                SessionGraphRevision::new(11, 7, 11),
                &projection_registry,
                &transcript_projection_registry,
                &hint,
            )
            .expect("last-interaction fast materialization should not error")
            .expect("last-interaction fast materialization should apply");

        assert_eq!(fast.total_row_count, 3);
        assert_eq!(fast.start_row_index, 2);
        assert!(!fast.replace_all);
        assert_eq!(fast.rows.len(), 1);
        assert_eq!(fast.rows[0].row_index, 2);
        assert_eq!(fast.rows[0].row_id, "transcript:root:entry-2");
    }

    #[test]
    fn changed_interaction_with_foreign_operation_falls_back_to_full_materialization() {
        let ledger = super::TranscriptRowsLedger::new();
        let session_id = "session-foreign-interaction-suffix";
        let foreign_session_id = "session-foreign-operation";
        let runtime_snapshot = SessionGraphRuntimeSnapshot::default();
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        let foreign_operation = operation_snapshot(
            foreign_session_id,
            "entry-2",
            "foreign-operation",
            "foreign-tool",
        );
        projection_registry.restore_session_projection(SessionProjectionSnapshot {
            session: Some(SessionSnapshot::new(
                foreign_session_id.to_string(),
                Some(CanonicalAgentId::ClaudeCode),
            )),
            operations: vec![foreign_operation],
            interactions: Vec::new(),
            runtime: None,
        });

        let mut session =
            SessionSnapshot::new(session_id.to_string(), Some(CanonicalAgentId::ClaudeCode));
        session.message_count = 3;
        session.transcript_entry_count = 3;
        projection_registry.restore_session_projection(SessionProjectionSnapshot {
            session: Some(session),
            operations: Vec::new(),
            interactions: vec![interaction_snapshot(
                session_id,
                "interaction-2",
                "foreign-operation",
            )],
            runtime: None,
        });
        transcript_projection_registry.restore_session_snapshot(
            session_id.to_string(),
            TranscriptSnapshot {
                revision: 7,
                entries: vec![
                    transcript_entry("entry-0", TranscriptEntryRole::User, "first"),
                    transcript_entry("entry-1", TranscriptEntryRole::Assistant, "second"),
                    transcript_entry("entry-2", TranscriptEntryRole::Tool, "exec_command"),
                ],
            },
        );
        let hint = super::TranscriptRowsLedgerWriteHint {
            force_full_replace: false,
            changed_source_entry_ids: Vec::new(),
            changed_tool_call_ids: Vec::new(),
            changed_interaction_ids: vec!["interaction-2".to_string()],
        };

        let fast = ledger
            .materialize_changed_entry_suffix_persisted_rows(
                &runtime_snapshot,
                session_id,
                SessionGraphRevision::new(11, 7, 11),
                &projection_registry,
                &transcript_projection_registry,
                &hint,
            )
            .expect("foreign-operation guard should not error");

        assert!(
            fast.is_none(),
            "an interaction linked to another session's operation must not select this session's row suffix"
        );
    }

    #[test]
    fn write_hint_selects_first_changed_source_entry_suffix() {
        let rows = vec![
            viewport_row(0, 10),
            viewport_row(1, 10),
            viewport_row(2, 10),
        ];
        let hint = super::TranscriptRowsLedgerWriteHint {
            force_full_replace: false,
            changed_source_entry_ids: vec!["entry-2".to_string()],
            changed_tool_call_ids: Vec::new(),
            changed_interaction_ids: Vec::new(),
        };

        assert_eq!(super::first_changed_row_index(&rows, &hint), 2);
    }

    fn viewport_push(
        session_id: &str,
        rows: Vec<TranscriptViewportRow>,
        diagnostics: Vec<ViewportBufferDiagnostic>,
    ) -> ViewportBufferPush {
        ViewportBufferPush {
            session_id: session_id.to_string(),
            graph_revision: SessionGraphRevision::new(7, 7, 7),
            emission_seq: 1,
            rows,
            request_generation: Some(1),
            diagnostics,
        }
    }

    fn viewport_push_byte_len(
        session_id: &str,
        revision: SessionGraphRevision,
        push: ViewportBufferPush,
    ) -> usize {
        serde_json::to_vec(&SessionStateEnvelope {
            session_id: session_id.to_string(),
            graph_revision: revision.graph_revision,
            last_event_seq: revision.last_event_seq,
            payload: SessionStatePayload::ViewportBufferPush { push },
        })
        .expect("viewport push should serialize")
        .len()
    }

    fn assert_suffix_rows_match_full_materialization(
        fast: &super::PersistedTranscriptRowsMaterialization,
        full: &super::PersistedTranscriptRowsMaterialization,
    ) {
        assert_eq!(fast.total_row_count, full.total_row_count);
        for row in &fast.rows {
            let expected = full
                .rows
                .get(row.row_index as usize)
                .expect("fast suffix row index should exist in full materialization");
            assert_eq!(row.row_id, expected.row_id);
            assert_eq!(row.source_entry_id, expected.source_entry_id);
            assert_eq!(row.row_kind, expected.row_kind);
            assert_eq!(row.row_version, expected.row_version);
            assert_eq!(row.row_json, expected.row_json);
        }
    }

    fn operation_snapshot(
        session_id: &str,
        entry_id: &str,
        operation_id: &str,
        tool_call_id: &str,
    ) -> OperationSnapshot {
        OperationSnapshot {
            id: operation_id.to_string(),
            session_id: session_id.to_string(),
            tool_call_id: tool_call_id.to_string(),
            name: "exec_command".to_string(),
            kind: Some(ToolKind::Execute),
            provider_status: ToolCallStatus::Completed,
            title: Some("exec_command".to_string()),
            arguments: ToolArguments::Execute {
                command: Some("bun test".to_string()),
            },
            progressive_arguments: None,
            result: Some(json!({
                "output": "x".repeat(10_000)
            })),
            computer_payload: None,
            command: Some("bun test".to_string()),
            normalized_todos: None,
            parent_tool_call_id: None,
            parent_operation_id: None,
            child_tool_call_ids: Vec::new(),
            child_operation_ids: Vec::new(),
            operation_provenance_key: Some(tool_call_id.to_string()),
            operation_state: OperationState::Completed,
            locations: None,
            skill_meta: None,
            normalized_questions: None,
            question_answer: None,
            awaiting_plan_approval: false,
            plan_approval_request_id: None,
            started_at_ms: None,
            completed_at_ms: None,
            source_link: OperationSourceLink::TranscriptLinked {
                entry_id: entry_id.to_string(),
            },
            degradation_reason: None,
        }
    }

    fn interaction_snapshot(
        session_id: &str,
        interaction_id: &str,
        operation_id: &str,
    ) -> InteractionSnapshot {
        InteractionSnapshot {
            id: interaction_id.to_string(),
            session_id: session_id.to_string(),
            kind: InteractionKind::PlanApproval,
            state: InteractionState::Pending,
            json_rpc_request_id: None,
            reply_handler: None,
            tool_reference: None,
            responded_at_event_seq: None,
            response: None,
            payload: InteractionPayload::PlanApproval {
                source: PlanApprovalSource::CreatePlan,
            },
            canonical_operation_id: Some(operation_id.to_string()),
        }
    }

    fn transcript_entry(entry_id: &str, role: TranscriptEntryRole, text: &str) -> TranscriptEntry {
        TranscriptEntry {
            scope: crate::acp::transcript_projection::TranscriptScope::Root,
            entry_id: entry_id.to_string(),
            role,
            segments: vec![TranscriptSegment::Text {
                segment_id: format!("{entry_id}:text:0"),
                text: text.to_string(),
            }],
            attempt_id: None,
            timestamp_ms: None,
        }
    }

    fn operation_transcript_entry(
        operation_id: &str,
        entry_id: &str,
        role: TranscriptEntryRole,
        text: &str,
    ) -> TranscriptEntry {
        TranscriptEntry {
            scope: crate::acp::transcript_projection::TranscriptScope::Operation(
                operation_id.to_string(),
            ),
            entry_id: entry_id.to_string(),
            role,
            segments: vec![TranscriptSegment::Text {
                segment_id: format!("{entry_id}:text:0"),
                text: text.to_string(),
            }],
            attempt_id: None,
            timestamp_ms: None,
        }
    }

    fn viewport_row(index: usize, text_len: usize) -> TranscriptViewportRow {
        TranscriptViewportRow {
            row_id: format!("row-{index}"),
            source_entry_id: format!("entry-{index}"),
            scope: crate::acp::transcript_projection::TranscriptScope::Root,
            kind: TranscriptViewportRowKind::AssistantText,
            version: format!("v-{index}"),
            anchor_eligible: true,
            active_streaming_tail: None,
            operation_links: Vec::new(),
            interaction_links: Vec::new(),
            content: TranscriptViewportRowContent::Transcript {
                role: TranscriptEntryRole::Assistant,
                segments: vec![TranscriptSegment::Text {
                    segment_id: format!("entry-{index}:segment-0"),
                    text: "x".repeat(text_len),
                }],
            },
            duration_started_at_ms: None,
            timestamp_ms: None,
        }
    }
}
