use crate::acp::projections::ProjectionRegistry;
use crate::acp::session_state_engine::graph::{
    select_active_streaming_tail, select_awaiting_placeholder,
};
use crate::acp::session_state_engine::runtime_registry::{
    SessionGraphRuntimeSnapshot, TranscriptViewportHeightConfirmation, VisibleTranscriptWindowMiss,
};
use crate::acp::session_state_engine::selectors::select_session_graph_activity;
use crate::acp::session_state_engine::{
    session_state_envelope_byte_budget_status, SessionGraphRevision, SessionStateEnvelope,
    SessionStatePayload,
};
use crate::acp::transcript_projection::TranscriptProjectionRegistry;
use crate::acp::transcript_viewport::{
    project_transcript_viewport_rows, HeightConfirmationOutcome, LayoutIndex, ScrollIntent,
    TranscriptViewport, TranscriptViewportRow, ViewportMode,
};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// Viewport height used ONLY to bootstrap a brand-new `TranscriptViewport` when
/// the caller has not supplied a measured height (the streaming buffer producer
/// passes `None` to preserve canonical stored height). Once any command resizes
/// the viewport with a real measured height, that value persists and is never
/// overwritten by a streaming tick — this is the B3 fix that stops the producer
/// from clobbering the real height (which churned `viewport_revision` and
/// oscillated the buffer window indices into a spurious delta/push storm).
const BOOTSTRAP_VIEWPORT_HEIGHT_PX: u32 = 720;

#[derive(Debug, Clone)]
pub struct ViewportLedger {
    transcript_viewports: Arc<Mutex<HashMap<String, TranscriptViewport>>>,
}

