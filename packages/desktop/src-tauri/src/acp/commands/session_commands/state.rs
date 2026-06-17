use super::super::*;
use super::*;

#[tauri::command]
#[specta::specta]
pub async fn acp_get_session_state(
    app: AppHandle,
    session_id: String,
) -> CommandResult<SessionStateEnvelope> {
    expected_acp_command_result("acp_get_session_state", async {
        let lookup = load_session_projection_lookup(&app, &session_id).await?;
        let db = app.state::<DbConn>();
        let transcript_registry = app.state::<Arc<TranscriptProjectionRegistry>>();
        let canonical_session_id = lookup
            .replay_context
            .as_ref()
            .map(|context| context.local_session_id.clone())
            .unwrap_or_else(|| session_id.clone());
        let canonical_metadata = if canonical_session_id == session_id {
            lookup.metadata.clone()
        } else {
            SessionMetadataRepository::get_by_id(db.inner(), &canonical_session_id)
                .await
                .map_err(|error| SerializableAcpError::InvalidState {
                    message: format!(
                        "Failed to load session metadata for state lookup {canonical_session_id}: {error}"
                    ),
                })?
        };
        let descriptor = canonical_metadata.as_ref().map(SessionMetadataRow::descriptor_facts);
        let materialized_transcript_snapshot = lookup.transcript_snapshot.clone();
        let SessionProjectionSnapshot {
            session,
            operations: raw_operations,
            interactions: raw_interactions,
            runtime: _,
        } = lookup.projection;
        let runtime_snapshot = runtime_snapshot_for_refresh(
            app.try_state::<Arc<SessionGraphRuntimeRegistry>>()
                .map(|registry| registry.inner().as_ref()),
            &canonical_session_id,
        );
        let revision = load_live_session_graph_revision(
            db.inner(),
            transcript_registry.inner().as_ref(),
            app.try_state::<Arc<SessionGraphRuntimeRegistry>>()
                .map(|registry| registry.inner().as_ref()),
            &canonical_session_id,
        )
        .await?;
        let last_event_seq = revision.last_event_seq;
        let transcript_snapshot = if let Some(snapshot) = materialized_transcript_snapshot {
            snapshot
        } else {
            load_transcript_snapshot_for_state_lookup_with_app(
                Some(&app),
                db.inner(),
                transcript_registry.inner().as_ref(),
                &canonical_session_id,
                &session_id,
                lookup.replay_context.as_ref(),
                last_event_seq,
            )
            .await?
        };
        let projection_session = session.as_ref();
        let agent_id = lookup
            .replay_context
            .as_ref()
            .map(|context| context.agent_id.clone())
            .or_else(|| descriptor.as_ref().and_then(|facts| facts.agent_id.clone()))
            .or_else(|| projection_session.and_then(|session| session.agent_id.clone()))
            .unwrap_or(CanonicalAgentId::ClaudeCode);
        let project_path = lookup
            .replay_context
            .as_ref()
            .map(|context| context.project_path.clone())
            .or_else(|| descriptor.as_ref().and_then(|facts| facts.project_path.clone()))
            .unwrap_or_default();
        let worktree_path = lookup
            .replay_context
            .as_ref()
            .and_then(|context| context.worktree_path.clone())
            .or_else(|| descriptor.as_ref().and_then(|facts| facts.worktree_path.clone()));
        let source_path = lookup
            .replay_context
            .as_ref()
            .and_then(|context| context.source_path.clone())
            .or_else(|| descriptor.as_ref().and_then(|facts| facts.source_path.clone()));
        let first_user_title = derive_title_from_transcript_snapshot(&transcript_snapshot);
        let raw_turn_state = projection_session
            .map(|session| session.turn_state.clone())
            .unwrap_or(crate::acp::projections::SessionTurnState::Idle);
        let state_lookup_authority = resolve_state_lookup_authority(
            runtime_snapshot.graph_revision > 0,
            !transcript_snapshot.entries.is_empty(),
            raw_turn_state,
            raw_operations,
            raw_interactions,
            projection_session.and_then(|session| session.active_turn_failure.clone()),
        );
        let operations = state_lookup_authority.operations;
        let interactions = state_lookup_authority.interactions;
        warn_unresolved_tool_rows_in_state_lookup(
            &canonical_session_id,
            &transcript_snapshot,
            &operations,
        );
        let turn_state = state_lookup_authority.turn_state;
        let message_count = projection_session
            .map(|session| session.message_count)
            .unwrap_or(0);
        let active_turn_failure = state_lookup_authority.active_turn_failure;
        let last_terminal_turn_id =
            projection_session.and_then(|session| session.last_terminal_turn_id.clone());
        let lifecycle = runtime_snapshot.lifecycle.clone();
        let capabilities = runtime_snapshot.capabilities.clone();
        let activity = select_session_graph_activity(
            &lifecycle,
            &turn_state,
            &operations,
            &interactions,
            active_turn_failure.as_ref(),
        );
        let active_streaming_tail = select_active_streaming_tail(
            &turn_state,
            &activity,
            &transcript_snapshot,
        );
        let found = SessionOpenFound {
            requested_session_id: session_id.clone(),
            canonical_session_id: canonical_session_id.clone(),
            is_alias: session_id != canonical_session_id,
            last_event_seq,
            graph_revision: revision.graph_revision,
            open_token: String::new(),
            agent_id,
            project_path,
            worktree_path,
            source_path,
            sequence_id: canonical_metadata
                .as_ref()
                .and_then(|metadata| metadata.sequence_id),
            transcript_snapshot,
            session_title: resolve_canonical_session_title(
                canonical_metadata.as_ref(),
                &canonical_session_id,
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
            active_turn_failure,
            last_terminal_turn_id,
        };

        Ok(build_snapshot_envelope(&found))
    }
    .await)
}

#[cfg(test)]
pub(super) async fn load_transcript_snapshot_for_state_lookup(
    db: &DbConn,
    transcript_registry: &TranscriptProjectionRegistry,
    canonical_session_id: &str,
    requested_session_id: &str,
    replay_context: Option<&SessionReplayContext>,
    last_event_seq: i64,
) -> Result<TranscriptSnapshot, SerializableAcpError> {
    load_transcript_snapshot_for_state_lookup_with_app(
        None,
        db,
        transcript_registry,
        canonical_session_id,
        requested_session_id,
        replay_context,
        last_event_seq,
    )
    .await
}

pub(super) async fn load_transcript_snapshot_for_state_lookup_with_app(
    app: Option<&AppHandle>,
    db: &DbConn,
    transcript_registry: &TranscriptProjectionRegistry,
    canonical_session_id: &str,
    requested_session_id: &str,
    replay_context: Option<&SessionReplayContext>,
    last_event_seq: i64,
) -> Result<TranscriptSnapshot, SerializableAcpError> {
    if let Some(snapshot) = transcript_registry
        .snapshot_for_session(canonical_session_id)
        .or_else(|| transcript_registry.snapshot_for_session(requested_session_id))
    {
        return Ok(snapshot);
    }

    if let Some(replay_context) = replay_context {
        let serialized_events =
            SessionJournalEventRepository::list_serialized(db, canonical_session_id)
                .await
                .map_err(|error| SerializableAcpError::InvalidState {
                    message: format!(
					"Failed to load local transcript journal for state lookup {canonical_session_id}: {error}"
				),
                })?;
        let journal_events = crate::acp::session_journal::decode_serialized_events(
            replay_context,
            serialized_events,
        )
        .map_err(|error| SerializableAcpError::InvalidState {
            message: format!(
				"Failed to decode local transcript journal for state lookup {canonical_session_id}: {error}"
			),
        })?;
        if let Some(transcript_snapshot) =
            crate::acp::session_journal::rebuild_local_transcript_snapshot(
                replay_context,
                &journal_events,
            )
        {
            return Ok(transcript_snapshot);
        }

        if let Some(app) = app {
            if let Some(provider_snapshot) =
                crate::acp::session_restore::load_provider_owned_session_snapshot(
                    app.clone(),
                    replay_context,
                )
                .await
                .map_err(SerializableAcpError::from)?
            {
                let materialized = materialize_provider_owned_thread_snapshot(
                    canonical_session_id,
                    Some(replay_context.agent_id.clone()),
                    last_event_seq,
                    &provider_snapshot,
                );
                return Ok(materialized.transcript_snapshot);
            }
        }
    }

    Ok(TranscriptSnapshot::from_stored_entries(last_event_seq, &[]))
}

#[derive(Debug, Clone)]
pub(super) struct SessionProjectionLookup {
    projection: SessionProjectionSnapshot,
    metadata: Option<SessionMetadataRow>,
    replay_context: Option<SessionReplayContext>,
    transcript_snapshot: Option<TranscriptSnapshot>,
}

pub(super) async fn load_session_projection_lookup(
    app: &AppHandle,
    session_id: &str,
) -> Result<SessionProjectionLookup, SerializableAcpError> {
    let projection_registry = app.state::<Arc<ProjectionRegistry>>();
    let runtime_registry = app.state::<Arc<SessionGraphRuntimeRegistry>>();
    let runtime_projection = projection_snapshot_with_runtime(
        projection_registry.inner().as_ref(),
        runtime_registry.inner().as_ref(),
        session_id,
    );
    let db = app.state::<DbConn>();
    let metadata = SessionMetadataRepository::get_by_id(db.inner(), session_id)
        .await
        .map_err(|error| SerializableAcpError::InvalidState {
            message: format!(
                "Failed to load session metadata for projection lookup {session_id}: {error}"
            ),
        })?;
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
            message: format!("Failed to resolve replay context for session {session_id}: {error}"),
        })?;

    if projection_has_graph_state(&runtime_projection) {
        return Ok(SessionProjectionLookup {
            projection: runtime_projection,
            metadata,
            replay_context,
            transcript_snapshot: None,
        });
    }

    let Some(_metadata) = metadata.as_ref() else {
        return Ok(SessionProjectionLookup {
            projection: SessionProjectionSnapshot {
                session: None,
                operations: Vec::new(),
                interactions: Vec::new(),
                runtime: None,
            },
            metadata,
            replay_context,
            transcript_snapshot: None,
        });
    };

    let imported_thread_snapshot =
        crate::acp::session_restore::load_provider_owned_session_snapshot(
            app.clone(),
            replay_context
                .as_ref()
                .expect("replay context should exist with metadata"),
        )
        .await
        .map_err(SerializableAcpError::from)?;

    let Some(imported_thread_snapshot) = imported_thread_snapshot else {
        return Ok(SessionProjectionLookup {
            projection: runtime_projection,
            metadata,
            replay_context,
            transcript_snapshot: None,
        });
    };

    let materialized_import = materialize_provider_owned_thread_snapshot(
        session_id,
        Some(
            replay_context
                .as_ref()
                .expect("replay context should exist with metadata")
                .agent_id
                .clone(),
        ),
        0,
        &imported_thread_snapshot,
    );
    let mut imported_projection = materialized_import.projection;
    imported_projection.runtime = None;

    Ok(SessionProjectionLookup {
        projection: imported_projection,
        metadata,
        replay_context,
        transcript_snapshot: None,
    })
}

pub(super) fn projection_has_graph_state(snapshot: &SessionProjectionSnapshot) -> bool {
    snapshot.session.is_some()
        || !snapshot.operations.is_empty()
        || !snapshot.interactions.is_empty()
}
