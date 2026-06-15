//! Buffer emission state and the only dual-lock site in the session-state engine.
//!
//! LOCK ORDER: `buffer_emissions` then `transcript_viewports` (via `ViewportLedger`).
//! This module is the sole component that ever holds both locks. Acquisition order
//! is enforced in `with_buffer_emissions_locked` — never invert.

use crate::acp::projections::ProjectionRegistry;
use crate::acp::session_state_engine::runtime_registry::{
    SessionGraphRuntimeSnapshot, TranscriptViewportHeightConfirmation, VisibleTranscriptWindowMiss,
};
use crate::acp::session_state_engine::viewport_buffer_producer::{
    compute_buffer_delta, decide_buffer_emission, BufferEmission, BufferEmissionFlags,
    PriorBufferEmission,
};
use crate::acp::session_state_engine::viewport_ledger::{decide_scroll_authority, ViewportLedger};
use crate::acp::session_state_engine::{
    SessionGraphRevision, SessionStateEnvelope, SessionStatePayload,
};
use crate::acp::session_state_engine::protocol::{
    ViewportBufferDiagnostic, ViewportBufferPush,
};
use crate::acp::transcript_projection::TranscriptProjectionRegistry;
use crate::acp::transcript_viewport::{ScrollIntent, DEFAULT_BUFFER_OVERSCAN_ROWS};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// What the producer last pushed/sent for a session's transcript buffer. The
/// next emission diffs against this to decide push vs delta vs skip, and to
/// assign a contiguous per-session `emission_seq`.
///
/// `emission_seq` is the SOLE apply-ordering authority on the consumer, because
/// `viewport_revision` does not advance on streaming row appends and therefore
/// cannot sequence the two independent delivery channels (command `invoke()`
/// replies and the live event stream).
#[derive(Debug, Clone)]
struct BufferEmissionRecord {
    start_index: usize,
    row_ids: Vec<String>,
    row_versions: Vec<String>,
    viewport_revision: i64,
    emission_seq: u64,
}

#[derive(Debug, Clone)]
pub struct BufferEmissionTracker {
    viewports: ViewportLedger,
    buffer_emissions: Arc<Mutex<HashMap<String, BufferEmissionRecord>>>,
}

