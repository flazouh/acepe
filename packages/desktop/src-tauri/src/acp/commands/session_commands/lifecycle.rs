use super::super::*;
use super::*;

pub(crate) async fn emit_lifecycle_event<R: tauri::Runtime>(
    app: &AppHandle<R>,
    hub: &Option<Arc<AcpEventHubState>>,
    update: crate::acp::session_update::SessionUpdate,
    session_id: &str,
) {
    let Some(hub) = hub else {
        tracing::warn!(session_id = %session_id, "Event hub unavailable, lifecycle event dropped");
        return;
    };
    let runtime_registry = app.try_state::<Arc<SessionGraphRuntimeRegistry>>();
    let projection_registry = app.state::<Arc<ProjectionRegistry>>();
    let base_revision = match load_live_session_graph_revision(
        app.state::<DbConn>().inner(),
        app.state::<Arc<TranscriptProjectionRegistry>>().inner(),
        runtime_registry
            .as_ref()
            .map(|registry| registry.inner().as_ref()),
        session_id,
    )
    .await
    {
        Ok(revision) => revision,
        Err(error) => {
            tracing::error!(
                session_id = %session_id,
                error = %error,
                "Failed to determine live session graph revision for lifecycle envelope"
            );
            return;
        }
    };
    if let Err(error) = app
        .state::<Arc<crate::acp::lifecycle::SessionSupervisor>>()
        .inner()
        .transition_lifecycle(
            app.state::<DbConn>().inner(),
            projection_registry.inner(),
            session_id,
            &update,
        )
        .await
    {
        tracing::error!(
            session_id = %session_id,
            error = %error,
            "Failed to persist supervisor-owned lifecycle transition"
        );
        return;
    }
    let revision = match load_live_session_graph_revision(
        app.state::<DbConn>().inner(),
        app.state::<Arc<TranscriptProjectionRegistry>>().inner(),
        runtime_registry
            .as_ref()
            .map(|registry| registry.inner().as_ref()),
        session_id,
    )
    .await
    {
        Ok(revision) => revision,
        Err(error) => {
            tracing::error!(
                session_id = %session_id,
                error = %error,
                "Failed to determine updated live session graph revision for lifecycle envelope"
            );
            return;
        }
    };
    let lifecycle_event =
        crate::acp::ui_event_dispatcher::AcpUiEvent::session_update(update.clone());
    if let Err(error) = lifecycle_event.publish_direct(hub) {
        tracing::error!(
            error = %error,
            session_id = %session_id,
            "Failed to publish direct ACP lifecycle session update"
        );
    }
    if let Some(runtime_registry) = runtime_registry.as_ref() {
        let transcript_projection_registry = app.state::<Arc<TranscriptProjectionRegistry>>();
        if let Some(envelope) = runtime_registry
            .inner()
            .build_live_session_state_envelope(LiveSessionStateEnvelopeRequest {
                db: app.state::<DbConn>().inner(),
                session_id,
                update: &update,
                previous_revision: base_revision,
                revision,
                projection_registry: projection_registry.inner(),
                transcript_projection_registry: transcript_projection_registry.inner(),
                transcript_delta: None,
            })
            .await
        {
            publish_session_state_envelope(hub, envelope);
        }
        for envelope in runtime_registry
            .inner()
            .build_additional_session_state_envelopes(LiveSessionStateEnvelopeRequest {
                db: app.state::<DbConn>().inner(),
                session_id,
                update: &update,
                previous_revision: base_revision,
                revision,
                projection_registry: projection_registry.inner(),
                transcript_projection_registry: transcript_projection_registry.inner(),
                transcript_delta: None,
            })
        {
            publish_session_state_envelope(hub, envelope);
        }
    }
}

