use super::*;

pub(crate) async fn publish_direct_session_update<R: tauri::Runtime>(
    app: &AppHandle<R>,
    update: SessionUpdate,
) -> bool {
    let Some(hub_state) = app.try_state::<Arc<AcpEventHubState>>() else {
        tracing::warn!(
            session_id = update.session_id(),
            "ACP event hub unavailable; direct session update dropped"
        );
        return false;
    };

    let Some(projection_registry) = app.try_state::<Arc<ProjectionRegistry>>() else {
        tracing::warn!(
            session_id = update.session_id(),
            "Projection registry unavailable; direct session update dropped"
        );
        return false;
    };
    let Some(runtime_graph_registry) = app.try_state::<Arc<SessionGraphRuntimeRegistry>>() else {
        tracing::warn!(
            session_id = update.session_id(),
            "Runtime graph registry unavailable; direct session update dropped"
        );
        return false;
    };
    let Some(transcript_projection_registry) = app.try_state::<Arc<TranscriptProjectionRegistry>>()
    else {
        tracing::warn!(
            session_id = update.session_id(),
            "Transcript projection registry unavailable; direct session update dropped"
        );
        return false;
    };
    let Some(journal_write_lock_registry) = app.try_state::<Arc<JournalWriteLockRegistry>>() else {
        tracing::warn!(
            session_id = update.session_id(),
            "Journal write lock registry unavailable; direct session update dropped"
        );
        return false;
    };

    let update = stamp_agent_message_chunk_timestamp(runtime_graph_registry.inner(), update);
    let Some(session_id) = update.session_id() else {
        tracing::warn!("Direct session update without session id rejected");
        return false;
    };
    let Some(pre_reservation_event_buffer) = app.try_state::<Arc<PreReservationEventBuffer>>()
    else {
        tracing::warn!(
            session_id,
            "Pre-reservation event buffer unavailable; direct session update dropped"
        );
        return false;
    };
    let lifecycle_exists = runtime_graph_registry
        .inner()
        .supervisor()
        .snapshot_for_session(session_id)
        .is_some();
    match pre_reservation_event_buffer
        .inner()
        .decide_ingress(session_id, lifecycle_exists, &update)
    {
        PreReservationIngressDecision::Allow => {}
        PreReservationIngressDecision::Buffered => {
            tracing::debug!(
                session_id,
                "Direct session update deferred behind pre-reservation drain"
            );
            return true;
        }
        PreReservationIngressDecision::Rejected => {
            tracing::warn!(
                session_id,
                "Direct session update rejected before lifecycle reservation"
            );
            return false;
        }
    }

    let hub = hub_state.inner().clone();
    let db = app.try_state::<DbConn>().map(|state| state.inner().clone());

    // Per-session journal write lock: serializes journal allocation, projection
    // apply, envelope build, and event publish for the same session across
    // concurrent Tokio tasks. Without this, the command-handler task (this
    // function) and the streaming-bridge drain task can race on
    // `SessionEventWriter::commit_session_update`'s sequence
    // allocation and on `transcript_projection.apply_session_update`, producing
    // out-of-order entry list updates. Concurrent sessions remain parallel
    // because the lock is keyed by `session_id`. Plan: sub-task 1a in
    // `docs/plans/2026-05-03-001-refactor-canonical-only-entry-list-plan.md`.
    let session_lock = journal_write_lock_registry.inner().lock_for(session_id);
    let _journal_guard = session_lock.lock().await;

    let event = AcpUiEvent::session_update(update);

    let dispatch_effects = persist_dispatch_event(
        db.as_ref(),
        &event,
        projection_registry.inner(),
        runtime_graph_registry.inner(),
        transcript_projection_registry.inner(),
    )
    .await;

    if should_publish_raw_event(&event, &dispatch_effects) {
        if let Err(error) = event.publish_direct(&hub) {
            tracing::error!(
                error = %error,
                session_id = ?event.session_id,
                event_name = event.event_name,
                "Failed to publish direct ACP session update"
            );
            return false;
        }
    }

    if let Some(envelope) = dispatch_effects.session_state_envelope {
        let mut envelopes = vec![envelope];
        envelopes.extend(dispatch_effects.additional_session_state_envelopes);
        for envelope in envelopes {
            let Some(session_state_event) = AcpUiEvent::session_state_envelope(&envelope) else {
                continue;
            };
            if let Err(error) = session_state_event.publish_direct(&hub) {
                tracing::error!(
                    error = %error,
                    session_id = %envelope.session_id,
                    graph_revision = envelope.graph_revision,
                    last_event_seq = envelope.last_event_seq,
                    "Failed to publish direct ACP session state envelope"
                );
                return false;
            }
        }
    }

    true
}
