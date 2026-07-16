use crate::acp::projections::ProjectionRegistry;
use crate::acp::session_state_engine::protocol::{
    ViewportBufferDelta, ViewportBufferDiagnostic, ViewportBufferPush,
};
use crate::acp::session_state_engine::runtime_registry::{
    SessionGraphRuntimeSnapshot, VisibleTranscriptWindowMiss,
};
use crate::acp::session_state_engine::transcript_rows_ledger::TranscriptRowsLedger;
use crate::acp::session_state_engine::viewport_buffer_producer::{
    compute_rows_delta, decide_buffer_emission, prior_from_budget_shrunk_tail_rows,
    prior_from_rows, BufferEmission, PriorBufferEmission,
};
use crate::acp::session_state_engine::{
    SessionGraphRevision, SessionStateEnvelope, SessionStatePayload,
};
use crate::acp::transcript_projection::TranscriptProjectionRegistry;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

const INITIAL_VIEWPORT_ROW_PROJECTION_LIMIT: usize = 128;
const BUDGET_SHRUNK_DIAGNOSTIC_CODE: &str = "viewport_buffer_rows_shrunk_for_budget";

#[derive(Debug, Default)]
struct BufferEmissionState {
    prior_by_session: HashMap<String, PriorBufferEmission>,
    next_seq_by_session: HashMap<String, u64>,
}

#[derive(Debug, Clone)]
pub struct BufferEmissionTracker {
    rows: TranscriptRowsLedger,
    state: Arc<Mutex<BufferEmissionState>>,
}

impl BufferEmissionTracker {
    #[must_use]
    pub fn new(rows: TranscriptRowsLedger) -> Self {
        Self {
            rows,
            state: Arc::new(Mutex::new(BufferEmissionState::default())),
        }
    }

    pub fn remove_session(&self, session_id: &str) {
        let mut state = self.state.lock().expect("buffer emission mutex poisoned");
        state.prior_by_session.remove(session_id);
        state.next_seq_by_session.remove(session_id);
    }

    pub fn build_viewport_buffer_push_envelope_for_session(
        &self,
        runtime_snapshot: SessionGraphRuntimeSnapshot,
        session_id: &str,
        revision: SessionGraphRevision,
        projection_registry: &ProjectionRegistry,
        transcript_projection_registry: &TranscriptProjectionRegistry,
        request_generation: Option<u64>,
    ) -> Result<SessionStateEnvelope, VisibleTranscriptWindowMiss> {
        let materialized = self.rows.materialize_rows(
            runtime_snapshot,
            session_id,
            revision,
            projection_registry,
            transcript_projection_registry,
        )?;
        let emission_seq = self.reserve_next_seq(session_id);
        let payload = SessionStatePayload::ViewportBufferPush {
            push: ViewportBufferPush {
                session_id: session_id.to_string(),
                graph_revision: materialized.effective_revision,
                emission_seq,
                rows: materialized.rows,
                request_generation,
                diagnostics: Vec::<ViewportBufferDiagnostic>::new(),
            },
        };
        let envelope = self.rows.finalize_rows_envelope(
            session_id,
            materialized.effective_revision,
            payload,
            &materialized.operations,
            "viewport_buffer_push",
        )?;
        self.record_prior(session_id, prior_from_delivered_envelope(&envelope, &[]));
        Ok(envelope)
    }

    pub fn build_initial_viewport_buffer_envelope_for_session(
        &self,
        runtime_snapshot: SessionGraphRuntimeSnapshot,
        session_id: &str,
        revision: SessionGraphRevision,
        projection_registry: &ProjectionRegistry,
        transcript_projection_registry: &TranscriptProjectionRegistry,
    ) -> Result<SessionStateEnvelope, VisibleTranscriptWindowMiss> {
        let materialized = self.rows.materialize_tail_rows(
            runtime_snapshot,
            session_id,
            revision,
            projection_registry,
            transcript_projection_registry,
            INITIAL_VIEWPORT_ROW_PROJECTION_LIMIT,
        )?;
        let emission_seq = self.reserve_next_seq(session_id);
        let diagnostics = if materialized.tail_limited {
            vec![ViewportBufferDiagnostic {
                code: BUDGET_SHRUNK_DIAGNOSTIC_CODE.to_string(),
                row_id: None,
            }]
        } else {
            Vec::<ViewportBufferDiagnostic>::new()
        };
        let payload = SessionStatePayload::ViewportBufferPush {
            push: ViewportBufferPush {
                session_id: session_id.to_string(),
                graph_revision: materialized.effective_revision,
                emission_seq,
                rows: materialized.rows,
                request_generation: None,
                diagnostics,
            },
        };
        let envelope = self.rows.finalize_rows_envelope(
            session_id,
            materialized.effective_revision,
            payload,
            &materialized.operations,
            "initial_viewport_buffer_push",
        )?;
        self.record_prior(session_id, prior_from_delivered_envelope(&envelope, &[]));
        Ok(envelope)
    }

