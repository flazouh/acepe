use super::super::*;
use super::*;

/// Resume an existing ACP session.
///
/// Fire-and-forget: validates inputs synchronously, then spawns an async task
/// for the heavy work (client creation, protocol resume, history replay).
/// Completion/failure is signaled via `SessionUpdate::ConnectionComplete` /
/// `SessionUpdate::ConnectionFailed` events through the SSE bridge.
#[tauri::command]
#[specta::specta]
pub async fn acp_resume_session(
    app: AppHandle,
    session_id: String,
    cwd: String,
    agent_id: Option<String>,
    launch_mode_id: Option<String>,
    attempt_id: u64,
    open_token: Option<String>,
) -> CommandResult<()> {
    resume_session_with_app_handle_and_worker(
        &app,
        session_id,
        cwd,
        agent_id,
        launch_mode_id,
        attempt_id,
        open_token,
        |app,
         session_id,
         cwd,
         agent_id_enum,
         launch_mode_id,
         resume_descriptor,
         open_token_claim| async move {
            async_resume_session_work(
                &app,
                &session_id,
                cwd,
                agent_id_enum,
                launch_mode_id,
                &resume_descriptor,
                open_token_claim,
            )
            .await
        },
    )
    .await
}

#[allow(
    clippy::too_many_arguments,
    reason = "Resume wiring passes validated inputs into the async work closure; splitting further would obscure the command boundary."
)]
pub(crate) async fn resume_session_with_app_handle_and_worker<R, Work, Fut>(
    app: &AppHandle<R>,
    session_id: String,
    cwd: String,
    agent_id: Option<String>,
    launch_mode_id: Option<String>,
    attempt_id: u64,
    open_token: Option<String>,
    work: Work,
) -> CommandResult<()>
where
    R: tauri::Runtime,
    Work: FnOnce(
            AppHandle<R>,
            String,
            PathBuf,
            CanonicalAgentId,
            Option<String>,
            crate::acp::session_descriptor::SessionDescriptor,
            Option<OpenTokenClaim>,
        ) -> Fut
        + Send
        + 'static,
    Fut: std::future::Future<Output = Result<ResumeSessionResponse, SerializableAcpError>>
        + Send
        + 'static,
{
    expected_acp_command_result("acp_resume_session", async {
        tracing::info!(session_id = %session_id, cwd = %cwd, agent_id = ?agent_id, attempt_id, "acp_resume_session called");

        // --- Synchronous validation (fast, fails the invoke if invalid) ---
        let db = app.state::<DbConn>();
        let session_registry = app.state::<SessionRegistry>();
        let resume_target =
            resolve_resume_session_target(
                db.inner(),
                Some(session_registry.inner()),
                &session_id,
                &cwd,
                agent_id.as_deref(),
            )
            .await?;
        let cwd = validate_session_cwd(
            &resume_target.launch_cwd,
            ProjectAccessReason::SessionResume,
        )?;
        let agent_id_enum = resume_target.descriptor.agent_id.clone();
        let runtime_registry = app.try_state::<Arc<SessionGraphRuntimeRegistry>>();
        let projection_registry = app.try_state::<Arc<ProjectionRegistry>>();
        let open_token_claim =
            claim_open_token_reservation(app, &session_id, open_token.as_deref())?;
        if let (Some(runtime_registry), Some(projection_registry)) =
            (runtime_registry.as_ref(), projection_registry.as_ref())
        {
            let supervisor = app.state::<Arc<SessionSupervisor>>();
            supervisor
                .inner()
                .transition_lifecycle_state(
                    db.inner(),
                    projection_registry.inner(),
                    &session_id,
                    crate::acp::lifecycle::LifecycleState::activating(),
                )
                .await
                .map_err(|error| SerializableAcpError::InvalidState {
                    message: format!(
                        "Failed to persist activating checkpoint for session {session_id}: {error}"
                    ),
                })?;

            let transcript_projection_registry = app.state::<Arc<TranscriptProjectionRegistry>>();
            let revision = load_live_session_graph_revision(
                db.inner(),
                transcript_projection_registry.inner(),
                Some(runtime_registry.inner().as_ref()),
                &session_id,
            )
            .await?;

            if let Some(envelope) = runtime_registry
                .inner()
                .build_snapshot_envelope_for_session(
                    db.inner(),
                    &session_id,
                    revision,
                    projection_registry.inner(),
                    transcript_projection_registry.inner(),
                )
                .await
            {
                publish_session_state_envelope(
                    app.state::<Arc<AcpEventHubState>>().inner(),
                    envelope,
                );
            }
        }

        // Clone values needed for the async task
        let app_clone = app.clone();
        let resume_descriptor = resume_target.descriptor.clone();
        let work = work;
        // Cloned for the error branch so the resume-failure classifier can
        // see the agent identity even after `agent_id_enum` has been moved
        // into `work(...)`.
        let agent_id_for_classifier = agent_id_enum.clone();

        // --- Spawn the async task for heavy work ---
        // We capture the JoinHandle and spawn a follow-up task to catch panics,
        // guaranteeing a lifecycle event is always emitted.
        let session_id_panic = session_id.clone();
        let app_panic = app.clone();
        let handle = tokio::spawn(async move {
            let result = timeout(
                RESUME_SESSION_TIMEOUT,
                work(
                    app_clone.clone(),
                    session_id.clone(),
                    cwd,
                    agent_id_enum,
                    launch_mode_id,
                    resume_descriptor,
                    open_token_claim,
                ),
            )
            .await;

            // Resolve the outcome and emit the lifecycle event
            let hub = app_clone
                .try_state::<Arc<AcpEventHubState>>()
                .map(|s| s.inner().clone());

            match result {
                Ok(Ok(response)) => {
                    let policy_registry = app_clone.state::<Arc<SessionPolicyRegistry>>();
                    let autonomous_enabled = policy_registry.is_autonomous(&session_id);
                    let update = crate::acp::session_update::SessionUpdate::ConnectionComplete {
                        session_id: session_id.clone(),
                        attempt_id,
                        models: response.models,
                        modes: response.modes,
                        available_commands: Some(response.available_commands),
                        config_options: Some(response.config_options),
                        autonomous_enabled: Some(autonomous_enabled),
                    };
                    emit_lifecycle_event(&app_clone, &hub, update, &session_id).await;
                    tracing::info!(
                        session_id = %session_id,
                        attempt_id,
                        "Async resume completed successfully"
                    );
                }
                Ok(Err(error)) => {
                    let classification =
                        crate::acp::resume_failure_classifier::classify_resume_error(
                            &agent_id_for_classifier,
                            &error,
                        );
                    let update = crate::acp::session_update::SessionUpdate::ConnectionFailed {
                        session_id: session_id.clone(),
                        attempt_id,
                        error: error.to_string(),
                        failure_reason: classification.failure_reason,
                    };
                    emit_lifecycle_event(&app_clone, &hub, update, &session_id).await;
                    tracing::error!(
                        session_id = %session_id,
                        attempt_id,
                        error = %error,
                        failure_reason = ?classification.failure_reason,
                        "Async resume failed"
                    );
                }
                Err(_elapsed) => {
                    let update = crate::acp::session_update::SessionUpdate::ConnectionFailed {
                        session_id: session_id.clone(),
                        attempt_id,
                        error: format!(
                            "Session resume timed out after {}s",
                            RESUME_SESSION_TIMEOUT.as_secs()
                        ),
                        // Timeout is transient/transport — explicit, not classified.
                        failure_reason: crate::acp::lifecycle::FailureReason::ResumeFailed,
                    };
                    emit_lifecycle_event(&app_clone, &hub, update, &session_id).await;
                    tracing::error!(
                        session_id = %session_id,
                        attempt_id,
                        timeout_secs = RESUME_SESSION_TIMEOUT.as_secs(),
                        "Async resume timed out"
                    );
                }
            }
        });

        // Panic guard: if the spawned task panics, emit ConnectionFailed so the
        // frontend watchdog never fires.
        tokio::spawn(async move {
            if let Err(join_error) = handle.await {
                tracing::error!(
                    session_id = %session_id_panic,
                    attempt_id,
                    error = %join_error,
                    "Resume session task panicked"
                );
                let hub = app_panic
                    .try_state::<Arc<AcpEventHubState>>()
                    .map(|s| s.inner().clone());
                let update = crate::acp::session_update::SessionUpdate::ConnectionFailed {
                    session_id: session_id_panic.clone(),
                    attempt_id,
                    error: format!("Internal error: resume task panicked: {join_error}"),
                    // Panic is transient by classification (not session-gone),
                    // but explicitly NOT retryable from the user's perspective —
                    // the existing `is_retryable_failure` already treats
                    // `ResumeFailed` as retryable. Keeping the same shape as
                    // the timeout branch preserves prior behavior; if we ever
                    // want panics to be terminal, introduce a new variant.
                    failure_reason: crate::acp::lifecycle::FailureReason::ResumeFailed,
                };
                emit_lifecycle_event(&app_panic, &hub, update, &session_id_panic).await;
            }
        });

        Ok(())
    }
    .await)
}

