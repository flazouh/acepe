use crate::acp::projections::ProjectionRegistry;
use crate::acp::session_state_engine::protocol::{ViewportBufferDiagnostic, ViewportBufferPush};
use crate::acp::session_state_engine::runtime_registry::{
    SessionGraphRuntimeSnapshot, VisibleTranscriptWindowMiss,
};
use crate::acp::session_state_engine::transcript_rows_ledger::TranscriptRowsLedger;
use crate::acp::session_state_engine::viewport_buffer_producer::{
    BufferEmission, PriorBufferEmission, compute_rows_delta, decide_buffer_emission,
    prior_from_rows,
};
use crate::acp::session_state_engine::{
    SessionGraphRevision, SessionStateEnvelope, SessionStatePayload,
};
use crate::acp::transcript_projection::TranscriptProjectionRegistry;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

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
        let emission_seq = self.record_prior_and_next_seq(session_id, &materialized.rows);
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
        self.rows.finalize_rows_envelope(
            session_id,
            materialized.effective_revision,
            payload,
            "viewport_buffer_push",
        )
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
                state
                    .prior_by_session
                    .insert(session_id.to_string(), prior_from_rows(&materialized.rows));
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
                self.rows
                    .finalize_rows_envelope(
                        session_id,
                        materialized.effective_revision,
                        payload,
                        "viewport_buffer_push",
                    )
                    .map(Some)
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
                state
                    .prior_by_session
                    .insert(session_id.to_string(), prior_from_rows(&materialized.rows));
                drop(state);
                let payload = SessionStatePayload::ViewportBufferDelta { delta };
                self.rows
                    .finalize_rows_envelope(
                        session_id,
                        materialized.effective_revision,
                        payload,
                        "viewport_buffer_delta",
                    )
                    .map(Some)
            }
        }
    }

    fn record_prior_and_next_seq(
        &self,
        session_id: &str,
        rows: &[crate::acp::transcript_viewport::TranscriptViewportRow],
    ) -> u64 {
        let mut state = self.state.lock().expect("buffer emission mutex poisoned");
        let emission_seq = next_seq(&mut state, session_id);
        state
            .prior_by_session
            .insert(session_id.to_string(), prior_from_rows(rows));
        emission_seq
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

#[cfg(test)]
mod tests {
    use super::next_seq;
    use crate::acp::session_state_engine::buffer_emission_tracker::BufferEmissionState;

    #[test]
    fn emission_sequence_is_per_session_and_monotonic() {
        let mut state = BufferEmissionState::default();
        assert_eq!(next_seq(&mut state, "session-a"), 0);
        assert_eq!(next_seq(&mut state, "session-a"), 1);
        assert_eq!(next_seq(&mut state, "session-b"), 0);
        assert_eq!(next_seq(&mut state, "session-a"), 2);
    }
}