    pub fn build_or_advance_viewport_buffer_envelope(
        &self,
        runtime_snapshot: SessionGraphRuntimeSnapshot,
        session_id: &str,
        revision: SessionGraphRevision,
        projection_registry: &ProjectionRegistry,
        transcript_projection_registry: &TranscriptProjectionRegistry,
        request_generation: Option<u64>,
        force_fresh: bool,
    ) -> Result<Option<SessionStateEnvelope>, VisibleTranscriptWindowMiss> {
        let materialized = self.rows.materialize_rows(
            runtime_snapshot,
            session_id,
            revision,
            projection_registry,
            transcript_projection_registry,
        )?;

        let mut state = self.state.lock().expect("buffer emission mutex poisoned");
        let previous = state.prior_by_session.get(session_id);
        match decide_buffer_emission(previous, &materialized.rows, force_fresh) {
            BufferEmission::NoOp => Ok(None),
            BufferEmission::FreshPush => {
                let emission_seq = next_seq(&mut state, session_id);
                drop(state);
                let payload = SessionStatePayload::ViewportBufferPush {
                    push: ViewportBufferPush {
                        session_id: session_id.to_string(),
                        graph_revision: materialized.effective_revision,
                        emission_seq,
                        rows: materialized.rows,
                        request_generation,
                        diagnostics: Vec::<ViewportBufferDiagnostic>::new(),
                    },
                };
                let envelope = self.rows.finalize_rows_envelope(
                    session_id,
                    materialized.effective_revision,
                    payload,
                    &materialized.operations,
                    "viewport_buffer_push",
                )?;
                self.record_prior(session_id, prior_from_delivered_envelope(&envelope, &[]));
                Ok(Some(envelope))
            }
            BufferEmission::Delta => {
                let previous = previous.cloned().expect("delta requires prior");
                let emission_seq = next_seq(&mut state, session_id);
                let delta = compute_rows_delta(
                    session_id,
                    materialized.effective_revision,
                    emission_seq,
                    &previous,
                    &materialized.rows,
                )
                .expect("delta was classified as representable");
                drop(state);
                let payload = SessionStatePayload::ViewportBufferDelta { delta };
                let envelope = self.rows.finalize_rows_envelope(
                    session_id,
                    materialized.effective_revision,
                    payload,
                    &materialized.operations,
                    "viewport_buffer_delta",
                )?;
                self.record_prior(
                    session_id,
                    prior_from_delivered_delta_envelope(&envelope, &previous, &materialized.rows),
                );
                Ok(Some(envelope))
            }
        }
    }

    fn reserve_next_seq(&self, session_id: &str) -> u64 {
        let mut state = self.state.lock().expect("buffer emission mutex poisoned");
        next_seq(&mut state, session_id)
    }

    fn record_prior(&self, session_id: &str, prior: PriorBufferEmission) {
        let mut state = self.state.lock().expect("buffer emission mutex poisoned");
        state.prior_by_session.insert(session_id.to_string(), prior);
    }
}

fn next_seq(state: &mut BufferEmissionState, session_id: &str) -> u64 {
    let next = state
        .next_seq_by_session
        .entry(session_id.to_string())
        .or_insert(0);
    let emission_seq = *next;
    *next = next.saturating_add(1);
    emission_seq
}

fn prior_from_delivered_envelope(
    envelope: &SessionStateEnvelope,
    fallback_rows: &[crate::acp::transcript_viewport::TranscriptViewportRow],
) -> PriorBufferEmission {
    match &envelope.payload {
        SessionStatePayload::ViewportBufferPush { push } => {
            if push
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == BUDGET_SHRUNK_DIAGNOSTIC_CODE)
            {
                prior_from_budget_shrunk_tail_rows(&push.rows)
            } else {
                prior_from_rows(&push.rows)
            }
        }
        SessionStatePayload::ViewportBufferDelta { .. } => prior_from_rows(fallback_rows),
        _ => prior_from_rows(fallback_rows),
    }
}

