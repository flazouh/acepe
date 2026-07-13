use super::*;
use crate::acp::session::ingress::live_session_update::session_update_to_provider_event;
use crate::acp::session_state_engine::transcript_rows_ledger::TranscriptRowsLedgerWriteHint;
use crate::acp::session_state_engine::transition_delivery_builder::build_transition_derived_delivery;
use crate::acp::transcript_projection::{TranscriptDelta, TranscriptDeltaOperation};

pub(super) fn update_has_canonical_ingress(update: &SessionUpdate) -> bool {
    matches!(
        update,
        SessionUpdate::UserMessageChunk { .. }
            | SessionUpdate::AgentMessageChunk { .. }
            | SessionUpdate::AgentThoughtChunk { .. }
            | SessionUpdate::ToolCall { .. }
            | SessionUpdate::ToolCallUpdate { .. }
            | SessionUpdate::Plan { .. }
            | SessionUpdate::AvailableCommandsUpdate { .. }
            | SessionUpdate::CurrentModeUpdate { .. }
            | SessionUpdate::ConfigOptionUpdate { .. }
            | SessionUpdate::PermissionRequest { .. }
            | SessionUpdate::QuestionRequest { .. }
            | SessionUpdate::TurnComplete { .. }
            | SessionUpdate::TurnError { .. }
            | SessionUpdate::TurnCancelled { .. }
            | SessionUpdate::UsageTelemetryUpdate { .. }
            | SessionUpdate::CompactionEvent { .. }
            | SessionUpdate::ConnectionComplete { .. }
            | SessionUpdate::ConnectionFailed { .. }
            | SessionUpdate::SessionDetached { .. }
    )
}

fn canonical_ingress_event(
    session_id: &str,
    event_seq: i64,
    update: &SessionUpdate,
    runtime_graph_registry: &SessionGraphRuntimeRegistry,
) -> Option<crate::acp::session::ingress::event::ProviderEvent> {
    let graph = runtime_graph_registry.graph_for_session(session_id)?;
    let terminal = matches!(
        graph.turn_state,
        crate::acp::projections::SessionTurnState::Completed
            | crate::acp::projections::SessionTurnState::Failed
            | crate::acp::projections::SessionTurnState::Cancelled
    );
    let terminal_decision = crate::acp::projections::RouteDecision {
        suppress: terminal
            && matches!(
                update,
                SessionUpdate::AgentMessageChunk { .. }
                    | SessionUpdate::AgentThoughtChunk { .. }
                    | SessionUpdate::ToolCall { .. }
                    | SessionUpdate::ToolCallUpdate { .. }
            ),
        ignore_late: terminal
            && matches!(
                update,
                SessionUpdate::TurnComplete { .. } | SessionUpdate::TurnError { .. }
            ),
        resets: matches!(update, SessionUpdate::UserMessageChunk { .. }),
    };
    session_update_to_provider_event(graph.agent_id, event_seq, update, terminal_decision)
}

enum CanonicalDispatch {
    NotCanonical,
    Handled(DispatchPersistenceEffects),
}