/// Emit a lifecycle event directly to the event hub, bypassing the rate-limited dispatcher.
/// The heavy async work extracted from `acp_resume_session`.
/// This runs inside `tokio::spawn` under a `RESUME_SESSION_TIMEOUT` deadline.
pub(super) async fn async_resume_session_work(
    app: &AppHandle,
    session_id: &str,
    cwd: PathBuf,
    agent_id_enum: CanonicalAgentId,
    launch_mode_id: Option<String>,
    resume_descriptor: &crate::acp::session_descriptor::SessionDescriptor,
    open_token_claim: Option<OpenTokenClaim>,
) -> Result<ResumeSessionResponse, SerializableAcpError> {
    let registry = app.state::<Arc<AgentRegistry>>();
    let opencode_manager = app.state::<Arc<OpenCodeManagerRegistry>>();
    let session_registry = app.state::<SessionRegistry>();
    let projection_registry = app.state::<Arc<ProjectionRegistry>>();
    let transcript_projection_registry = app.state::<Arc<TranscriptProjectionRegistry>>();
    let db = app.state::<DbConn>();

    let cwd_str = cwd.to_string_lossy().to_string();
    let result = resume_or_create_session_client(
        &session_registry,
        session_id.to_string(),
        cwd_str,
        agent_id_enum.clone(),
        launch_mode_id,
        || {
            let app = app.clone();
            let registry = registry.inner().clone();
            let opencode_manager = opencode_manager.inner().clone();
            let agent_id_enum = agent_id_enum.clone();
            let cwd = cwd.clone();
            async move {
                create_and_initialize_client(
                    &registry,
                    &opencode_manager,
                    agent_id_enum,
                    app,
                    cwd,
                    "resume session",
                )
                .await
            }
        },
    )
    .await?;

    let replay_context: crate::acp::session_descriptor::SessionReplayContext =
        resume_descriptor.clone().into();
    let restored_thread_snapshot =
        crate::history::commands::session_loading::load_provider_owned_session_snapshot(
            app.clone(),
            &replay_context,
        )
        .await
        .map_err(SerializableAcpError::from)?;
    let materialized_restored_snapshot = if let Some(snapshot) = restored_thread_snapshot.as_ref() {
        let last_event_seq = SessionJournalEventRepository::max_event_seq(db.inner(), session_id)
            .await
            .map_err(|error| SerializableAcpError::InvalidState {
                message: format!(
                    "Failed to determine journal cutoff for resumed session {session_id}: {error}"
                ),
            })?
            .unwrap_or(0);
        Some(materialize_provider_owned_thread_snapshot(
            session_id,
            Some(replay_context.agent_id.clone()),
            last_event_seq,
            snapshot,
        ))
    } else {
        None
    };
    let transcript_snapshot = if let Some(materialized) = materialized_restored_snapshot.as_ref() {
        materialized.transcript_snapshot.clone()
    } else {
        load_transcript_snapshot_for_resume_with_app(Some(app), db.inner(), session_id).await?
    };
    transcript_projection_registry
        .restore_session_snapshot(session_id.to_string(), transcript_snapshot);

    if let Some(materialized) = materialized_restored_snapshot {
        let projection = materialized.projection;
        projection_registry.restore_session_projection(projection);
    }
    projection_registry.register_session(session_id.to_string(), agent_id_enum.clone());

    if let Some(claim) = open_token_claim {
        let hub = app.state::<Arc<AcpEventHubState>>();
        replay_buffered_session_state_events(
            hub.inner(),
            session_id,
            claim.last_event_seq,
            claim.buffered_events,
        );
    }

    Ok(result)
}

