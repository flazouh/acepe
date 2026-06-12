use super::*;

#[derive(Debug, Default)]
pub(super) struct DispatchPersistenceEffects {
    pub(super) session_state_envelope: Option<SessionStateEnvelope>,
    pub(super) additional_session_state_envelopes: Vec<SessionStateEnvelope>,
}

impl DispatchPersistenceEffects {
    fn has_session_state_envelope(&self) -> bool {
        self.session_state_envelope.is_some() || !self.additional_session_state_envelopes.is_empty()
    }
}

pub(super) fn should_publish_raw_event(
    event: &AcpUiEvent,
    effects: &DispatchPersistenceEffects,
) -> bool {
    if !effects.has_session_state_envelope() {
        return true;
    }

    !matches!(
        &event.payload,
        AcpUiEventPayload::SessionUpdate(update)
            if matches!(
                update.as_ref(),
                SessionUpdate::AgentMessageChunk { .. } | SessionUpdate::AgentThoughtChunk { .. }
            )
    )
}

pub(super) async fn persist_dispatch_event(
    db: Option<&DbConn>,
    event: &AcpUiEvent,
    projection_registry: &ProjectionRegistry,
    runtime_graph_registry: &SessionGraphRuntimeRegistry,
    transcript_projection_registry: &TranscriptProjectionRegistry,
) -> DispatchPersistenceEffects {
    let Some(db) = db else {
        return DispatchPersistenceEffects::default();
    };
    let Some(session_id) = event.session_id.as_deref() else {
        return DispatchPersistenceEffects::default();
    };
    let AcpUiEventPayload::SessionUpdate(update) = &event.payload else {
        return DispatchPersistenceEffects::default();
    };
    if runtime_graph_registry
        .supervisor()
        .snapshot_for_session(session_id)
        .is_none()
    {
        tracing::warn!(
            session_id,
            event_name = event.event_name,
            "Skipping session update persistence before lifecycle reservation"
        );
        return DispatchPersistenceEffects::default();
    }

    let previous_runtime_snapshot = runtime_graph_registry.snapshot_for_session(session_id);
    let previous_transcript_revision = transcript_projection_registry
        .snapshot_for_session(session_id)
        .map(|snapshot| snapshot.revision)
        .unwrap_or(0);

    match SessionJournalEventRepository::append_session_update(db, session_id, update.as_ref())
        .await
    {
        Ok(Some(record)) => {
            let checkpoint = match runtime_graph_registry
                .supervisor()
                .record_session_update(
                    db,
                    projection_registry,
                    session_id,
                    record.event_seq,
                    update.as_ref(),
                )
                .await
            {
                Ok(checkpoint) => checkpoint,
                Err(error) => {
                    tracing::error!(
                        error = %error,
                        session_id,
                        event_name = event.event_name,
                        "Failed to persist supervisor-owned runtime checkpoint"
                    );
                    return DispatchPersistenceEffects::default();
                }
            };
            projection_registry.apply_session_update_at_event_seq(
                session_id,
                record.event_seq,
                update.as_ref(),
            );
            let transcript_delta = transcript_projection_registry
                .apply_session_update(record.event_seq, update.as_ref());
            let transcript_revision = transcript_projection_registry
                .snapshot_for_session(session_id)
                .map(|snapshot| snapshot.revision)
                .unwrap_or(0);
            let revision = SessionGraphRevision::new(
                checkpoint.graph_revision,
                transcript_revision,
                record.event_seq,
            );
            let request = LiveSessionStateEnvelopeRequest {
                db,
                session_id,
                update: update.as_ref(),
                previous_revision: SessionGraphRevision::new(
                    if previous_runtime_snapshot.graph_revision > 0 {
                        previous_runtime_snapshot.graph_revision
                    } else {
                        record.event_seq.saturating_sub(1)
                    },
                    previous_transcript_revision,
                    record.event_seq.saturating_sub(1),
                ),
                revision,
                projection_registry,
                transcript_projection_registry,
                transcript_delta: transcript_delta.as_ref(),
            };
            let session_state_envelope = runtime_graph_registry
                .build_live_session_state_envelope(request)
                .await;
            let additional_session_state_envelopes =
                runtime_graph_registry.build_additional_session_state_envelopes(request);
            DispatchPersistenceEffects {
                session_state_envelope,
                additional_session_state_envelopes,
            }
        }
        Ok(None) => {
            let synthetic_event_seq = previous_runtime_snapshot
                .graph_revision
                .max(previous_transcript_revision)
                .saturating_add(1);
            let graph_revision = runtime_graph_registry.apply_session_update_with_graph_seed(
                session_id,
                synthetic_event_seq.saturating_sub(1),
                update.as_ref(),
            );
            projection_registry.apply_session_update_at_event_seq(
                session_id,
                synthetic_event_seq,
                update.as_ref(),
            );
            // Transcript revision lives in its own monotonic counter and must
            // advance by exactly +1 per transcript-bearing event. Deriving the
            // seq from `synthetic_event_seq` (which tracks graph_revision)
            // inflates transcript_revision past real transcript progress and
            // breaks the consumer-side `transcript_revision <= last_event_seq`
            // invariant — see
            // `synthetic_event_seq_path_must_not_inflate_transcript_revision_past_real_progress`.
            let transcript_event_seq = previous_transcript_revision.saturating_add(1);
            let transcript_delta = transcript_projection_registry
                .apply_session_update(transcript_event_seq, update.as_ref());
            let transcript_revision = transcript_projection_registry
                .snapshot_for_session(session_id)
                .map(|snapshot| snapshot.revision)
                .unwrap_or(previous_transcript_revision);
            if transcript_delta.is_some() {
                if let SessionUpdate::ToolCall { tool_call, .. } = update.as_ref() {
                    if let Some(transcript_snapshot) =
                        transcript_projection_registry.snapshot_for_session(session_id)
                    {
                        if let Some(entry_id) = transcript_snapshot
                            .entries
                            .iter()
                            .rev()
                            .find(|entry| {
                                entry.role
                                    == crate::acp::transcript_projection::TranscriptEntryRole::Tool
                            })
                            .map(|entry| entry.entry_id.clone())
                        {
                            projection_registry.relink_tool_call_to_transcript_entry(
                                session_id,
                                &tool_call.id,
                                &entry_id,
                            );
                        }
                    }
                }
            }
            let revision =
                SessionGraphRevision::new(graph_revision, transcript_revision, synthetic_event_seq);
            let request = LiveSessionStateEnvelopeRequest {
                db,
                session_id,
                update: update.as_ref(),
                previous_revision: SessionGraphRevision::new(
                    if previous_runtime_snapshot.graph_revision > 0 {
                        previous_runtime_snapshot.graph_revision
                    } else {
                        synthetic_event_seq.saturating_sub(1)
                    },
                    previous_transcript_revision,
                    synthetic_event_seq.saturating_sub(1),
                ),
                revision,
                projection_registry,
                transcript_projection_registry,
                transcript_delta: transcript_delta.as_ref(),
            };
            let session_state_envelope = runtime_graph_registry
                .build_live_session_state_envelope(request)
                .await;
            let additional_session_state_envelopes =
                runtime_graph_registry.build_additional_session_state_envelopes(request);
            DispatchPersistenceEffects {
                session_state_envelope,
                additional_session_state_envelopes,
            }
        }
        Err(error) => {
            tracing::error!(
                error = %error,
                session_id,
                event_name = event.event_name,
                "Failed to persist ACP session update into session journal"
            );
            DispatchPersistenceEffects::default()
        }
    }
}