impl BufferEmissionTracker {
    #[must_use]
    pub fn new(viewports: ViewportLedger) -> Self {
        Self {
            viewports,
            buffer_emissions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Build a `ViewportBufferPush`: a large buffered slice the WebView resolves
    /// scroll offsets against locally, refilling only when nearing its bounds.
    /// `request_generation` echoes the UI's request id so late responses can be
    /// gated against newer live deltas. `scroll_top_target` carries the
    /// Rust-decided scroll position (initial open, reveal, follow-tail).
    pub fn build_viewport_buffer_push_envelope_for_session(
        &self,
        runtime_snapshot: SessionGraphRuntimeSnapshot,
        session_id: &str,
        revision: SessionGraphRevision,
        projection_registry: &ProjectionRegistry,
        transcript_projection_registry: &TranscriptProjectionRegistry,
        viewport_height_px: Option<u32>,
        scroll_intent: Option<ScrollIntent>,
        height_confirmation: Option<TranscriptViewportHeightConfirmation>,
        request_generation: Option<u64>,
        emission_seq: u64,
    ) -> Result<SessionStateEnvelope, VisibleTranscriptWindowMiss> {
        self.viewports.build_session_viewport_envelope_with(
            runtime_snapshot,
            session_id,
            revision,
            projection_registry,
            transcript_projection_registry,
            viewport_height_px,
            scroll_intent,
            height_confirmation,
            "Viewport buffer push",
            |ctx| {
                let slice = ctx.viewport.buffer_window(DEFAULT_BUFFER_OVERSCAN_ROWS);
                let rows = ctx.rows[slice.buffer_start_index..slice.buffer_end_index].to_vec();
                let diagnostics = ctx
                    .height_diagnostic
                    .map(|diagnostic| {
                        vec![ViewportBufferDiagnostic {
                            code: diagnostic.code,
                            row_id: diagnostic.row_id,
                        }]
                    })
                    .unwrap_or_default();
                SessionStatePayload::ViewportBufferPush {
                    push: ViewportBufferPush {
                        session_id: ctx.session_id.to_string(),
                        graph_revision: ctx.effective_revision,
                        viewport_revision: slice.viewport_revision,
                        emission_seq,
                        buffer_start_index: slice.buffer_start_index,
                        buffer_end_index: slice.buffer_end_index,
                        layout_row_count: slice.layout_row_count,
                        total_height_px: slice.total_height_px,
                        buffer_end_offset_px: slice.buffer_end_offset_px,
                        rows,
                        offsets_px: slice.offsets_px,
                        mode: slice.mode,
                        request_generation,
                        scroll_top_target: Some(slice.viewport_offset_px),
                        scroll_anchor_correction_px: None,
                        diagnostics,
                    },
                }
            },
        )
    }

    /// Stateful producer entry point for the push-a-working-set protocol. Diffs
    /// the freshly-materialized buffer slice against what was last emitted for
    /// this session and emits the cheapest correct payload:
    ///
    /// - no prior buffer, or a disjoint jump → `ViewportBufferPush` (all rows)
    /// - a contiguous slide / streaming tail-append → `ViewportBufferDelta`
    /// - an identical window → nothing (`Ok(None)`)
    ///
    /// `emission_seq` is bumped under the `buffer_emissions` lock on every
    /// emission and is the consumer's sole apply-ordering authority across the
    /// command-reply and event-stream channels.
    ///
    /// B4: an ACCEPTED height confirmation re-measures a row and shifts the
    /// absolute offsets of every row below it. A delta does not re-send
    /// surviving rows, so it would leave them at stale offsets. We therefore
    /// force a `FreshPush` (re-send all offsets) whenever a height confirmation
    /// was accepted. A rejected confirmation (`height_diag.is_some()`) changed
    /// nothing and falls through to normal classification.
    pub fn build_or_advance_viewport_buffer_envelope(
        &self,
        runtime_snapshot: SessionGraphRuntimeSnapshot,
        session_id: &str,
        revision: SessionGraphRevision,
        projection_registry: &ProjectionRegistry,
        transcript_projection_registry: &TranscriptProjectionRegistry,
        viewport_height_px: Option<u32>,
        scroll_intent: Option<ScrollIntent>,
        height_confirmation: Option<TranscriptViewportHeightConfirmation>,
        request_generation: Option<u64>,
        force_fresh: bool,
    ) -> Result<Option<SessionStateEnvelope>, VisibleTranscriptWindowMiss> {
        // Captured before `scroll_intent` is moved into the materialize call.
        // Per the scroll-authority decision contract, a `RevealRow` is an
        // intentional reposition (absolute target), distinct from a user-driven
        // `DetachAtOffset` refill (relative correction). `slice.mode` alone
        // cannot distinguish them (both yield `Detached`).
        let is_reveal_intent = matches!(scroll_intent, Some(ScrollIntent::RevealRow { .. }));

        self.with_buffer_emissions_locked(|emissions, viewports| {
            let prev = emissions.get(session_id).cloned();

            let (
                (slice, full_rows, height_outcome, height_diag, anchor_correction_px),
                effective_revision,
            ) = viewports.with_materialized_viewport(
                runtime_snapshot,
                session_id,
                revision,
                projection_registry,
                transcript_projection_registry,
                viewport_height_px,
                scroll_intent,
                height_confirmation,
                |ctx| {
                    let slice = ctx.viewport.buffer_window(DEFAULT_BUFFER_OVERSCAN_ROWS);
                    (
                        slice,
                        ctx.rows.to_vec(),
                        ctx.height_confirmation_outcome,
                        ctx.height_diagnostic,
                        ctx.anchor_correction_px,
                    )
                },
            )?;

            let prior = prev.as_ref().map(|record| PriorBufferEmission {
                start_index: record.start_index,
                row_ids: record.row_ids.clone(),
                row_versions: record.row_versions.clone(),
                viewport_revision: record.viewport_revision,
            });
            let emission = decide_buffer_emission(
                prior.as_ref(),
                &slice,
                &full_rows,
                BufferEmissionFlags {
                    height_outcome: height_outcome,
                    force_fresh,
                    has_prior: prev.is_some(),
                },
            );

            let next_seq = prev.as_ref().map_or(0, |r| r.emission_seq + 1);

            // Scroll-authority decision contract: choose at most ONE of an absolute
            // target or a relative correction, driven by the emission cause. This
            // replaces the previous unconditional absolute target that yanked the
            // viewport during user-driven refills (the scroll "storm").
            let (scroll_top_target, scroll_anchor_correction_px) = decide_scroll_authority(
                &slice.mode,
                slice.viewport_offset_px,
                prev.is_none(),
                is_reveal_intent,
                anchor_correction_px,
            );

            // Scalars/ids captured before any move out of `slice`.
            let buffer_start_index = slice.buffer_start_index;
            let buffer_end_index = slice.buffer_end_index;
            let slice_viewport_revision = slice.viewport_revision;
            let buffered_row_ids: Vec<String> = full_rows[buffer_start_index..buffer_end_index]
                .iter()
                .map(|row| row.row_id.clone())
                .collect();
            let buffered_row_versions: Vec<String> = full_rows[buffer_start_index..buffer_end_index]
                .iter()
                .map(|row| row.version.clone())
                .collect();

            let payload = match emission {
                BufferEmission::NoOp => return Ok(None),
                BufferEmission::FreshPush => {
                    let rows = full_rows[buffer_start_index..buffer_end_index].to_vec();
                    let diagnostics = height_diag
                        .map(|diagnostic| {
                            vec![ViewportBufferDiagnostic {
                                code: diagnostic.code,
                                row_id: diagnostic.row_id,
                            }]
                        })
                        .unwrap_or_default();
                    SessionStatePayload::ViewportBufferPush {
                        push: ViewportBufferPush {
                            session_id: session_id.to_string(),
                            graph_revision: effective_revision,
                            viewport_revision: slice.viewport_revision,
                            emission_seq: next_seq,
                            buffer_start_index: slice.buffer_start_index,
                            buffer_end_index: slice.buffer_end_index,
                            layout_row_count: slice.layout_row_count,
                            total_height_px: slice.total_height_px,
                            buffer_end_offset_px: slice.buffer_end_offset_px,
                            rows,
                            offsets_px: slice.offsets_px,
                            mode: slice.mode,
                            request_generation,
                            scroll_top_target,
                            scroll_anchor_correction_px,
                            diagnostics,
                        },
                    }
                }
                BufferEmission::Delta => {
                    let p = prev
                        .as_ref()
                        .expect("classify_buffer_transition returns Delta only when prev exists");
                    let delta = compute_buffer_delta(
                        session_id,
                        effective_revision,
                        next_seq,
                        p.viewport_revision,
                        p.start_index,
                        &p.row_ids,
                        &full_rows,
                        &slice,
                        scroll_anchor_correction_px,
                        scroll_top_target,
                    );
                    SessionStatePayload::ViewportBufferDelta { delta }
                }
            };

            emissions.insert(
                session_id.to_string(),
                BufferEmissionRecord {
                    start_index: buffer_start_index,
                    row_ids: buffered_row_ids,
                    row_versions: buffered_row_versions,
                    viewport_revision: slice_viewport_revision,
                    emission_seq: next_seq,
                },
            );

            let envelope = viewports.finalize_viewport_envelope(
                session_id,
                effective_revision,
                payload,
                "Viewport buffer",
            )?;
            Ok(Some(envelope))
        })
    }

    /// Acquire `buffer_emissions`, then hand the guard and `ViewportLedger` to `f`.
    /// This is the sole dual-lock entry point — `f` may call viewport methods while
    /// the emissions lock is held. Never acquire `transcript_viewports` before
    /// `buffer_emissions`.
    fn with_buffer_emissions_locked<R, F>(&self, f: F) -> R
    where
        F: FnOnce(
            &mut HashMap<String, BufferEmissionRecord>,
            &ViewportLedger,
        ) -> R,
    {
        let mut emissions = self
            .buffer_emissions
            .lock()
            .expect("buffer_emissions mutex poisoned");
        f(&mut emissions, &self.viewports)
    }
}

impl Default for BufferEmissionTracker {
    fn default() -> Self {
        Self::new(ViewportLedger::new())
    }
}

#[cfg(test)]
mod tests {
    //! Plan 010 U5 — buffer emission tracker characterization and integration tests.

    use super::BufferEmissionTracker;
    use crate::acp::projections::ProjectionRegistry;
    use crate::acp::session_state_engine::runtime_registry::{
        SessionGraphRuntimeSnapshot, TranscriptViewportHeightConfirmation, VisibleTranscriptWindowMiss,
    };
    use crate::acp::session_state_engine::viewport_ledger::ViewportLedger;
    use crate::acp::session_state_engine::viewport_buffer_producer::{
        buffer_delta_is_identity_consistent, classify_buffer_transition, compute_buffer_delta,
        BufferEmission,
    };
    use crate::acp::session_state_engine::{SessionGraphRevision, SessionStatePayload};
    use crate::acp::session_update::{ContentChunk, SessionUpdate};
    use crate::acp::transcript_projection::{TranscriptEntryRole, TranscriptProjectionRegistry, TranscriptSnapshot};
    use crate::acp::transcript_viewport::{
        ScrollIntent, TranscriptViewportRow, TranscriptViewportRowContent, TranscriptViewportRowKind,
        ViewportBufferSlice, ViewportMode,
    };
    use crate::acp::types::{CanonicalAgentId, ContentBlock};

    fn create_agent_message_chunk_update(
        session_id: &str,
        message_id: Option<&str>,
        text: &str,
        produced_at_monotonic_ms: u64,
    ) -> SessionUpdate {
        SessionUpdate::AgentMessageChunk {
            chunk: ContentChunk {
                content: ContentBlock::Text {
                    text: text.to_string(),
                },
                aggregation_hint: None,
            },
            part_id: None,
            message_id: message_id.map(str::to_string),
            session_id: Some(session_id.to_string()),
            produced_at_monotonic_ms: Some(produced_at_monotonic_ms),
        }
    }

    fn create_turn_complete_update_for_session(session_id: &str, turn_id: &str) -> SessionUpdate {
        SessionUpdate::TurnComplete {
            session_id: Some(session_id.to_string()),
            turn_id: Some(turn_id.to_string()),
        }
    }
    /// Layout entry count after seeding `assistant_row_count` distinct assistant rows
    /// via [`seed_buffer_emission_session`].
    fn seeded_buffer_layout_entry_count(assistant_row_count: usize) -> usize {
        assistant_row_count
    }

    /// Canonical assistant `entry_id` for the `index`th row seeded by
    /// [`seed_buffer_emission_session`].
    fn canonical_assistant_entry_id_for_buffer_seed_index(index: usize) -> String {
        if index == 0 {
            "acepe::entry::session-start::assistant::.".to_string()
        } else {
            format!("acepe::entry::assistant-boundary:{index}::assistant::.")
        }
    }
    fn seed_buffer_emission_session(
        projection_registry: &ProjectionRegistry,
        transcript_projection_registry: &TranscriptProjectionRegistry,
        session_id: &str,
        count: usize,
    ) -> SessionGraphRevision {
        projection_registry.register_session(session_id.to_string(), CanonicalAgentId::Cursor);
        let mut tx_revision: i64 = 0;
        for index in 0..count {
            if index > 0 {
                tx_revision += 1;
                let turn_complete = create_turn_complete_update_for_session(
                    session_id,
                    &format!("turn-{index}"),
                );
                projection_registry.apply_session_update(session_id, &turn_complete);
                let _ = transcript_projection_registry.apply_session_update_idle(
                    tx_revision,
                    &turn_complete,
                );
            }
            tx_revision += 1;
            let update = create_agent_message_chunk_update(
                session_id,
                None,
                "hello world",
                tx_revision as u64,
            );
            projection_registry.apply_session_update(session_id, &update);
            let _ = transcript_projection_registry.apply_session_update_idle(tx_revision, &update);
        }
        SessionGraphRevision::new(0, tx_revision, 1)
    }
    #[test]
    fn buffer_builder_reports_session_not_attached_when_no_canonical_state() {
        let tracker = BufferEmissionTracker::new(ViewportLedger::new());
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();

        let outcome = tracker.build_viewport_buffer_push_envelope_for_session(
            SessionGraphRuntimeSnapshot::default(),
            "unknown-session",
            SessionGraphRevision::new(1, 0, 1),
            &projection_registry,
            &transcript_projection_registry,
            Some(720),
            None,
            None,
            None,
            0,
        );

        assert_eq!(
            outcome.unwrap_err(),
            VisibleTranscriptWindowMiss::SessionNotAttached
        );
    }

    #[test]
    fn buffer_builder_resyncs_when_transcript_revision_behind() {
        // During streaming the canonical transcript revision bumps on every
        // event, so a viewport command racing the stream arrives with a lagging
        // transcript_revision. The builder must NOT hard-fail (that produced a
        // retry storm). It resyncs: builds against the current canonical
        // snapshot and echoes the current canonical revision so the UI converges.
        let tracker = BufferEmissionTracker::new(ViewportLedger::new());
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();

        projection_registry.register_session("session-stale".to_string(), CanonicalAgentId::Cursor);
        let update =
            create_agent_message_chunk_update("session-stale", Some("assistant-1"), "hello", 5);
        projection_registry.apply_session_update("session-stale", &update);
        // Drive the canonical transcript revision to 7.
        let _ = transcript_projection_registry.apply_session_update_idle(7, &update);

        // Command carries a stale transcript_revision (4 < 7).
        let outcome = tracker.build_viewport_buffer_push_envelope_for_session(
            SessionGraphRuntimeSnapshot::default(),
            "session-stale",
            SessionGraphRevision::new(0, 4, 1),
            &projection_registry,
            &transcript_projection_registry,
            Some(720),
            None,
            None,
            None,
            0,
        );

        let envelope = outcome.expect("stale transcript revision must resync, not reject");
        match envelope.payload {
            SessionStatePayload::ViewportBufferPush { push } => {
                assert_eq!(
                    push.graph_revision.transcript_revision, 7,
                    "resynced buffer must echo the current canonical transcript revision"
                );
            }
            other => panic!("expected viewport buffer push payload, got {other:?}"),
        }
    }

    #[test]
    fn buffer_producer_with_none_height_preserves_canonical_height_without_revision_churn() {
        // B3 regression: the streaming buffer producer must pass `None` so it
        // preserves the canonical viewport height a real command measured —
        // never re-forcing a bootstrap height every tick, which oscillated
        // `viewport_revision` and the buffer window indices into a spurious
        // delta/push storm. A real command-measured resize still bumps.
        let tracker = BufferEmissionTracker::new(ViewportLedger::new());
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();

        projection_registry.register_session("session-h".to_string(), CanonicalAgentId::Cursor);
        let update =
            create_agent_message_chunk_update("session-h", Some("assistant-1"), "hello", 5);
        projection_registry.apply_session_update("session-h", &update);
        let _ = transcript_projection_registry.apply_session_update_idle(7, &update);
        let revision = SessionGraphRevision::new(0, 7, 1);

        let push_revision = |height: Option<u32>| match tracker
            .build_viewport_buffer_push_envelope_for_session(
                SessionGraphRuntimeSnapshot::default(),
                "session-h",
                revision,
                &projection_registry,
                &transcript_projection_registry,
                height,
                None,
                None,
                None,
                0,
            )
            .expect("buffer push must materialize")
            .payload
        {
            SessionStatePayload::ViewportBufferPush { push } => push.viewport_revision,
            other => panic!("expected viewport buffer push payload, got {other:?}"),
        };

        // First push installs a real measured height of 900.
        let r1 = push_revision(Some(900));
        // Streaming ticks pass `None`: preserve the stored height, no churn.
        let r2 = push_revision(None);
        let r3 = push_revision(None);
        assert_eq!(
            r1, r2,
            "a None-height streaming tick must not churn the revision"
        );
        assert_eq!(r2, r3, "repeated None-height ticks stay revision-stable");

        // A real command-measured resize to a DIFFERENT height bumps. This also
        // proves the stored height was 900 (not the bootstrap 720): resizing to
        // 720 would be a no-op if 720 were already stored.
        let r4 = push_revision(Some(720));
        assert!(
            r4 > r3,
            "a real resize away from the stored height must bump the revision"
        );
    }



    #[test]
    fn buffer_emission_first_call_is_fresh_push_with_seq_zero() {
        let tracker = BufferEmissionTracker::new(ViewportLedger::new());
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        let revision = seed_buffer_emission_session(
            &projection_registry,
            &transcript_projection_registry,
            "s",
            3,
        );

        let envelope = tracker
            .build_or_advance_viewport_buffer_envelope(
                SessionGraphRuntimeSnapshot::default(),
                "s",
                revision,
                &projection_registry,
                &transcript_projection_registry,
                Some(720),
                None,
                None,
                None,
                false,
            )
            .expect("first emission must materialize")
            .expect("first emission must produce a payload");

        match envelope.payload {
            SessionStatePayload::ViewportBufferPush { push } => {
                assert_eq!(
                    push.emission_seq, 0,
                    "first push baselines emission_seq at 0"
                );
                assert_eq!(
                    push.rows.len(),
                    seeded_buffer_layout_entry_count(3),
                    "seed creates one layout row per distinct assistant entry"
                );
            }
            other => panic!("expected ViewportBufferPush, got {other:?}"),
        }
    }

    #[test]
    fn buffer_emission_identical_window_emits_nothing() {
        let tracker = BufferEmissionTracker::new(ViewportLedger::new());
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        let revision = seed_buffer_emission_session(
            &projection_registry,
            &transcript_projection_registry,
            "s",
            3,
        );

        let _ = tracker
            .build_or_advance_viewport_buffer_envelope(
                SessionGraphRuntimeSnapshot::default(),
                "s",
                revision,
                &projection_registry,
                &transcript_projection_registry,
                Some(720),
                None,
                None,
                None,
                false,
            )
            .expect("first emission")
            .expect("first push");

        // No new rows, identical height, no scroll -> identical window -> NoOp.
        let second = tracker
            .build_or_advance_viewport_buffer_envelope(
                SessionGraphRuntimeSnapshot::default(),
                "s",
                revision,
                &projection_registry,
                &transcript_projection_registry,
                Some(720),
                None,
                None,
                None,
                false,
            )
            .expect("second emission must not error");
        assert!(second.is_none(), "an identical window must emit nothing");
    }

    #[test]
    fn buffer_emission_streaming_append_that_moves_tail_is_fresh_push_and_noop_does_not_consume_seq(
    ) {
        let tracker = BufferEmissionTracker::new(ViewportLedger::new());
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        let revision = seed_buffer_emission_session(
            &projection_registry,
            &transcript_projection_registry,
            "s",
            3,
        );

        // seq 0 push.
        let _ = tracker
            .build_or_advance_viewport_buffer_envelope(
                SessionGraphRuntimeSnapshot::default(),
                "s",
                revision,
                &projection_registry,
                &transcript_projection_registry,
                Some(720),
                None,
                None,
                None,
                false,
            )
            .expect("first")
            .expect("push");

        // A NoOp tick in between must NOT consume an emission_seq.
        assert!(tracker
            .build_or_advance_viewport_buffer_envelope(
                SessionGraphRuntimeSnapshot::default(),
                "s",
                revision,
                &projection_registry,
                &transcript_projection_registry,
                Some(720),
                None,
                None,
                None,
                false,
            )
            .expect("noop tick")
            .is_none());

        // Append a new tail row + advance the canonical transcript revision.
        let turn_complete = create_turn_complete_update_for_session("s", "turn-tail");
        projection_registry.apply_session_update("s", &turn_complete);
        let _ = transcript_projection_registry.apply_session_update_idle(49, &turn_complete);
        let update = create_agent_message_chunk_update("s", None, "more", 99);
        projection_registry.apply_session_update("s", &update);
        let _ = transcript_projection_registry.apply_session_update_idle(50, &update);
        let revision2 = SessionGraphRevision::new(0, 50, 1);

        let envelope = tracker
            .build_or_advance_viewport_buffer_envelope(
                SessionGraphRuntimeSnapshot::default(),
                "s",
                revision2,
                &projection_registry,
                &transcript_projection_registry,
                None,
                None,
                None,
                None,
                false,
            )
            .expect("streaming emission")
            .expect("streaming append must emit a payload");

        // Appending a new trailing assistant row moves the active streaming tail off the
        // previous tail row, changing that survivor's content version. The delta wire cannot
        // express "a survivor changed" (only prepend/append/remove), so the identity guard
        // must promote to a FreshPush to avoid leaving the consumer rendering a stale
        // streaming-tail indicator. The intervening NoOp must still not have consumed a seq.
        match envelope.payload {
            SessionStatePayload::ViewportBufferPush { push } => {
                assert_eq!(
                    push.emission_seq, 1,
                    "fresh push seq is prev+1; the intervening NoOp must not have consumed a seq"
                );
                assert_eq!(
                    push.rows.len(),
                    seeded_buffer_layout_entry_count(4),
                    "fresh push re-sends the whole buffer incl. the de-tailed survivor and new tail"
                );
                assert!(
                    push.rows
                        .last()
                        .is_some_and(|row| row.active_streaming_tail.is_some()),
                    "the newly appended row is the streaming tail"
                );
                assert!(
                    push.rows[..push.rows.len() - 1]
                        .iter()
                        .all(|row| row.active_streaming_tail.is_none()),
                    "prior survivors are no longer the streaming tail"
                );
            }
            other => panic!("expected ViewportBufferPush, got {other:?}"),
        }
    }

    // Regression guard: the identity-soundness check must be SURGICAL. It promotes to a
    // FreshPush only when surviving rows actually drift (id or version). A pure scroll slide
    // over a layout larger than the overscan buffer leaves survivors byte-identical, so the
    // stateful emitter must still emit a real ViewportBufferDelta. This proves the guard did
    // not globally defeat the byte-optimal scroll-refill path while fixing the streaming crash.
    #[test]
    fn buffer_emission_scroll_slide_with_stable_survivors_still_emits_delta() {
        let tracker = BufferEmissionTracker::new(ViewportLedger::new());
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        // 120 rows @ 120px each (1440px tall) far exceeds the 50-row overscan window, so a
        // scroll slides the buffer instead of always covering the whole layout.
        let revision = seed_buffer_emission_session(
            &projection_registry,
            &transcript_projection_registry,
            "s",
            120,
        );

        // seq 0 baseline push, following the tail at a fixed height.
        let baseline = tracker
            .build_or_advance_viewport_buffer_envelope(
                SessionGraphRuntimeSnapshot::default(),
                "s",
                revision,
                &projection_registry,
                &transcript_projection_registry,
                Some(720),
                None,
                None,
                None,
                false,
            )
            .expect("baseline emission")
            .expect("baseline push");
        let baseline_end = match baseline.payload {
            SessionStatePayload::ViewportBufferPush { push } => push.buffer_end_index,
            other => panic!("expected baseline ViewportBufferPush, got {other:?}"),
        };

        // Scroll up ~10 rows. Same height (no height-confirm push), same content (no version
        // drift), window slides toward the top -> prepend-only delta with stable survivors.
        let envelope = tracker
            .build_or_advance_viewport_buffer_envelope(
                SessionGraphRuntimeSnapshot::default(),
                "s",
                revision,
                &projection_registry,
                &transcript_projection_registry,
                Some(720),
                Some(
                    crate::acp::transcript_viewport::ScrollIntent::DetachAtOffset {
                        offset_px: 12_480,
                    },
                ),
                None,
                None,
                false,
            )
            .expect("scroll emission")
            .expect("scroll slide must emit a payload");

        match envelope.payload {
            SessionStatePayload::ViewportBufferDelta { delta } => {
                assert_eq!(
                    delta.emission_seq, 1,
                    "delta takes prev+1 after the baseline push"
                );
                assert!(
                    !delta.prepended_rows.is_empty(),
                    "scrolling up reveals earlier rows as a prepend"
                );
                assert!(
                    delta.appended_rows.is_empty() && delta.removed_row_ids.is_empty(),
                    "an upward scroll only prepends; survivors and tail are untouched"
                );
                let _ = baseline_end;
            }
            other => panic!("scroll slide with stable survivors must stay a Delta, got {other:?}"),
        }
    }

    #[test]
    fn buffer_emission_accepted_height_confirmation_forces_fresh_push() {
        let tracker = BufferEmissionTracker::new(ViewportLedger::new());
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        let revision = seed_buffer_emission_session(
            &projection_registry,
            &transcript_projection_registry,
            "s",
            3,
        );

        let first = tracker
            .build_or_advance_viewport_buffer_envelope(
                SessionGraphRuntimeSnapshot::default(),
                "s",
                revision,
                &projection_registry,
                &transcript_projection_registry,
                Some(720),
                None,
                None,
                None,
                false,
            )
            .expect("first")
            .expect("push");
        let (row_id, row_version) = match first.payload {
            SessionStatePayload::ViewportBufferPush { push } => {
                let row = &push.rows[0];
                (row.row_id.clone(), row.version.clone())
            }
            other => panic!("expected push, got {other:?}"),
        };

        // Accepted height confirmation (valid row + version) shifts offsets of
        // every row below it. The window index range is unchanged, so the
        // classifier would say NoOp; B4 must force a FreshPush so all offsets
        // are re-sent. emission_seq must advance so the consumer rebaselines.
        let envelope = tracker
            .build_or_advance_viewport_buffer_envelope(
                SessionGraphRuntimeSnapshot::default(),
                "s",
                revision,
                &projection_registry,
                &transcript_projection_registry,
                Some(720),
                None,
                Some(TranscriptViewportHeightConfirmation {
                    row_id,
                    row_version,
                    height_px: 321,
                    viewport_offset_px: None,
                }),
                None,
                false,
            )
            .expect("height-confirm emission")
            .expect("accepted height confirmation must emit a fresh push");

        match envelope.payload {
            SessionStatePayload::ViewportBufferPush { push } => {
                assert_eq!(push.emission_seq, 1, "forced push must advance the seq");
            }
            other => panic!("expected forced ViewportBufferPush, got {other:?}"),
        }
    }

    #[test]
    fn duplicate_height_confirmation_does_not_emit_fresh_push() {
        let tracker = BufferEmissionTracker::new(ViewportLedger::new());
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        let revision = seed_buffer_emission_session(
            &projection_registry,
            &transcript_projection_registry,
            "s",
            3,
        );

        let first = tracker
            .build_or_advance_viewport_buffer_envelope(
                SessionGraphRuntimeSnapshot::default(),
                "s",
                revision,
                &projection_registry,
                &transcript_projection_registry,
                Some(720),
                None,
                None,
                None,
                false,
            )
            .expect("first")
            .expect("push");
        let (row_id, row_version) = match first.payload {
            SessionStatePayload::ViewportBufferPush { push } => {
                let row = &push.rows[0];
                (row.row_id.clone(), row.version.clone())
            }
            other => panic!("expected push, got {other:?}"),
        };

        let _ = tracker
            .build_or_advance_viewport_buffer_envelope(
                SessionGraphRuntimeSnapshot::default(),
                "s",
                revision,
                &projection_registry,
                &transcript_projection_registry,
                Some(720),
                None,
                Some(TranscriptViewportHeightConfirmation {
                    row_id: row_id.clone(),
                    row_version: row_version.clone(),
                    height_px: 321,
                    viewport_offset_px: None,
                }),
                None,
                false,
            )
            .expect("first height confirmation")
            .expect("first accepted height confirmation must emit");

        let duplicate = tracker
            .build_or_advance_viewport_buffer_envelope(
                SessionGraphRuntimeSnapshot::default(),
                "s",
                revision,
                &projection_registry,
                &transcript_projection_registry,
                Some(720),
                None,
                Some(TranscriptViewportHeightConfirmation {
                    row_id,
                    row_version,
                    height_px: 321,
                    viewport_offset_px: None,
                }),
                None,
                false,
            )
            .expect("duplicate height confirmation");

        assert!(
            duplicate.is_none(),
            "an unchanged height confirmation must not emit another fresh push"
        );
    }

    #[test]
    fn buffer_emission_rejected_height_confirmation_does_not_force_push() {
        let tracker = BufferEmissionTracker::new(ViewportLedger::new());
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        let revision = seed_buffer_emission_session(
            &projection_registry,
            &transcript_projection_registry,
            "s",
            3,
        );

        let _ = tracker
            .build_or_advance_viewport_buffer_envelope(
                SessionGraphRuntimeSnapshot::default(),
                "s",
                revision,
                &projection_registry,
                &transcript_projection_registry,
                Some(720),
                None,
                None,
                None,
                false,
            )
            .expect("first")
            .expect("push");

        // A rejected confirmation (bogus version) changed nothing; the safe gate
        // must NOT force a push for it (otherwise a stale-version retry storm
        // would each spawn a full re-push). Identical window -> NoOp.
        let second = tracker
            .build_or_advance_viewport_buffer_envelope(
                SessionGraphRuntimeSnapshot::default(),
                "s",
                revision,
                &projection_registry,
                &transcript_projection_registry,
                Some(720),
                None,
                Some(TranscriptViewportHeightConfirmation {
                    row_id: canonical_assistant_entry_id_for_buffer_seed_index(0),
                    row_version: "definitely-not-the-current-version".to_string(),
                    height_px: 321,
                    viewport_offset_px: Some(1200),
                }),
                None,
                false,
            )
            .expect("rejected-confirm emission must not error");
        assert!(
            second.is_none(),
            "a rejected height confirmation must not force a fresh push"
        );
    }

    #[test]
    fn following_tail_confirmation_push_uses_absolute_target_not_correction() {
        // The dominant streaming case: viewport in FollowingTail, a row grows via
        // an accepted height confirmation (scroll_intent = None). The producer
        // MUST emit an absolute tail target and NO relative correction, because
        // the absolute target already incorporates the post-confirmation
        // total_height_px. A correction here would race the frontend tail-pin.
        let tracker = BufferEmissionTracker::new(ViewportLedger::new());
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        let revision = seed_buffer_emission_session(
            &projection_registry,
            &transcript_projection_registry,
            "s",
            20,
        );

        let first = tracker
            .build_or_advance_viewport_buffer_envelope(
                SessionGraphRuntimeSnapshot::default(),
                "s",
                revision,
                &projection_registry,
                &transcript_projection_registry,
                Some(720),
                None,
                None,
                None,
                false,
            )
            .expect("first")
            .expect("push");
        let (row_id, row_version) = match first.payload {
            SessionStatePayload::ViewportBufferPush { push } => {
                assert_eq!(push.mode, ViewportMode::FollowingTail);
                let row = &push.rows[0];
                (row.row_id.clone(), row.version.clone())
            }
            other => panic!("expected push, got {other:?}"),
        };

        let envelope = tracker
            .build_or_advance_viewport_buffer_envelope(
                SessionGraphRuntimeSnapshot::default(),
                "s",
                revision,
                &projection_registry,
                &transcript_projection_registry,
                Some(720),
                None,
                Some(TranscriptViewportHeightConfirmation {
                    row_id,
                    row_version,
                    height_px: 321,
                    viewport_offset_px: None,
                }),
                None,
                false,
            )
            .expect("confirm")
            .expect("forced push");

        match envelope.payload {
            SessionStatePayload::ViewportBufferPush { push } => {
                assert_eq!(push.mode, ViewportMode::FollowingTail);
                assert!(
                    push.scroll_top_target.is_some(),
                    "FollowingTail must carry an absolute tail target"
                );
                assert_eq!(
                    push.scroll_anchor_correction_px, None,
                    "FollowingTail must never carry a relative correction"
                );
            }
            other => panic!("expected push, got {other:?}"),
        }
    }

    #[test]
    fn detached_refill_push_has_no_absolute_scroll_target() {
        // A user-driven refill (DetachAtOffset) must NOT yank scrollTop back to a
        // request-time absolute position. With no above-viewport geometry change
        // there is also no correction — the user's live scrollTop is preserved.
        let tracker = BufferEmissionTracker::new(ViewportLedger::new());
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        let revision = seed_buffer_emission_session(
            &projection_registry,
            &transcript_projection_registry,
            "s",
            20,
        );

        let _ = tracker
            .build_or_advance_viewport_buffer_envelope(
                SessionGraphRuntimeSnapshot::default(),
                "s",
                revision,
                &projection_registry,
                &transcript_projection_registry,
                Some(720),
                None,
                None,
                None,
                false,
            )
            .expect("first")
            .expect("push");

        let envelope = tracker
            .build_or_advance_viewport_buffer_envelope(
                SessionGraphRuntimeSnapshot::default(),
                "s",
                revision,
                &projection_registry,
                &transcript_projection_registry,
                Some(720),
                Some(ScrollIntent::DetachAtOffset { offset_px: 1200 }),
                None,
                None,
                true,
            )
            .expect("detach refill")
            .expect("forced push");

        match envelope.payload {
            SessionStatePayload::ViewportBufferPush { push } => {
                assert!(
                    matches!(push.mode, ViewportMode::Detached { .. }),
                    "expected Detached mode"
                );
                assert_eq!(
                    push.scroll_top_target, None,
                    "a user-driven refill must not reposition scrollTop"
                );
                assert_eq!(push.scroll_anchor_correction_px, None);
            }
            other => panic!("expected push, got {other:?}"),
        }
    }

    #[test]
    fn detached_accepted_confirmation_above_viewport_emits_relative_correction() {
        // The storm fix: a row ABOVE the viewport re-measures while the user is
        // scrolled (Detached). The producer must emit a relative correction
        // (Δ_above) and NO absolute target, so the frontend adds the shift to its
        // live scrollTop instead of being yanked to a stale absolute position.
        let tracker = BufferEmissionTracker::new(ViewportLedger::new());
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        let revision = seed_buffer_emission_session(
            &projection_registry,
            &transcript_projection_registry,
            "s",
            20,
        );

        let _ = tracker
            .build_or_advance_viewport_buffer_envelope(
                SessionGraphRuntimeSnapshot::default(),
                "s",
                revision,
                &projection_registry,
                &transcript_projection_registry,
                Some(720),
                None,
                None,
                None,
                false,
            )
            .expect("first")
            .expect("push");

        // Detach mid-layout: anchor lands on the row at offset 1200 (index 10 of
        // 120px rows). Rows above it are above the viewport offset.
        let detach = tracker
            .build_or_advance_viewport_buffer_envelope(
                SessionGraphRuntimeSnapshot::default(),
                "s",
                revision,
                &projection_registry,
                &transcript_projection_registry,
                Some(720),
                Some(ScrollIntent::DetachAtOffset { offset_px: 1200 }),
                None,
                None,
                true,
            )
            .expect("detach")
            .expect("push");
        let (above_row_id, above_row_version) = match detach.payload {
            SessionStatePayload::ViewportBufferPush { push } => {
                // Row index 2 sits at offset 240 < 1200 (above the viewport).
                let row = &push.rows[2];
                (row.row_id.clone(), row.version.clone())
            }
            other => panic!("expected push, got {other:?}"),
        };

        // Grow the above-viewport row 120 -> 320 (+200).
        let envelope = tracker
            .build_or_advance_viewport_buffer_envelope(
                SessionGraphRuntimeSnapshot::default(),
                "s",
                revision,
                &projection_registry,
                &transcript_projection_registry,
                Some(720),
                None,
                Some(TranscriptViewportHeightConfirmation {
                    row_id: above_row_id,
                    row_version: above_row_version,
                    height_px: 320,
                    viewport_offset_px: None,
                }),
                None,
                false,
            )
            .expect("confirm")
            .expect("forced push");

        match envelope.payload {
            SessionStatePayload::ViewportBufferPush { push } => {
                assert!(
                    matches!(push.mode, ViewportMode::Detached { .. }),
                    "expected Detached mode"
                );
                assert_eq!(
                    push.scroll_top_target, None,
                    "Detached confirmation must not use an absolute target"
                );
                assert_eq!(
                    push.scroll_anchor_correction_px,
                    Some(200),
                    "above-viewport growth must produce a +Δ relative correction"
                );
            }
            other => panic!("expected push, got {other:?}"),
        }
    }

    #[test]
    fn height_confirmation_uses_live_offset_without_scroll_correction_when_frontend_scrolled_inside_buffer(
    ) {
        // Native in-buffer scrolling intentionally avoids a scroll-intent round
        // trip. Height confirmations still arrive during that scroll, so the
        // confirmation must carry the live WebView offset and re-anchor Rust
        // before materializing the buffer. Because that live offset is the
        // user's active scroll position, it is already authoritative; emitting
        // Δ_above back to the WebView would fight the active upward scroll.
        let tracker = BufferEmissionTracker::new(ViewportLedger::new());
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        let revision = seed_buffer_emission_session(
            &projection_registry,
            &transcript_projection_registry,
            "s",
            20,
        );

        let first = tracker
            .build_or_advance_viewport_buffer_envelope(
                SessionGraphRuntimeSnapshot::default(),
                "s",
                revision,
                &projection_registry,
                &transcript_projection_registry,
                Some(720),
                None,
                None,
                None,
                false,
            )
            .expect("first")
            .expect("push");

        let (above_row_id, above_row_version) = match first.payload {
            SessionStatePayload::ViewportBufferPush { push } => {
                assert_eq!(push.mode, ViewportMode::FollowingTail);
                // Row index 2 starts at 240px, above the live offset below.
                let row = &push.rows[2];
                (row.row_id.clone(), row.version.clone())
            }
            other => panic!("expected push, got {other:?}"),
        };

        let envelope = tracker
            .build_or_advance_viewport_buffer_envelope(
                SessionGraphRuntimeSnapshot::default(),
                "s",
                revision,
                &projection_registry,
                &transcript_projection_registry,
                Some(720),
                None,
                Some(TranscriptViewportHeightConfirmation {
                    row_id: above_row_id,
                    row_version: above_row_version,
                    height_px: 320,
                    viewport_offset_px: Some(1200),
                }),
                None,
                false,
            )
            .expect("confirm")
            .expect("forced push");

        match envelope.payload {
            SessionStatePayload::ViewportBufferPush { push } => {
                assert!(
                    matches!(push.mode, ViewportMode::Detached { .. }),
                    "live offset should re-anchor stale follow-tail mode before confirmation"
                );
                assert_eq!(
                    push.scroll_top_target, None,
                    "a live user offset is not an intentional absolute reposition"
                );
                assert_eq!(
                    push.scroll_anchor_correction_px, None,
                    "live user offset supersedes Δ_above during active in-buffer scrolling"
                );
            }
            other => panic!("expected push, got {other:?}"),
        }
    }

    #[test]
    fn buffer_builder_resyncs_when_graph_revision_behind() {
        let tracker = BufferEmissionTracker::new(ViewportLedger::new());
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();

        // Seed the runtime with a canonical graph revision of 5.
        let runtime_snapshot = SessionGraphRuntimeSnapshot {
            graph_revision: 5,
            ..SessionGraphRuntimeSnapshot::default()
        };
        projection_registry.register_session("session-graph".to_string(), CanonicalAgentId::Cursor);
        let update =
            create_agent_message_chunk_update("session-graph", Some("assistant-1"), "hello", 5);
        projection_registry.apply_session_update("session-graph", &update);
        let _ = transcript_projection_registry.apply_session_update_idle(7, &update);

        // Command carries the current transcript_revision but a stale graph_revision (0 < 5).
        let outcome = tracker.build_viewport_buffer_push_envelope_for_session(
            runtime_snapshot,
            "session-graph",
            SessionGraphRevision::new(0, 7, 1),
            &projection_registry,
            &transcript_projection_registry,
            Some(720),
            None,
            None,
            None,
            0,
        );

        let envelope = outcome.expect("stale graph revision must resync, not reject");
        match envelope.payload {
            SessionStatePayload::ViewportBufferPush { push } => {
                assert_eq!(
                    push.graph_revision.graph_revision, 5,
                    "resynced buffer must echo the current canonical graph revision"
                );
                assert_eq!(push.graph_revision.transcript_revision, 7);
            }
            other => panic!("expected viewport buffer push payload, got {other:?}"),
        }
    }

    #[test]
    fn buffer_builder_requires_projection_session_even_when_transcript_present() {
        let tracker = BufferEmissionTracker::new(ViewportLedger::new());
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();

        // Transcript snapshot is present and revision-aligned, but the projection
        // registry has no session snapshot for this id. The builder must miss as
        // SessionNotAttached rather than fabricate an empty session.
        transcript_projection_registry.restore_session_snapshot(
            "session-missing-projection".to_string(),
            TranscriptSnapshot {
                revision: 3,
                entries: Vec::new(),
            },
        );

        let outcome = tracker.build_viewport_buffer_push_envelope_for_session(
            SessionGraphRuntimeSnapshot::default(),
            "session-missing-projection",
            SessionGraphRevision::new(0, 3, 1),
            &projection_registry,
            &transcript_projection_registry,
            Some(720),
            None,
            None,
            None,
            0,
        );

        assert_eq!(
            outcome.unwrap_err(),
            VisibleTranscriptWindowMiss::SessionNotAttached
        );
    }

    /// Exercises the documented lock order (`buffer_emissions` then `viewports`)
    /// under concurrent buffer emission + height confirmation + scroll intent.
    /// A deadlock here means an inverted acquisition path was introduced.
    #[test]
    fn buffer_emission_and_height_confirmation_concurrent_interleave_completes_without_deadlock(
    ) {
        use std::sync::{Arc, Barrier};
        use std::time::{Duration, Instant};

        let tracker = Arc::new(BufferEmissionTracker::new(ViewportLedger::new()));
        let projection_registry = Arc::new(ProjectionRegistry::new());
        let transcript_projection_registry = Arc::new(TranscriptProjectionRegistry::new());
        let session_id = "lock-order-concurrent";
        let revision = seed_buffer_emission_session(
            &projection_registry,
            &transcript_projection_registry,
            session_id,
            5,
        );

        let _ = tracker
            .build_or_advance_viewport_buffer_envelope(
                SessionGraphRuntimeSnapshot::default(),
                session_id,
                revision,
                &projection_registry,
                &transcript_projection_registry,
                Some(720),
                None,
                None,
                None,
                false,
            )
            .expect("prime emission must not error")
            .expect("prime push must emit");

        let barrier = Arc::new(Barrier::new(12));
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut handles = Vec::new();

        for round in 0..12 {
            let reg = Arc::clone(&tracker);
            let proj = Arc::clone(&projection_registry);
            let tx = Arc::clone(&transcript_projection_registry);
            let b = Arc::clone(&barrier);
            let sid = session_id.to_string();
            handles.push(std::thread::spawn(move || {
                b.wait();
                if round % 3 == 0 {
                    let _ = reg.build_or_advance_viewport_buffer_envelope(
                        SessionGraphRuntimeSnapshot::default(),
                        &sid,
                        revision,
                        &proj,
                        &tx,
                        Some(720),
                        None,
                        Some(TranscriptViewportHeightConfirmation {
                            row_id: canonical_assistant_entry_id_for_buffer_seed_index(2),
                            row_version: format!("stale-v-{round}"),
                            height_px: 400,
                            viewport_offset_px: Some(800),
                        }),
                        None,
                        false,
                    );
                } else if round % 3 == 1 {
                    let _ = reg.build_or_advance_viewport_buffer_envelope(
                        SessionGraphRuntimeSnapshot::default(),
                        &sid,
                        revision,
                        &proj,
                        &tx,
                        Some(720),
                        Some(ScrollIntent::DetachAtOffset { offset_px: 100 }),
                        None,
                        None,
                        false,
                    );
                } else {
                    let _ = reg.build_or_advance_viewport_buffer_envelope(
                        SessionGraphRuntimeSnapshot::default(),
                        &sid,
                        revision,
                        &proj,
                        &tx,
                        Some(720),
                        None,
                        None,
                        None,
                        false,
                    );
                }
            }));
        }

        for handle in handles {
            handle.join().expect("concurrent buffer thread panicked");
            assert!(
                Instant::now() < deadline,
                "buffer_emissions→viewports lock order must not deadlock under interleaving"
            );
        }
    }
    fn delta_row(index: usize) -> TranscriptViewportRow {
        TranscriptViewportRow {
            row_id: format!("transcript:row-{index}"),
            source_entry_id: format!("row-{index}"),
            kind: TranscriptViewportRowKind::AssistantText,
            version: format!("v-{index}"),
            anchor_eligible: true,
            active_streaming_tail: None,
            operation_links: Vec::new(),
            interaction_links: Vec::new(),
            content: TranscriptViewportRowContent::Transcript {
                role: TranscriptEntryRole::Assistant,
                segments: Vec::new(),
            },
        }
    }

    const DELTA_ROW_HEIGHT_PX: u64 = 100;

    fn delta_layout(row_count: usize) -> Vec<TranscriptViewportRow> {
        (0..row_count).map(delta_row).collect()
    }

    fn delta_slice(
        start: usize,
        end: usize,
        layout_row_count: usize,
        viewport_revision: i64,
    ) -> ViewportBufferSlice {
        let offsets_px = (start..end)
            .map(|i| i as u64 * DELTA_ROW_HEIGHT_PX)
            .collect();
        ViewportBufferSlice {
            buffer_start_index: start,
            buffer_end_index: end,
            layout_row_count,
            offsets_px,
            total_height_px: layout_row_count as u64 * DELTA_ROW_HEIGHT_PX,
            buffer_end_offset_px: end as u64 * DELTA_ROW_HEIGHT_PX,
            viewport_offset_px: start as u64 * DELTA_ROW_HEIGHT_PX,
            mode: ViewportMode::FollowingTail,
            viewport_revision,
        }
    }

    fn row_ids(indices: std::ops::Range<usize>) -> Vec<String> {
        indices.map(|i| format!("transcript:row-{i}")).collect()
    }

    fn row_versions(indices: std::ops::Range<usize>) -> Vec<String> {
        indices.map(|i| format!("v-{i}")).collect()
    }
    #[test]
    fn compute_buffer_delta_scroll_down_appends_and_removes_top() {
        let layout = delta_layout(20);
        let prev_ids = row_ids(2..6);
        let slice = delta_slice(4, 8, 20, 5);

        let delta = compute_buffer_delta(
            "session-1",
            SessionGraphRevision::new(3, 3, 3),
            7,
            4,
            2,
            &prev_ids,
            &layout,
            &slice,
            None,
            Some(400),
        );

        assert_eq!(delta.emission_seq, 7);
        assert_eq!(delta.from_viewport_revision, 4);
        assert_eq!(delta.to_viewport_revision, 5);
        assert!(delta.prepended_rows.is_empty());
        assert_eq!(
            delta
                .appended_rows
                .iter()
                .map(|row| row.row_id.as_str())
                .collect::<Vec<_>>(),
            vec!["transcript:row-6", "transcript:row-7"]
        );
        assert_eq!(delta.appended_offsets_px, vec![600, 700]);
        assert_eq!(
            delta.removed_row_ids,
            vec![
                "transcript:row-2".to_string(),
                "transcript:row-3".to_string()
            ]
        );
        assert_eq!(delta.layout_row_count, 20);
        assert_eq!(delta.buffer_end_offset_px, 800);
        assert_eq!(delta.scroll_top_target, Some(400));
    }

    #[test]
    fn compute_buffer_delta_scroll_up_prepends_and_removes_bottom() {
        let layout = delta_layout(30);
        let prev_ids = row_ids(10..14);
        let slice = delta_slice(8, 12, 30, 2);

        let delta = compute_buffer_delta(
            "session-1",
            SessionGraphRevision::new(1, 1, 1),
            12,
            1,
            10,
            &prev_ids,
            &layout,
            &slice,
            None,
            None,
        );

        assert_eq!(delta.emission_seq, 12);
        assert_eq!(
            delta
                .prepended_rows
                .iter()
                .map(|row| row.row_id.as_str())
                .collect::<Vec<_>>(),
            vec!["transcript:row-8", "transcript:row-9"]
        );
        assert_eq!(delta.prepended_offsets_px, vec![800, 900]);
        assert!(delta.appended_rows.is_empty());
        assert_eq!(
            delta.removed_row_ids,
            vec![
                "transcript:row-12".to_string(),
                "transcript:row-13".to_string()
            ]
        );
    }

    #[test]
    fn compute_buffer_delta_streaming_tail_appends_without_removals() {
        let layout = delta_layout(7);
        let prev_ids = row_ids(0..5);
        let slice = delta_slice(0, 7, 7, 2);

        let delta = compute_buffer_delta(
            "session-1",
            SessionGraphRevision::new(1, 1, 1),
            3,
            1,
            0,
            &prev_ids,
            &layout,
            &slice,
            None,
            None,
        );

        assert!(delta.prepended_rows.is_empty());
        assert!(delta.removed_row_ids.is_empty());
        assert_eq!(delta.emission_seq, 3);
        assert_eq!(
            delta
                .appended_rows
                .iter()
                .map(|row| row.row_id.as_str())
                .collect::<Vec<_>>(),
            vec!["transcript:row-5", "transcript:row-6"]
        );
        assert_eq!(delta.appended_offsets_px, vec![500, 600]);
        assert_eq!(delta.layout_row_count, 7);
    }

    #[test]
    fn compute_buffer_delta_no_movement_is_empty() {
        let layout = delta_layout(5);
        let prev_ids = row_ids(0..5);
        let slice = delta_slice(0, 5, 5, 9);

        let delta = compute_buffer_delta(
            "session-1",
            SessionGraphRevision::new(1, 1, 1),
            42,
            8,
            0,
            &prev_ids,
            &layout,
            &slice,
            None,
            None,
        );

        assert_eq!(delta.emission_seq, 42);
        assert!(delta.prepended_rows.is_empty());
        assert!(delta.appended_rows.is_empty());
        assert!(delta.removed_row_ids.is_empty());
        assert_eq!(delta.from_viewport_revision, 8);
        assert_eq!(delta.to_viewport_revision, 9);
    }

    #[test]
    fn buffer_delta_identity_consistent_accepts_clean_tail_append() {
        // Streaming tail-append: prev buffer [row-0..row-4], current grows to 7
        // rows, window [0,7). Survivors keep their ids and versions, so an index
        // delta is sound.
        let layout = delta_layout(7);
        let prev_ids = row_ids(0..5);
        let prev_versions = row_versions(0..5);
        let slice = delta_slice(0, 7, 7, 2);

        assert!(buffer_delta_is_identity_consistent(
            0,
            &prev_ids,
            &prev_versions,
            &layout,
            &slice
        ));
    }

    #[test]
    fn buffer_delta_identity_inconsistent_on_mid_buffer_insert() {
        // A row is inserted mid-buffer between emissions (e.g. an operation
        // resolves) and the tail-follow window shifts. The index-window delta
        // would keep `row-4` as a survivor AND re-append it, duplicating a
        // row_id in the consumer's spliced buffer. The producer must detect the
        // identity drift and fall back to a fresh push.
        let prev_ids = row_ids(0..5); // [row-0, row-1, row-2, row-3, row-4]
        let prev_versions = row_versions(0..5);
        let current = vec![
            delta_row(0),
            delta_row(99), // inserted mid-buffer
            delta_row(1),
            delta_row(2),
            delta_row(3),
            delta_row(4),
        ];
        // Window slid to [1,6): current buffer ids [row-99, row-1, row-2, row-3, row-4].
        let slice = delta_slice(1, 6, 6, 2);

        assert!(!buffer_delta_is_identity_consistent(
            0,
            &prev_ids,
            &prev_versions,
            &current,
            &slice
        ));
    }

    #[test]
    fn buffer_delta_identity_inconsistent_on_survivor_version_change() {
        // A survivor keeps its row_id but its content changed (new version). An
        // index delta would not re-send it, so the consumer would render stale
        // content. The producer must fall back to a fresh push.
        let layout = delta_layout(7);
        let prev_ids = row_ids(0..5);
        let mut prev_versions = row_versions(0..5);
        prev_versions[2] = "stale-version".to_string();
        let slice = delta_slice(0, 7, 7, 2);

        assert!(!buffer_delta_is_identity_consistent(
            0,
            &prev_ids,
            &prev_versions,
            &layout,
            &slice
        ));
    }


    #[test]
    fn classify_buffer_transition_no_prior_is_fresh_push() {
        let slice = delta_slice(4, 8, 20, 5);
        assert_eq!(
            classify_buffer_transition(None, &slice),
            BufferEmission::FreshPush
        );
    }

    #[test]
    fn classify_buffer_transition_identical_window_is_noop() {
        let slice = delta_slice(4, 8, 20, 5);
        assert_eq!(
            classify_buffer_transition(Some((4, 4)), &slice),
            BufferEmission::NoOp
        );
    }

    #[test]
    fn classify_buffer_transition_overlapping_slide_is_delta() {
        let slice = delta_slice(4, 8, 20, 5);
        // Scroll down: prev [2,6) overlaps new [4,8).
        assert_eq!(
            classify_buffer_transition(Some((2, 4)), &slice),
            BufferEmission::Delta
        );
        // Streaming tail append: prev [4,7) overlaps new [4,8) (same start, grown end).
        assert_eq!(
            classify_buffer_transition(Some((4, 3)), &slice),
            BufferEmission::Delta
        );
    }

    #[test]
    fn classify_buffer_transition_disjoint_jump_is_fresh_push() {
        let slice = delta_slice(40, 44, 100, 7);
        // Prior buffer far above: prev [2,6) shares no rows with new [40,44).
        assert_eq!(
            classify_buffer_transition(Some((2, 4)), &slice),
            BufferEmission::FreshPush
        );
        // Adjacent-but-touching (prev_end == new_start) is still disjoint: prev
        // [36,40) and new [40,44) share no row index.
        assert_eq!(
            classify_buffer_transition(Some((36, 4)), &slice),
            BufferEmission::FreshPush
        );
    }
}