impl ViewportLedger {
    #[must_use]
    pub fn new() -> Self {
        Self {
            transcript_viewports: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn remove_session(&self, session_id: &str) {
        self.transcript_viewports
            .lock()
            .expect("transcript_viewports mutex poisoned")
            .remove(session_id);
    }

    /// Shared prologue + viewport mutation for every read-shaped viewport
    /// command. Reads the current canonical snapshots, resyncs the effective
    /// revision (never rejects on a stale claimed revision — see retry-storm
    /// note below), projects rows, then locks the viewport, applies scroll /
    /// height-confirmation, and hands a read-only view to `materialize` which
    /// produces the wire payload. The byte budget is enforced uniformly.
    ///
    /// Read-shaped viewport commands (resize, scroll, reveal, confirm-height)
    /// race the canonical revision: during streaming the transcript/graph
    /// revision bumps on every event, so any command the UI sends is already
    /// behind by the time it reaches the backend. Rejecting on a revision lag
    /// produced a retry storm — the UI re-issued the same stale revision, the
    /// layout never settled to canonical heights, and per-row observers kept
    /// re-measuring forever, pegging the main thread. Instead we resync: build
    /// against the CURRENT canonical snapshots and echo the current canonical
    /// revision so the UI adopts it and converges. Canonical order and identity
    /// always come from the current transcript snapshot, never from the
    /// command's claimed revision, and height confirmations stay version-guarded
    /// inside the viewport, so resync cannot corrupt state.
    /// Run the shared viewport prologue under the `transcript_viewports` lock
    /// (rebuild layout from canonical rows, conditionally resize, apply scroll
    /// intent + height confirmation) and hand a read-only context to
    /// `materialize`, which may return any `T`. Returns `T` alongside the
    /// computed `effective_revision` for envelope finalization.
    ///
    /// Unlike a payload-shaped closure this lets the buffer producer pull a
    /// `ViewportBufferSlice` (plus the canonical rows) back out of the locked
    /// region so it can classify push/delta/no-op ABOVE the closure — the
    /// no-op "emit nothing" outcome cannot be expressed by returning a payload.
    pub(crate) fn with_materialized_viewport<T, F>(
        &self,
        runtime_snapshot: SessionGraphRuntimeSnapshot,
        session_id: &str,
        revision: SessionGraphRevision,
        projection_registry: &ProjectionRegistry,
        transcript_projection_registry: &TranscriptProjectionRegistry,
        viewport_height_px: Option<u32>,
        scroll_intent: Option<ScrollIntent>,
        height_confirmation: Option<TranscriptViewportHeightConfirmation>,
        materialize: F,
    ) -> Result<(T, SessionGraphRevision), VisibleTranscriptWindowMiss>
    where
        F: FnOnce(ViewportMaterializeCtx<'_>) -> T,
    {
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
        let operations = projection_snapshot.operations.clone();
        let interactions = projection_snapshot.interactions.clone();
        let activity = select_session_graph_activity(
            &runtime_snapshot.lifecycle,
            &session_snapshot.turn_state,
            &operations,
            &interactions,
            session_snapshot.active_turn_failure.as_ref(),
        );
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
        );
        let materialized = {
            let mut viewports = self
                .transcript_viewports
                .lock()
                .expect("transcript_viewports mutex poisoned");
            if let Some(viewport) = viewports.get_mut(session_id) {
                let layout =
                    LayoutIndex::from_viewport_rows_preserving(rows.as_slice(), viewport.layout());
                viewport.replace_layout_preserving_viewport(layout);
                // `None` preserves the canonical stored height (streaming
                // producer); only a real command-measured height resizes.
                if let Some(height) = viewport_height_px {
                    viewport.resize(height);
                }
            } else {
                viewports.insert(
                    session_id.to_string(),
                    TranscriptViewport::new(
                        LayoutIndex::from_viewport_rows(rows.as_slice()),
                        viewport_height_px.unwrap_or(BOOTSTRAP_VIEWPORT_HEIGHT_PX),
                    )
                    .with_viewport_revision(effective_revision.transcript_revision),
                );
            }

            let viewport = viewports
                .get_mut(session_id)
                .expect("viewport inserted before materialization");
            if let Some(intent) = scroll_intent {
                viewport.apply_scroll_intent(intent);
            }
            let mut anchor_correction_px: i64 = 0;
            let mut height_confirmation_outcome: Option<HeightConfirmationOutcome> = None;
            let height_diagnostic = height_confirmation.and_then(|confirmation| {
                let live_offset_authoritative = confirmation.viewport_offset_px.is_some();
                let can_confirm_height = viewport
                    .layout()
                    .row(&confirmation.row_id)
                    .is_some_and(|row| row.version == confirmation.row_version);
                if let (true, Some(viewport_offset_px)) =
                    (can_confirm_height, confirmation.viewport_offset_px)
                {
                    viewport.apply_scroll_intent(ScrollIntent::DetachAtOffset {
                        offset_px: viewport_offset_px,
                    });
                }
                let transition = viewport.confirm_height(
                    &confirmation.row_id,
                    &confirmation.row_version,
                    confirmation.height_px,
                );
                anchor_correction_px = if live_offset_authoritative {
                    0
                } else {
                    transition.anchor_correction_px
                };
                transition.height_confirmation.and_then(|outcome| {
                    height_confirmation_outcome = Some(outcome);
                    matches!(
                        outcome,
                        HeightConfirmationOutcome::StaleVersion
                            | HeightConfirmationOutcome::MissingRow
                    )
                    .then(|| ViewportHeightDiagnostic {
                        code: height_confirmation_diagnostic_code(outcome).to_string(),
                        row_id: Some(confirmation.row_id),
                    })
                })
            });

            materialize(ViewportMaterializeCtx {
                session_id,
                effective_revision,
                rows: rows.as_slice(),
                viewport,
                height_confirmation_outcome,
                height_diagnostic,
                anchor_correction_px,
            })
        };
        Ok((materialized, effective_revision))
    }

    /// Wrap a materialized payload in a `SessionStateEnvelope` and enforce the
    /// per-payload byte budget. Shared by every viewport producer.
    pub(crate) fn finalize_viewport_envelope(
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
                    "viewport envelope exceeded byte budget; skipping"
                );
                Err(VisibleTranscriptWindowMiss::BudgetExceeded)
            }
        }
    }

    pub(crate) fn build_session_viewport_envelope_with<F>(
        &self,
        runtime_snapshot: SessionGraphRuntimeSnapshot,
        session_id: &str,
        revision: SessionGraphRevision,
        projection_registry: &ProjectionRegistry,
        transcript_projection_registry: &TranscriptProjectionRegistry,
        viewport_height_px: Option<u32>,
        scroll_intent: Option<ScrollIntent>,
        height_confirmation: Option<TranscriptViewportHeightConfirmation>,
        budget_label: &str,
        materialize: F,
    ) -> Result<SessionStateEnvelope, VisibleTranscriptWindowMiss>
    where
        F: FnOnce(ViewportMaterializeCtx<'_>) -> SessionStatePayload,
    {
        let (payload, effective_revision) = self.with_materialized_viewport(
            runtime_snapshot,
            session_id,
            revision,
            projection_registry,
            transcript_projection_registry,
            viewport_height_px,
            scroll_intent,
            height_confirmation,
            materialize,
        )?;
        self.finalize_viewport_envelope(session_id, effective_revision, payload, budget_label)
    }
}

impl Default for ViewportLedger {
    fn default() -> Self {
        Self::new()
    }
}