fn prior_from_delivered_delta_envelope(
    envelope: &SessionStateEnvelope,
    previous: &PriorBufferEmission,
    fallback_rows: &[crate::acp::transcript_viewport::TranscriptViewportRow],
) -> PriorBufferEmission {
    match &envelope.payload {
        SessionStatePayload::ViewportBufferDelta { delta } if previous.budget_shrunk_tail => {
            prior_from_budget_shrunk_tail_delta(previous, delta)
        }
        SessionStatePayload::ViewportBufferDelta { .. } => prior_from_rows(fallback_rows),
        _ => prior_from_delivered_envelope(envelope, fallback_rows),
    }
}

fn prior_from_budget_shrunk_tail_delta(
    previous: &PriorBufferEmission,
    delta: &ViewportBufferDelta,
) -> PriorBufferEmission {
    let mut row_ids: Vec<String> = Vec::with_capacity(
        delta.prepended_rows.len() + previous.row_ids.len() + delta.appended_rows.len(),
    );
    let mut row_versions: Vec<String> = Vec::with_capacity(row_ids.capacity());

    for row in &delta.prepended_rows {
        row_ids.push(row.row_id.clone());
        row_versions.push(row.version.clone());
    }
    for (row_id, version) in previous.row_ids.iter().zip(&previous.row_versions) {
        if !delta
            .removed_row_ids
            .iter()
            .any(|removed_row_id| removed_row_id == row_id)
        {
            row_ids.push(row_id.clone());
            row_versions.push(version.clone());
        }
    }
    for row in &delta.appended_rows {
        row_ids.push(row.row_id.clone());
        row_versions.push(row.version.clone());
    }

    PriorBufferEmission {
        row_ids,
        row_versions,
        budget_shrunk_tail: true,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        next_seq, BufferEmissionState, BufferEmissionTracker, PriorBufferEmission,
        BUDGET_SHRUNK_DIAGNOSTIC_CODE, INITIAL_VIEWPORT_ROW_PROJECTION_LIMIT,
    };
    use crate::acp::projections::{ProjectionRegistry, SessionProjectionSnapshot, SessionSnapshot};
    use crate::acp::session_state_engine::revision::SessionGraphRevision;
    use crate::acp::session_state_engine::runtime_registry::{
        SessionGraphRuntimeSnapshot, VisibleTranscriptWindowMiss,
    };
    use crate::acp::session_state_engine::transcript_rows_ledger::TranscriptRowsLedger;
    use crate::acp::session_state_engine::{
        session_state_envelope_byte_budget_status, SessionStatePayload,
    };
    use crate::acp::transcript_projection::{
        TranscriptEntry, TranscriptEntryRole, TranscriptProjectionRegistry, TranscriptSegment,
        TranscriptSnapshot,
    };
    use crate::acp::types::CanonicalAgentId;

    #[test]
    fn emission_sequence_is_per_session_and_monotonic() {
        let mut state = BufferEmissionState::default();
        assert_eq!(next_seq(&mut state, "session-a"), 0);
        assert_eq!(next_seq(&mut state, "session-a"), 1);
        assert_eq!(next_seq(&mut state, "session-b"), 0);
        assert_eq!(next_seq(&mut state, "session-a"), 2);
    }

    #[test]
    fn reserving_sequence_does_not_mark_rows_as_delivered() {
        let mut state = BufferEmissionState::default();

        assert_eq!(next_seq(&mut state, "session-a"), 0);

        assert!(
            !state.prior_by_session.contains_key("session-a"),
            "failed or skipped pushes must not create a delivered rows prior"
        );
    }

    #[test]
    fn successful_emission_records_delivered_rows_prior() {
        let mut state = BufferEmissionState::default();
        let prior = PriorBufferEmission {
            row_ids: vec!["row-1".to_string()],
            row_versions: vec!["v1".to_string()],
            budget_shrunk_tail: false,
        };

        state
            .prior_by_session
            .insert("session-a".to_string(), prior);

        assert_eq!(
            state
                .prior_by_session
                .get("session-a")
                .expect("prior should be recorded after success")
                .row_ids,
            vec!["row-1".to_string()]
        );
    }

    fn transcript_entry(index: usize, text: String) -> TranscriptEntry {
        TranscriptEntry {
            scope: crate::acp::transcript_projection::TranscriptScope::Root,
            entry_id: format!("assistant-{index}"),
            role: TranscriptEntryRole::Assistant,
            segments: vec![TranscriptSegment::Text {
                segment_id: format!("assistant-{index}:text:0"),
                text,
            }],
            attempt_id: None,
            timestamp_ms: None,
        }
    }

    fn restore_session_with_entries(
        session_id: &str,
        projection_registry: &ProjectionRegistry,
        transcript_projection_registry: &TranscriptProjectionRegistry,
        entries: Vec<TranscriptEntry>,
    ) {
        let entry_count = entries.len();
        let transcript_snapshot = TranscriptSnapshot {
            revision: 1,
            entries,
        };
        transcript_projection_registry
            .restore_session_snapshot(session_id.to_string(), transcript_snapshot);
        let mut session =
            SessionSnapshot::new(session_id.to_string(), Some(CanonicalAgentId::Cursor));
        session.message_count = entry_count as u64;
        session.transcript_entry_count = entry_count;
        projection_registry.restore_session_projection(SessionProjectionSnapshot {
            session: Some(session),
            operations: Vec::new(),
            interactions: Vec::new(),
            runtime: None,
        });
    }

    #[test]
    fn failed_oversized_push_does_not_mark_rows_as_delivered() {
        let session_id = "session-a";
        let tracker = BufferEmissionTracker::new(TranscriptRowsLedger::new());
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        restore_session_with_entries(
            session_id,
            &projection_registry,
            &transcript_projection_registry,
            vec![transcript_entry(1, "x".repeat(600_000))],
        );
        let revision = SessionGraphRevision::new(1, 1, 1);

        let first = tracker.build_or_advance_viewport_buffer_envelope(
            SessionGraphRuntimeSnapshot::default(),
            session_id,
            revision,
            &projection_registry,
            &transcript_projection_registry,
            Some(1),
            true,
        );
        assert!(matches!(
            first,
            Err(VisibleTranscriptWindowMiss::BudgetExceeded)
        ));

        let second = tracker.build_or_advance_viewport_buffer_envelope(
            SessionGraphRuntimeSnapshot::default(),
            session_id,
            revision,
            &projection_registry,
            &transcript_projection_registry,
            Some(2),
            false,
        );
        assert!(matches!(
            second,
            Err(VisibleTranscriptWindowMiss::BudgetExceeded)
        ));
    }

    #[test]
    fn oversized_push_records_only_the_shrunk_delivered_rows() {
        let session_id = "session-a";
        let tracker = BufferEmissionTracker::new(TranscriptRowsLedger::new());
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        let entries: Vec<TranscriptEntry> = (0..40)
            .map(|index| transcript_entry(index, "x".repeat(20_000)))
            .collect();
        restore_session_with_entries(
            session_id,
            &projection_registry,
            &transcript_projection_registry,
            entries,
        );
        let revision = SessionGraphRevision::new(1, 1, 1);

        let envelope = tracker
            .build_or_advance_viewport_buffer_envelope(
                SessionGraphRuntimeSnapshot::default(),
                session_id,
                revision,
                &projection_registry,
                &transcript_projection_registry,
                Some(1),
                true,
            )
            .expect("fresh push should fit after shrinking")
            .expect("fresh push should be emitted");

        session_state_envelope_byte_budget_status(&envelope)
            .expect("shrunk push should fit byte budget");
        let SessionStatePayload::ViewportBufferPush { push } = envelope.payload else {
            panic!("expected viewport buffer push");
        };
        assert!(push.rows.len() < 40, "push should shrink the full row set");
        assert!(
            !push.rows.is_empty(),
            "shrunk push should still deliver rows"
        );
        assert!(push
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "viewport_buffer_rows_shrunk_for_budget"));

        {
            let state = tracker
                .state
                .lock()
                .expect("buffer emission mutex poisoned");
            let prior = state
                .prior_by_session
                .get(session_id)
                .expect("delivered rows prior should be recorded after success");
            assert_eq!(prior.row_ids.len(), push.rows.len());
            assert!(prior.budget_shrunk_tail);
            assert_eq!(
                prior.row_ids.first(),
                push.rows.first().map(|row| &row.row_id)
            );
            assert_eq!(
                prior.row_ids.last(),
                push.rows.last().map(|row| &row.row_id)
            );
        }

        let second = tracker
            .build_or_advance_viewport_buffer_envelope(
                SessionGraphRuntimeSnapshot::default(),
                session_id,
                revision,
                &projection_registry,
                &transcript_projection_registry,
                Some(2),
                false,
            )
            .expect("unchanged full transcript should not retry the oversized head");
        assert!(second.is_none());

        let appended_entries: Vec<TranscriptEntry> = (0..41)
            .map(|index| transcript_entry(index, "x".repeat(20_000)))
            .collect();
        restore_session_with_entries(
            session_id,
            &projection_registry,
            &transcript_projection_registry,
            appended_entries,
        );

        let third = tracker
            .build_or_advance_viewport_buffer_envelope(
                SessionGraphRuntimeSnapshot::default(),
                session_id,
                SessionGraphRevision::new(2, 2, 2),
                &projection_registry,
                &transcript_projection_registry,
                Some(3),
                false,
            )
            .expect("appending after a shrunk tail should stay in budget")
            .expect("append should emit a delta");
        session_state_envelope_byte_budget_status(&third)
            .expect("shrunk-tail append delta should fit byte budget");
        let SessionStatePayload::ViewportBufferDelta { delta } = third.payload else {
            panic!("expected viewport buffer delta");
        };
        assert!(delta.prepended_rows.is_empty());
        assert_eq!(delta.appended_rows.len(), 1);
        assert_eq!(delta.appended_rows[0].row_id, "transcript:assistant-40");

        let state = tracker
            .state
            .lock()
            .expect("buffer emission mutex poisoned");
        let prior = state
            .prior_by_session
            .get(session_id)
            .expect("shrunk-tail delta should update delivered prior");
        assert_eq!(prior.row_ids.len(), push.rows.len() + 1);
        assert!(prior.budget_shrunk_tail);
        assert_eq!(
            prior.row_ids.last(),
            Some(&"transcript:assistant-40".to_string())
        );
    }

    #[test]
    fn initial_viewport_push_projects_tail_and_seeds_tail_prior() {
        let session_id = "session-a";
        let tracker = BufferEmissionTracker::new(TranscriptRowsLedger::new());
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        let entries: Vec<TranscriptEntry> = (0..900)
            .map(|index| transcript_entry(index, "x".to_string()))
            .collect();
        restore_session_with_entries(
            session_id,
            &projection_registry,
            &transcript_projection_registry,
            entries,
        );
        let revision = SessionGraphRevision::new(1, 1, 1);

        let envelope = tracker
            .build_initial_viewport_buffer_envelope_for_session(
                SessionGraphRuntimeSnapshot::default(),
                session_id,
                revision,
                &projection_registry,
                &transcript_projection_registry,
            )
            .expect("initial viewport push should fit");

        session_state_envelope_byte_budget_status(&envelope)
            .expect("initial viewport push should fit byte budget");
        let SessionStatePayload::ViewportBufferPush { push } = envelope.payload else {
            panic!("expected viewport buffer push");
        };
        assert_eq!(push.rows.len(), INITIAL_VIEWPORT_ROW_PROJECTION_LIMIT);
        assert_eq!(
            push.rows[0].row_id,
            format!(
                "transcript:assistant-{}",
                900usize.saturating_sub(INITIAL_VIEWPORT_ROW_PROJECTION_LIMIT)
            )
        );
        assert!(push
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == BUDGET_SHRUNK_DIAGNOSTIC_CODE));

        let repeated = tracker
            .build_or_advance_viewport_buffer_envelope(
                SessionGraphRuntimeSnapshot::default(),
                session_id,
                revision,
                &projection_registry,
                &transcript_projection_registry,
                Some(2),
                false,
            )
            .expect("unchanged full transcript should not resend head rows");
        assert!(repeated.is_none());

        let state = tracker
            .state
            .lock()
            .expect("buffer emission mutex poisoned");
        let prior = state
            .prior_by_session
            .get(session_id)
            .expect("initial viewport should record delivered prior");
        assert!(prior.budget_shrunk_tail);
        assert_eq!(prior.row_ids.len(), INITIAL_VIEWPORT_ROW_PROJECTION_LIMIT);
    }
}