#[cfg(test)]
mod transcript_buffer_tests {
    use super::replay_buffered_session_state_events;
    use crate::acp::event_hub::{AcpEventEnvelope, AcpEventHubState};
    use crate::acp::session_state_engine::protocol::{SessionStateDelta, SessionStatePayload};
    use crate::acp::session_state_engine::revision::SessionGraphRevision;
    use crate::acp::session_state_engine::selectors::SessionGraphActivity;
    use crate::acp::session_state_engine::SessionStateEnvelope;
    use serde_json::{json, to_value};

    #[test]
    fn replay_buffered_session_state_events_replays_only_matching_post_frontier_envelopes() {
        let hub = AcpEventHubState::new();
        let mut receiver = hub.subscribe();

        replay_buffered_session_state_events(
            &hub,
            "session-1",
            7,
            vec![
                AcpEventEnvelope {
                    seq: 7,
                    event_name: "acp-session-state".to_string(),
                    session_id: Some("session-1".to_string()),
                    payload: to_value(SessionStateEnvelope {
                        session_id: "session-1".to_string(),
                        graph_revision: 7,
                        last_event_seq: 7,
                        payload: SessionStatePayload::Delta {
                            delta: SessionStateDelta {
                                from_revision: SessionGraphRevision::new(6, 6, 6),
                                to_revision: SessionGraphRevision::new(7, 7, 7),
                                activity: SessionGraphActivity::idle(),
                                turn_state: crate::acp::projections::SessionTurnState::Idle,
                                active_turn_failure: None,
                                last_terminal_turn_id: None,
                                active_streaming_tail: None,
                                transcript_operations: vec![],
                                operation_patches: vec![],
                                interaction_patches: vec![],
                                changed_fields: vec!["transcriptSnapshot".to_string()],
                            },
                        },
                    })
                    .expect("serialize envelope"),
                    priority: "normal".to_string(),
                    droppable: false,
                    emitted_at_ms: 1,
                },
                AcpEventEnvelope {
                    seq: 8,
                    event_name: "acp-session-state".to_string(),
                    session_id: Some("session-1".to_string()),
                    payload: to_value(SessionStateEnvelope {
                        session_id: "session-1".to_string(),
                        graph_revision: 8,
                        last_event_seq: 8,
                        payload: SessionStatePayload::Delta {
                            delta: SessionStateDelta {
                                from_revision: SessionGraphRevision::new(7, 7, 7),
                                to_revision: SessionGraphRevision::new(8, 8, 8),
                                activity: SessionGraphActivity::idle(),
                                turn_state: crate::acp::projections::SessionTurnState::Idle,
                                active_turn_failure: None,
                                last_terminal_turn_id: None,
                                active_streaming_tail: None,
                                transcript_operations: vec![],
                                operation_patches: vec![],
                                interaction_patches: vec![],
                                changed_fields: vec!["transcriptSnapshot".to_string()],
                            },
                        },
                    })
                    .expect("serialize envelope"),
                    priority: "normal".to_string(),
                    droppable: false,
                    emitted_at_ms: 2,
                },
                AcpEventEnvelope {
                    seq: 9,
                    event_name: "acp-session-update".to_string(),
                    session_id: Some("session-1".to_string()),
                    payload: json!({ "type": "agentMessageChunk" }),
                    priority: "normal".to_string(),
                    droppable: true,
                    emitted_at_ms: 3,
                },
                AcpEventEnvelope {
                    seq: 10,
                    event_name: "acp-session-state".to_string(),
                    session_id: Some("session-2".to_string()),
                    payload: json!({ "lastEventSeq": 9 }),
                    priority: "normal".to_string(),
                    droppable: false,
                    emitted_at_ms: 4,
                },
            ],
        );

        let replayed = receiver
            .try_recv()
            .expect("matching post-frontier envelope should replay");
        assert_eq!(replayed.seq, 8);
        assert!(
            receiver.try_recv().is_err(),
            "non-matching events must not replay"
        );
    }