async fn persist_canonical_delivery(
    db: &DbConn,
    session_id: &str,
    event_seq: i64,
    update: &SessionUpdate,
    projection_registry: &ProjectionRegistry,
    runtime_graph_registry: &SessionGraphRuntimeRegistry,
    transcript_projection_registry: &TranscriptProjectionRegistry,
) -> CanonicalDispatch {
    if !update_has_canonical_ingress(update) {
        return CanonicalDispatch::NotCanonical;
    }
    let ingress_event =
        canonical_ingress_event(session_id, event_seq, update, runtime_graph_registry);
    let Some(ingress_event) = ingress_event.as_ref() else {
        return CanonicalDispatch::Handled(DispatchPersistenceEffects::default());
    };
    let Some(transition) =
        runtime_graph_registry.apply_provider_event_transition(session_id, ingress_event)
    else {
        tracing::error!(
            session_id,
            provider_row_id = %ingress_event.provider_row_id,
            "Canonical provider event arrived before the held session graph was seeded"
        );
        return CanonicalDispatch::Handled(DispatchPersistenceEffects::default());
    };
    let replaces_lifecycle = matches!(
        &ingress_event.kind,
        crate::acp::session::ingress::event::ProviderEventKind::SessionReady { .. }
            | crate::acp::session::ingress::event::ProviderEventKind::SessionFailed { .. }
            | crate::acp::session::ingress::event::ProviderEventKind::SessionDetached { .. }
    ) || matches!(
        &ingress_event.kind,
        crate::acp::session::ingress::event::ProviderEventKind::TurnFailure { .. }
    ) && matches!(
        transition.before.lifecycle.status,
        crate::acp::lifecycle::LifecycleStatus::Reserved
            | crate::acp::lifecycle::LifecycleStatus::Activating
    );
    let replaces_capabilities = matches!(
        &ingress_event.kind,
        crate::acp::session::ingress::event::ProviderEventKind::SessionReady { .. }
            | crate::acp::session::ingress::event::ProviderEventKind::ModeUpdate(_)
            | crate::acp::session::ingress::event::ProviderEventKind::CapabilitiesUpdate(_)
            | crate::acp::session::ingress::event::ProviderEventKind::ConfigOptionsUpdate(_)
    );
    let checkpoint_after =
        crate::acp::session_state_engine::runtime_registry::SessionGraphRuntimeSnapshot {
            graph_revision: event_seq,
            lifecycle: transition.after.lifecycle.clone(),
            capabilities: transition.after.capabilities.clone(),
        };
    if let Err(error) = runtime_graph_registry
        .supervisor()
        .record_canonical_graph_transition(
            db,
            projection_registry,
            session_id,
            event_seq,
            checkpoint_after,
            replaces_lifecycle,
            replaces_capabilities,
        )
        .await
    {
        tracing::error!(
            error = %error,
            session_id,
            provider_row_id = %ingress_event.provider_row_id,
            "Failed to mirror canonical graph transition into lifecycle checkpoint"
        );
        return CanonicalDispatch::Handled(DispatchPersistenceEffects::default());
    }
    let delivery =
        build_transition_derived_delivery(session_id, ingress_event, &transition, Some(update));
    let transcript_delta = delivery.transcript_delta.as_ref();
    let _ = transcript_projection_registry.mirror_provider_event_transition(
        event_seq,
        ingress_event,
        &transition,
    );
    projection_registry.mirror_session_graph(&transition.after);
    persist_transcript_row_ledger_if_needed(
        db,
        session_id,
        update,
        transition.after.revision,
        projection_registry,
        runtime_graph_registry,
        transcript_projection_registry,
        transcript_delta,
    )
    .await;
    CanonicalDispatch::Handled(DispatchPersistenceEffects {
        session_state_envelope: delivery.primary,
        additional_session_state_envelopes: delivery.additional,
    })
}

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
    if update_has_canonical_ingress(update.as_ref())
        && runtime_graph_registry
            .graph_for_session(session_id)
            .is_none()
    {
        tracing::error!(
            session_id,
            event_name = event.event_name,
            "Skipping canonical session update before the held graph is seeded"
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
            if let CanonicalDispatch::Handled(effects) = persist_canonical_delivery(
                db,
                session_id,
                record.event_seq,
                update.as_ref(),
                projection_registry,
                runtime_graph_registry,
                transcript_projection_registry,
            )
            .await
            {
                return effects;
            }
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
            let transcript_delta: Option<TranscriptDelta> = None;
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
            persist_transcript_row_ledger_if_needed(
                db,
                session_id,
                update.as_ref(),
                revision,
                projection_registry,
                runtime_graph_registry,
                transcript_projection_registry,
                transcript_delta.as_ref(),
            )
            .await;
            DispatchPersistenceEffects {
                session_state_envelope,
                additional_session_state_envelopes,
            }
        }
        Ok(None) => {
            if update_has_canonical_ingress(update.as_ref()) {
                tracing::error!(
                    session_id,
                    event_name = event.event_name,
                    "Canonical session update was not represented in the durable journal"
                );
                return DispatchPersistenceEffects::default();
            }
            let synthetic_event_seq = previous_runtime_snapshot
                .graph_revision
                .max(previous_transcript_revision)
                .saturating_add(1);
            if let CanonicalDispatch::Handled(effects) = persist_canonical_delivery(
                db,
                session_id,
                synthetic_event_seq,
                update.as_ref(),
                projection_registry,
                runtime_graph_registry,
                transcript_projection_registry,
            )
            .await
            {
                return effects;
            }
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
            let transcript_delta: Option<TranscriptDelta> = None;
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
            persist_transcript_row_ledger_if_needed(
                db,
                session_id,
                update.as_ref(),
                revision,
                projection_registry,
                runtime_graph_registry,
                transcript_projection_registry,
                transcript_delta.as_ref(),
            )
            .await;
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

async fn persist_transcript_row_ledger_if_needed(
    db: &DbConn,
    session_id: &str,
    update: &SessionUpdate,
    revision: SessionGraphRevision,
    projection_registry: &ProjectionRegistry,
    runtime_graph_registry: &SessionGraphRuntimeRegistry,
    transcript_projection_registry: &TranscriptProjectionRegistry,
    transcript_delta: Option<&crate::acp::transcript_projection::TranscriptDelta>,
) {
    if !should_persist_transcript_row_ledger(update, transcript_delta) {
        return;
    }

    if let Err(error) = runtime_graph_registry
        .persist_current_transcript_row_ledger(
            db,
            session_id,
            revision,
            projection_registry,
            transcript_projection_registry,
            transcript_row_ledger_write_hint(update, transcript_delta),
        )
        .await
    {
        tracing::error!(
            error = %error,
            session_id,
            "Transcript row ledger persistence failed after canonical update"
        );
    }
}

fn transcript_row_ledger_write_hint(
    update: &SessionUpdate,
    transcript_delta: Option<&TranscriptDelta>,
) -> TranscriptRowsLedgerWriteHint {
    let mut hint = TranscriptRowsLedgerWriteHint::default();
    if let Some(delta) = transcript_delta {
        for operation in &delta.operations {
            match operation {
                TranscriptDeltaOperation::AppendEntry { entry } => {
                    hint.changed_source_entry_ids.push(entry.entry_id.clone());
                }
                TranscriptDeltaOperation::AppendSegment { entry_id, .. } => {
                    hint.changed_source_entry_ids.push(entry_id.clone());
                }
                TranscriptDeltaOperation::ReplaceSnapshot { .. } => {
                    hint.force_full_replace = true;
                }
            }
        }
    }

    if let Some(tool_call_id) =
        crate::acp::session_state_engine::envelope_router::tool_call_id_for_operation_patch(update)
    {
        hint.changed_tool_call_ids.push(tool_call_id.to_string());
    }
    if let Some(interaction_id) =
        crate::acp::session_state_engine::envelope_router::interaction_id_for_patch(update)
    {
        hint.changed_interaction_ids
            .push(interaction_id.to_string());
    }

    hint
}

fn should_persist_transcript_row_ledger(
    update: &SessionUpdate,
    transcript_delta: Option<&crate::acp::transcript_projection::TranscriptDelta>,
) -> bool {
    transcript_delta.is_some()
        || crate::acp::session_state_engine::envelope_router::tool_call_id_for_operation_patch(
            update,
        )
        .is_some()
        || crate::acp::session_state_engine::envelope_router::interaction_id_for_patch(update)
            .is_some()
}

#[cfg(test)]
mod tests {
    use super::update_has_canonical_ingress;
    use crate::acp::client_session::{default_modes, default_session_model_state};
    use crate::acp::lifecycle::{DetachedReason, FailureReason};
    use crate::acp::session_update::{ConfigOptionUpdateData, SessionUpdate};

    #[test]
    fn lifecycle_and_config_updates_use_canonical_ingress() {
        let updates = [
            SessionUpdate::ConfigOptionUpdate {
                update: ConfigOptionUpdateData {
                    config_options: Vec::new(),
                },
                session_id: Some("session-1".to_string()),
            },
            SessionUpdate::ConnectionComplete {
                session_id: "session-1".to_string(),
                attempt_id: 1,
                models: default_session_model_state(),
                modes: default_modes(),
                available_commands: None,
                config_options: None,
                autonomous_enabled: None,
            },
            SessionUpdate::ConnectionFailed {
                session_id: "session-1".to_string(),
                attempt_id: 1,
                error: "offline".to_string(),
                failure_reason: FailureReason::ResumeFailed,
            },
            SessionUpdate::SessionDetached {
                session_id: "session-1".to_string(),
                attempt_id: 1,
                detached_reason: DetachedReason::ReconnectExhausted,
            },
        ];

        for update in updates {
            assert!(update_has_canonical_ingress(&update));
        }
    }
}
