use crate::acp::projections::ProjectionRegistry;
use crate::acp::session_state_engine::graph::{
    select_active_streaming_tail, select_awaiting_placeholder,
};
use crate::acp::session_state_engine::runtime_registry::{
    SessionGraphRuntimeSnapshot, VisibleTranscriptWindowMiss,
};
use crate::acp::session_state_engine::selectors::{
    SessionGraphActivity, merge_session_graph_activity_timing, select_session_graph_activity,
};
use crate::acp::session_state_engine::timing::wall_clock_ms;
use crate::acp::session_state_engine::{
    SessionGraphRevision, SessionStateEnvelope, SessionStatePayload,
    session_state_envelope_byte_budget_status,
};
use crate::acp::transcript_projection::TranscriptProjectionRegistry;
use crate::acp::transcript_viewport::{TranscriptViewportRow, project_transcript_viewport_rows};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone)]
pub struct TranscriptRowsLedger {
    activity_by_session: Arc<Mutex<HashMap<String, SessionGraphActivity>>>,
}

#[derive(Debug, Clone)]
pub(crate) struct TranscriptRowsMaterialization {
    pub rows: Vec<TranscriptViewportRow>,
    pub effective_revision: SessionGraphRevision,
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
            last_event_seq: revision.last_event_seq.max(transcript_snapshot.revision),
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
        let awaiting_placeholder = select_awaiting_placeholder(
            &session_snapshot.turn_state,
            &activity,
            &transcript_snapshot,
        );
        let rows = project_transcript_viewport_rows(
            &transcript_snapshot,
            &operations,
            &interactions,
            active_streaming_tail.as_ref(),
            awaiting_placeholder,
            activity.kind_started_at_ms,
        );

        Ok(TranscriptRowsMaterialization {
            rows,
            effective_revision,
        })
    }

    pub(crate) fn finalize_rows_envelope(
        &self,
        session_id: &str,
        effective_revision: SessionGraphRevision,
        payload: SessionStatePayload,
        budget_label: &str,
    ) -> Result<SessionStateEnvelope, VisibleTranscriptWindowMiss> {
        let envelope = SessionStateEnvelope {
            session_id: session_id.to_string(),
            graph_revision: effective_revision.graph_revision,
            last_event_seq: effective_revision.last_event_seq,
            payload,
        };

        match session_state_envelope_byte_budget_status(&envelope) {
            Ok(_) => Ok(envelope),
            Err(status) => {
                tracing::warn!(
                    session_id,
                    kind = budget_label,
                    byte_len = status.byte_len,
                    max_bytes = status.max_bytes,
                    "transcript rows envelope exceeded byte budget; skipping"
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

impl Default for TranscriptRowsLedger {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use crate::acp::session_state_engine::selectors::{
        SessionGraphActivity, SessionGraphActivityKind,
    };

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
}