    #[test]
    fn replay_buffered_session_state_events_ignores_post_frontier_snapshot_repair_payloads() {
        let hub = AcpEventHubState::new();
        let mut receiver = hub.subscribe();

        replay_buffered_session_state_events(
            &hub,
            "session-1",
            12,
            vec![AcpEventEnvelope {
                seq: 13,
                event_name: "acp-session-state".to_string(),
                session_id: Some("session-1".to_string()),
                payload: to_value(SessionStateEnvelope {
                    session_id: "session-1".to_string(),
                    graph_revision: 13,
                    last_event_seq: 13,
                    payload: SessionStatePayload::Snapshot {
                        graph: Box::new(crate::acp::session_state_engine::SessionStateGraph {
                            requested_session_id: "session-1".to_string(),
                            canonical_session_id: "session-1".to_string(),
                            is_alias: false,
                            agent_id: crate::acp::types::CanonicalAgentId::Codex,
                            project_path: "/repo".to_string(),
                            worktree_path: None,
                            source_path: None,
                            sequence_id: None,
                            revision: SessionGraphRevision::new(13, 12, 13),
                            transcript_snapshot: crate::acp::transcript_projection::TranscriptSnapshot {
                                revision: 12,
                                entries: vec![
                                    crate::acp::transcript_projection::TranscriptEntry {
                                        entry_id: "tool-1".to_string(),
                                        role: crate::acp::transcript_projection::TranscriptEntryRole::Tool,
                                        segments: vec![crate::acp::transcript_projection::TranscriptSegment::Text {
                                            segment_id: "tool-1:segment:0".to_string(),
                                            text: "Read package".to_string(),
                                        }],
                                        attempt_id: None,
                                        timestamp_ms: None,
                                    },
                                    crate::acp::transcript_projection::TranscriptEntry {
                                        entry_id: "tool-2".to_string(),
                                        role: crate::acp::transcript_projection::TranscriptEntryRole::Tool,
                                        segments: vec![crate::acp::transcript_projection::TranscriptSegment::Text {
                                            segment_id: "tool-2:segment:0".to_string(),
                                            text: "Run tests".to_string(),
                                        }],
                                        attempt_id: None,
                                        timestamp_ms: None,
                                    },
                                ],
                            },
                            operations: vec![crate::acp::projections::OperationSnapshot {
                                id: "session-1:tool-2".to_string(),
                                session_id: "session-1".to_string(),
                                tool_call_id: "tool-2".to_string(),
                                name: "Bash".to_string(),
                                kind: Some(crate::acp::session_update::ToolKind::Execute),
                                provider_status: crate::acp::session_update::ToolCallStatus::Completed,
                                title: Some("Run tests".to_string()),
                                arguments: crate::acp::session_update::ToolArguments::Execute {
                                    command: None,
                                },
                                progressive_arguments: None,
                                result: None,
                                command: None,
                                normalized_todos: None,
                                parent_tool_call_id: None,
                                parent_operation_id: None,
                                child_tool_call_ids: vec![],
                                child_operation_ids: vec![],
                                operation_provenance_key: None,
                                operation_state: crate::acp::projections::OperationState::Completed,
                                locations: None,
                                skill_meta: None,
                                normalized_questions: None,
                                question_answer: None,
                                awaiting_plan_approval: false,
                                plan_approval_request_id: None,
                                started_at_ms: None,
                                completed_at_ms: None,
                                source_link: crate::acp::projections::OperationSourceLink::TranscriptLinked {
                                    entry_id: "tool-2".to_string(),
                                },
                                degradation_reason: None,
                            }],
                            interactions: vec![],
                            turn_state: crate::acp::projections::SessionTurnState::Running,
                            message_count: 2,
                            active_streaming_tail: None,
                            active_turn_failure: None,
                            last_terminal_turn_id: None,
                            lifecycle: crate::acp::session_state_engine::selectors::SessionGraphLifecycle::ready(),
                            activity: crate::acp::session_state_engine::selectors::SessionGraphActivity::idle(),
                            capabilities: crate::acp::session_state_engine::selectors::SessionGraphCapabilities::empty(),
                        }),
                    },
                })
                .expect("serialize envelope"),
                priority: "normal".to_string(),
                droppable: false,
                emitted_at_ms: 3,
            }],
        );

        assert!(
            receiver.try_recv().is_err(),
            "historical open replay must not repair or replay full snapshot payloads"
        );
    }