/// Emit a Detached lifecycle envelope for a client-driven disconnect.
///
/// Unlike `emit_lifecycle_event` (which is driven by a `SessionUpdate` flowing
/// through the reducer), this path uses `transition_lifecycle_state` to set the
/// canonical lifecycle directly to Detached(reason). It is the GOD-pure
/// replacement for the former TS-side synthetic-detached projection workaround.
pub(crate) async fn emit_detached_lifecycle<R: tauri::Runtime>(
    app: &AppHandle<R>,
    hub: &Option<Arc<AcpEventHubState>>,
    session_id: &str,
    reason: crate::acp::lifecycle::DetachedReason,
) {
    let Some(hub) = hub else {
        tracing::warn!(session_id = %session_id, "Event hub unavailable, detached lifecycle dropped");
        return;
    };
    let supervisor = app.state::<Arc<crate::acp::lifecycle::SessionSupervisor>>();
    let projection_registry = app.state::<Arc<ProjectionRegistry>>();
    let transcript_projection_registry = app.state::<Arc<TranscriptProjectionRegistry>>();
    let runtime_registry = app.try_state::<Arc<SessionGraphRuntimeRegistry>>();
    let db = app.state::<DbConn>();

    if let Err(error) = supervisor
        .inner()
        .transition_lifecycle_state(
            db.inner(),
            projection_registry.inner(),
            session_id,
            crate::acp::lifecycle::LifecycleState::detached(reason),
        )
        .await
    {
        tracing::error!(
            session_id = %session_id,
            error = %error,
            "Failed to persist supervisor-owned detached lifecycle transition"
        );
        return;
    }

    let revision = match load_live_session_graph_revision(
        db.inner(),
        transcript_projection_registry.inner(),
        runtime_registry
            .as_ref()
            .map(|registry| registry.inner().as_ref()),
        session_id,
    )
    .await
    {
        Ok(revision) => revision,
        Err(error) => {
            tracing::error!(
                session_id = %session_id,
                error = %error,
                "Failed to determine session graph revision for detached envelope"
            );
            return;
        }
    };

    if let Some(runtime_registry) = runtime_registry.as_ref() {
        if let Some(envelope) = runtime_registry
            .inner()
            .build_snapshot_envelope_for_session(
                db.inner(),
                session_id,
                revision,
                projection_registry.inner(),
                transcript_projection_registry.inner(),
            )
            .await
        {
            publish_session_state_envelope(hub, envelope);
        }
    }
}

pub(super) async fn load_live_session_graph_revision(
    db: &DbConn,
    transcript_projection_registry: &TranscriptProjectionRegistry,
    runtime_registry: Option<&SessionGraphRuntimeRegistry>,
    session_id: &str,
) -> Result<SessionGraphRevision, SerializableAcpError> {
    let last_event_seq = SessionEventSequenceRepository::last_assigned_event_seq(db, session_id)
        .await
        .map_err(|error| SerializableAcpError::InvalidState {
            message: format!(
                "Failed to determine live session graph revision for session {session_id}: {error}"
            ),
        })?
        .unwrap_or(0);
    let transcript_revision = transcript_projection_registry
        .snapshot_for_session(session_id)
        .map(|snapshot| snapshot.revision)
        .unwrap_or(0);
    let graph_revision = runtime_registry
        .map(|registry| registry.snapshot_for_session(session_id).graph_revision)
        .filter(|revision| *revision > 0)
        .unwrap_or(last_event_seq);
    Ok(SessionGraphRevision::new(
        graph_revision,
        transcript_revision,
        last_event_seq,
    ))
}

pub(crate) fn publish_session_state_envelope(
    hub: &Arc<AcpEventHubState>,
    envelope: SessionStateEnvelope,
) {
    let Some(session_state_event) =
        crate::acp::ui_event_dispatcher::AcpUiEvent::session_state_envelope(&envelope)
    else {
        return;
    };
    if let Err(error) = session_state_event.publish_direct(hub) {
        tracing::error!(
            error = %error,
            session_id = %envelope.session_id,
            graph_revision = envelope.graph_revision,
            last_event_seq = envelope.last_event_seq,
            "Failed to publish direct ACP session state envelope"
        );
    }
}

pub(super) fn replay_buffered_session_state_events(
    hub: &AcpEventHubState,
    session_id: &str,
    frontier_last_event_seq: i64,
    buffered_events: Vec<crate::acp::event_hub::AcpEventEnvelope>,
) {
    let replayable = buffered_events
        .into_iter()
        .filter(|event| event.event_name == "acp-session-state")
        .filter(|event| event.session_id.as_deref() == Some(session_id))
        .filter_map(|event| {
            let envelope =
                serde_json::from_value::<SessionStateEnvelope>(event.payload.clone()).ok()?;
            if envelope.last_event_seq <= frontier_last_event_seq {
                return None;
            }

            if !matches!(
                envelope.payload,
                crate::acp::session_state_engine::protocol::SessionStatePayload::Delta { .. }
            ) {
                return None;
            }

            if let Err(status) = session_state_envelope_byte_budget_status(&envelope) {
                tracing::warn!(
                    session_id = %envelope.session_id,
                    graph_revision = envelope.graph_revision,
                    last_event_seq = envelope.last_event_seq,
                    byte_len = status.byte_len,
                    max_bytes = status.max_bytes,
                    "Skipping oversized buffered session-state delta during open replay"
                );
                return None;
            }

            let payload = serde_json::to_value(&envelope).ok()?;

            Some(crate::acp::event_hub::AcpEventEnvelope { payload, ..event })
        })
        .collect::<Vec<_>>();
    if replayable.is_empty() {
        return;
    }
    hub.replay_buffered_events(replayable);
}