/// Scroll-authority decision contract for a buffer emission. Returns
/// `(scroll_top_target, scroll_anchor_correction_px)` with **at most one** field
/// `Some` — never both — so the consumer never double-applies a scroll
/// correction.
///
/// Classified on `mode` FIRST, then intent/cause:
/// - `FollowingTail` mode → absolute tail target (`Some(viewport_offset_px)`),
///   no correction. Wins over the relative-correction branch even when a B4
///   height confirmation triggered this emission, because the absolute tail
///   target already incorporates the post-confirmation `total_height_px`. (A
///   streaming confirmation arrives with `scroll_intent = None` while
///   `mode == FollowingTail`; a relative correction here would race the
///   frontend tail-pin.)
/// - `Detached` mode, intentional reposition (`is_bootstrap` first push, or
///   `is_reveal` RevealRow) → absolute target, no correction.
/// - `Detached` mode, user-driven refill / accepted-confirmation re-push →
///   `None` absolute target (the user's live scrollTop is authoritative) plus a
///   relative `Some(Δ_above)` correction when geometry above the viewport
///   shifted (`anchor_correction_px != 0`), else both `None`.
#[must_use]
pub(crate) fn decide_scroll_authority(
    mode: &ViewportMode,
    viewport_offset_px: u64,
    is_bootstrap: bool,
    is_reveal: bool,
    anchor_correction_px: i64,
) -> (Option<u64>, Option<i64>) {
    if matches!(mode, ViewportMode::FollowingTail) || is_bootstrap || is_reveal {
        return (Some(viewport_offset_px), None);
    }
    let correction = (anchor_correction_px != 0).then_some(anchor_correction_px);
    (None, correction)
}

/// Neutral height-confirmation diagnostic produced by the shared viewport
/// prologue, mapped by each materializer into its payload-specific diagnostic.
pub(crate) struct ViewportHeightDiagnostic {
    pub code: String,
    pub row_id: Option<String>,
}

/// Read-only view handed to a viewport payload materializer after the shared
/// prologue has mutated the viewport under lock.
pub(crate) struct ViewportMaterializeCtx<'a> {
    pub session_id: &'a str,
    pub effective_revision: SessionGraphRevision,
    pub rows: &'a [TranscriptViewportRow],
    pub viewport: &'a TranscriptViewport,
    pub height_confirmation_outcome: Option<HeightConfirmationOutcome>,
    pub height_diagnostic: Option<ViewportHeightDiagnostic>,
    /// Signed canonical scroll-anchor correction from the height confirmation
    /// applied in this materialization (`0` when none / rejected). See
    /// `ViewportTransition::anchor_correction_px`.
    pub anchor_correction_px: i64,
}

fn height_confirmation_diagnostic_code(outcome: HeightConfirmationOutcome) -> &'static str {
    match outcome {
        HeightConfirmationOutcome::Accepted => "height_accepted",
        HeightConfirmationOutcome::Unchanged => "height_unchanged",
        HeightConfirmationOutcome::StaleVersion => "stale_height_confirmation",
        HeightConfirmationOutcome::MissingRow => "missing_height_confirmation_row",
    }
}

#[cfg(test)]
mod tests {
    use super::decide_scroll_authority;
    use crate::acp::transcript_viewport::ViewportMode;

    #[test]
    fn decide_scroll_authority_never_sets_both_fields() {
        // Invariant across the contract: at most one of the two scroll fields is
        // ever Some, so the consumer never double-applies a correction.
        let cases = [
            (ViewportMode::FollowingTail, true, false, 0_i64),
            (ViewportMode::FollowingTail, false, false, 200),
            (
                ViewportMode::Detached {
                    anchor_row_id: "a".to_string(),
                    offset_from_anchor_px: 0,
                },
                true,
                false,
                0,
            ),
            (
                ViewportMode::Detached {
                    anchor_row_id: "a".to_string(),
                    offset_from_anchor_px: 0,
                },
                false,
                true,
                0,
            ),
            (
                ViewportMode::Detached {
                    anchor_row_id: "a".to_string(),
                    offset_from_anchor_px: 0,
                },
                false,
                false,
                200,
            ),
            (
                ViewportMode::Detached {
                    anchor_row_id: "a".to_string(),
                    offset_from_anchor_px: 0,
                },
                false,
                false,
                0,
            ),
        ];
        for (mode, is_bootstrap, is_reveal, correction) in cases {
            let (target, corr) =
                decide_scroll_authority(&mode, 500, is_bootstrap, is_reveal, correction);
            assert!(
                !(target.is_some() && corr.is_some()),
                "target and correction must be mutually exclusive (mode={mode:?})"
            );
        }
    }
}