    #[test]
    fn replay_buffered_session_state_events_ignores_oversized_delta_payloads() {
        let hub = AcpEventHubState::new();
        let mut receiver = hub.subscribe();

        replay_buffered_session_state_events(
            &hub,
            "session-1",
            12,
            vec![AcpEventEnvelope {
                seq: 13,
                event_name: "acp-session-state".to_string(),
                session_id: Some("session-1".to_string()),
                payload: to_value(SessionStateEnvelope {
                    session_id: "session-1".to_string(),
                    graph_revision: 13,
                    last_event_seq: 13,
                    payload: SessionStatePayload::Delta {
                        delta: SessionStateDelta {
                            from_revision: SessionGraphRevision::new(12, 12, 12),
                            to_revision: SessionGraphRevision::new(13, 13, 13),
                            activity: SessionGraphActivity::idle(),
                            turn_state: crate::acp::projections::SessionTurnState::Idle,
                            active_turn_failure: None,
                            last_terminal_turn_id: None,
                            active_streaming_tail: None,
                            transcript_operations: vec![],
                            operation_patches: vec![],
                            interaction_patches: vec![],
                            changed_fields: vec!["x".repeat(70_000)],
                        },
                    },
                })
                .expect("serialize envelope"),
                priority: "normal".to_string(),
                droppable: false,
                emitted_at_ms: 3,
            }],
        );

        assert!(
            receiver.try_recv().is_err(),
            "historical open replay must not replay oversized buffered deltas"
        );
    }
}