#[cfg(test)]
pub(super) async fn load_transcript_snapshot_for_resume(
    db: &DbConn,
    session_id: &str,
) -> Result<TranscriptSnapshot, SerializableAcpError> {
    load_transcript_snapshot_for_resume_with_app(None, db, session_id).await
}

pub(super) async fn load_transcript_snapshot_for_resume_with_app(
    app: Option<&AppHandle>,
    db: &DbConn,
    session_id: &str,
) -> Result<TranscriptSnapshot, SerializableAcpError> {
    let journal_max = SessionEventSequenceRepository::last_assigned_event_seq(db, session_id)
        .await
        .map_err(|error| SerializableAcpError::InvalidState {
            message: format!(
                "Failed to determine journal cutoff for resumed session {session_id}: {error}"
            ),
        })?;
    let metadata = SessionMetadataRepository::get_by_id(db, session_id)
        .await
        .map_err(|error| SerializableAcpError::InvalidState {
            message: format!(
                "Failed to load session metadata for resumed session {session_id}: {error}"
            ),
        })?;
    let has_metadata = metadata.is_some();
    let replay_context = metadata
        .as_ref()
        .map(|row| {
            SessionMetadataRepository::resolve_existing_session_replay_context_from_metadata(
                session_id,
                Some(row),
                SessionCompatibilityInput::default(),
            )
        })
        .transpose()
        .map_err(|error| SerializableAcpError::InvalidState {
            message: format!(
                "Failed to resolve replay context for resumed session {session_id}: {error}"
            ),
        })?;
    if let Some(replay_context) = replay_context.as_ref() {
        let serialized_events = SessionJournalEventRepository::list_serialized(db, session_id)
            .await
            .map_err(|error| SerializableAcpError::InvalidState {
                message: format!(
                    "Failed to load local transcript journal for resumed session {session_id}: {error}"
                ),
            })?;
        let journal_events =
            crate::acp::session_journal::decode_serialized_events(replay_context, serialized_events)
                .map_err(|error| SerializableAcpError::InvalidState {
                    message: format!(
                        "Failed to decode local transcript journal for resumed session {session_id}: {error}"
                    ),
                })?;
        if let Some(transcript_snapshot) =
            crate::acp::session_journal::rebuild_completed_local_transcript_snapshot(
                replay_context,
                &journal_events,
            )
        {
            return Ok(transcript_snapshot);
        }
    }
    if has_metadata && journal_max == Some(1) {
        let first_event = crate::db::entities::session_journal_event::Entity::find()
            .filter(crate::db::entities::session_journal_event::Column::SessionId.eq(session_id))
            .filter(crate::db::entities::session_journal_event::Column::EventSeq.eq(1))
            .one(db)
            .await
            .map_err(|error| SerializableAcpError::InvalidState {
                message: format!(
                    "Failed to inspect journal events for resumed session {session_id}: {error}"
                ),
            })?;
        if first_event
            .as_ref()
            .is_some_and(|event| event.event_kind == "materialization_barrier")
        {
            return Ok(TranscriptSnapshot::from_stored_entries(1, &[]));
        }
    }
    if let Some(app) = app {
        if let Some(replay_context) = replay_context.as_ref() {
            if let Some(provider_snapshot) =
                crate::acp::session_restore::load_provider_owned_session_snapshot(
                    app.clone(),
                    replay_context,
                )
                .await
                .map_err(SerializableAcpError::from)?
            {
                let materialized = materialized_thread_snapshot_from_provider_fold_first(
                    session_id,
                    replay_context,
                    &provider_snapshot,
                    journal_max.unwrap_or(0),
                );
                return Ok(materialized.transcript_snapshot);
            }
        }
    }
    if metadata.is_some() {
        return Ok(TranscriptSnapshot::from_stored_entries(
            journal_max.unwrap_or(0),
            &[],
        ));
    }

    Err(SerializableAcpError::InvalidState {
        message: format!("Missing canonical transcript snapshot for resumed session {session_id}"),
    })
}
