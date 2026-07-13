//! Builds live wire delivery directly from one canonical provider-event fold.
//!
//! This deliberately reads only the atomic before/after graph transition. It
//! never consults the compatibility projection registries and never folds the
//! provider event a second time.

use serde::Serialize;

use crate::acp::session::delivery::live_transcript_fold::transcript_delta_operations_for_event;
use crate::acp::session::ingress::event::{ProviderEvent, ProviderEventKind};
use crate::acp::session_state_engine::live_envelope_builder::{
    build_assistant_text_delta_from_components, build_live_session_state_capabilities_envelope,
    build_live_session_state_lifecycle_envelope, build_live_session_state_plan_envelope,
    build_live_session_state_telemetry_envelope,
};
use crate::acp::session_state_engine::runtime_registry::ProviderEventTransition;
use crate::acp::session_state_engine::{
    build_delta_envelope, CapabilityPreviewState, DeltaEnvelopeParts, DeltaSessionProjectionFields,
    SessionGraphRevision, SessionStateEnvelope, SessionStateField,
};
use crate::acp::session_update::SessionUpdate;
use crate::acp::transcript_projection::TranscriptDelta;

#[derive(Debug, Default)]
pub(crate) struct TransitionDerivedDelivery {
    pub(crate) primary: Option<SessionStateEnvelope>,
    pub(crate) additional: Vec<SessionStateEnvelope>,
    pub(crate) transcript_delta: Option<TranscriptDelta>,
}

/// Materialize the wire effects of an already-applied provider event.
#[must_use]
pub(crate) fn build_transition_derived_delivery(
    session_id: &str,
    event: &ProviderEvent,
    transition: &ProviderEventTransition,
    original_update: Option<&SessionUpdate>,
) -> TransitionDerivedDelivery {
    if !transition.applied {
        return TransitionDerivedDelivery::default();
    }

    let from_revision = transition.before.revision;
    let to_revision = delivery_revision(event, transition.after.revision);
    let transcript_delta = transcript_delta_from_transition(session_id, event, transition);
    let primary = match &event.kind {
        ProviderEventKind::Plan(plan) => Some(build_live_session_state_plan_envelope(
            session_id,
            plan.clone(),
            to_revision,
        )),
        ProviderEventKind::Usage(telemetry) => Some(build_live_session_state_telemetry_envelope(
            session_id,
            telemetry.clone(),
            to_revision,
        )),
        ProviderEventKind::ModeUpdate(_)
        | ProviderEventKind::CapabilitiesUpdate(_)
        | ProviderEventKind::ConfigOptionsUpdate(_)
        | ProviderEventKind::SessionReady { .. } => {
            Some(build_live_session_state_capabilities_envelope(
                session_id,
                transition.after.capabilities.clone(),
                to_revision,
                None,
                CapabilityPreviewState::Canonical,
            ))
        }
        ProviderEventKind::SessionFailed { .. } | ProviderEventKind::SessionDetached { .. } => {
            Some(build_live_session_state_lifecycle_envelope(
                session_id,
                transition.after.lifecycle.clone(),
                to_revision,
            ))
        }
        _ => build_graph_delta(
            session_id,
            transition,
            transcript_delta.as_ref(),
            from_revision,
            to_revision,
        ),
    };

    let mut additional = Vec::new();
    if matches!(&event.kind, ProviderEventKind::SessionReady { .. }) {
        additional.push(build_live_session_state_lifecycle_envelope(
            session_id,
            transition.after.lifecycle.clone(),
            to_revision,
        ));
    }
    if let (Some(update), Some(delta)) = (original_update, transcript_delta.as_ref()) {
        additional.extend(build_assistant_text_delta_from_components(
            session_id,
            update,
            delta,
            &transition.after.transcript_snapshot,
            to_revision,
        ));
    }

    TransitionDerivedDelivery {
        primary,
        additional,
        transcript_delta,
    }
}

/// Materialize delivery for a user interaction reply already applied to the
/// held graph. Interaction replies do not carry transcript operations.
#[must_use]
pub(crate) fn build_interaction_reply_delivery(
    session_id: &str,
    transition: &ProviderEventTransition,
) -> TransitionDerivedDelivery {
    if !transition.applied {
        return TransitionDerivedDelivery::default();
    }

    TransitionDerivedDelivery {
        primary: build_graph_delta(
            session_id,
            transition,
            None,
            transition.before.revision,
            transition.after.revision,
        ),
        additional: Vec::new(),
        transcript_delta: None,
    }
}

fn transcript_delta_from_transition(
    session_id: &str,
    event: &ProviderEvent,
    transition: &ProviderEventTransition,
) -> Option<TranscriptDelta> {
    if !transition.applied
        || transition.before.transcript_snapshot == transition.after.transcript_snapshot
    {
        return None;
    }
    let operations = transcript_delta_operations_for_event(
        event,
        &transition.before.transcript_snapshot,
        &transition.after.transcript_snapshot,
    );
    if operations.is_empty() {
        return None;
    }
    Some(TranscriptDelta {
        event_seq: i64::try_from(event.provider_seq).unwrap_or(i64::MAX),
        session_id: session_id.to_string(),
        snapshot_revision: transition.after.transcript_snapshot.revision,
        operations,
    })
}

fn delivery_revision(
    event: &ProviderEvent,
    graph_revision: SessionGraphRevision,
) -> SessionGraphRevision {
    let event_seq = i64::try_from(event.provider_seq).unwrap_or(i64::MAX);
    SessionGraphRevision::new(
        graph_revision.graph_revision,
        graph_revision.transcript_revision,
        graph_revision.last_event_seq.max(event_seq),
    )
}

fn build_graph_delta(
    session_id: &str,
    transition: &ProviderEventTransition,
    transcript_delta: Option<&TranscriptDelta>,
    from_revision: SessionGraphRevision,
    to_revision: SessionGraphRevision,
) -> Option<SessionStateEnvelope> {
    let transcript_operations = transcript_delta
        .map(|delta| delta.operations.clone())
        .unwrap_or_default();
    let operation_patches = changed_snapshots(
        &transition.before.operations,
        &transition.after.operations,
        |operation| operation.id.as_str(),
    );
    let interaction_patches = changed_snapshots(
        &transition.before.interactions,
        &transition.after.interactions,
        |interaction| interaction.id.as_str(),
    );
    let mut changed_fields = Vec::new();
    if !transcript_operations.is_empty() {
        changed_fields.push(SessionStateField::TranscriptSnapshot);
    }
    if !operation_patches.is_empty() {
        changed_fields.push(SessionStateField::Operations);
    }
    if transition.before.activity != transition.after.activity {
        changed_fields.push(SessionStateField::Activity);
    }
    if transition.before.turn_state != transition.after.turn_state {
        changed_fields.push(SessionStateField::TurnState);
    }
    if transition.before.active_turn_failure != transition.after.active_turn_failure {
        changed_fields.push(SessionStateField::ActiveTurnFailure);
    }
    if transition.before.last_terminal_turn_id != transition.after.last_terminal_turn_id {
        changed_fields.push(SessionStateField::LastTerminalTurnId);
    }
    if transition.before.active_streaming_tail != transition.after.active_streaming_tail {
        changed_fields.push(SessionStateField::ActiveStreamingTail);
    }
    if !interaction_patches.is_empty() {
        changed_fields.push(SessionStateField::Interactions);
    }

    if changed_fields.is_empty() {
        return None;
    }

    Some(build_delta_envelope(DeltaEnvelopeParts {
        session_id,
        from_revision,
        to_revision,
        projection: DeltaSessionProjectionFields {
            activity: transition.after.activity.clone(),
            turn_state: transition.after.turn_state.clone(),
            active_turn_failure: transition.after.active_turn_failure.clone(),
            last_terminal_turn_id: transition.after.last_terminal_turn_id.clone(),
            active_streaming_tail: transition.after.active_streaming_tail.clone(),
        },
        transcript_operations,
        operation_patches,
        interaction_patches,
        changed_fields,
    }))
}

fn changed_snapshots<'a, T, F>(before: &'a [T], after: &'a [T], id: F) -> Vec<T>
where
    T: Clone + Serialize,
    F: for<'b> Fn(&'b T) -> &'b str,
{
    after
        .iter()
        .filter(|candidate| {
            let candidate_id = id(candidate);
            before
                .iter()
                .find(|previous| id(previous) == candidate_id)
                .is_none_or(|previous| serialized_value(previous) != serialized_value(candidate))
        })
        .cloned()
        .collect()
}

fn serialized_value<T: Serialize>(value: &T) -> serde_json::Value {
    serde_json::to_value(value).unwrap_or(serde_json::Value::Null)
}

#[cfg(test)]
mod tests {
    use super::build_transition_derived_delivery;
    use crate::acp::client_session::{default_modes, default_session_model_state};
    use crate::acp::lifecycle::{DetachedReason, FailureReason};
    use crate::acp::session::engine::fold::{fold_full, fold_step, FoldContext};
    use crate::acp::session::ingress::event::{ProviderEvent, ProviderEventKind};
    use crate::acp::session_state_engine::runtime_registry::ProviderEventTransition;
    use crate::acp::session_state_engine::{SessionStateField, SessionStatePayload};
    use crate::acp::session_update::{ContentChunk, SessionUpdate};
    use crate::acp::types::{CanonicalAgentId, ContentBlock};

    fn transition_for(event: &ProviderEvent) -> ProviderEventTransition {
        let before = fold_full(
            &[],
            &FoldContext::new("session-1", CanonicalAgentId::Codex, "/workspace"),
        );
        let after = fold_step(&before, event).0;
        ProviderEventTransition {
            before,
            after,
            applied: true,
        }
    }

    #[test]
    fn assistant_event_builds_delta_and_timestamped_text_delivery_from_one_transition() {
        let event = ProviderEvent {
            source: CanonicalAgentId::Codex,
            provider_seq: 7,
            provider_row_id: "assistant-7".to_string(),
            timestamp_ms: None,
            kind: ProviderEventKind::AssistantText {
                text: "hello".to_string(),
            },
        };
        let transition = transition_for(&event);
        let update = SessionUpdate::AgentMessageChunk {
            chunk: ContentChunk {
                content: ContentBlock::Text {
                    text: "hello".to_string(),
                },
                aggregation_hint: None,
            },
            part_id: None,
            message_id: None,
            parent_tool_use_id: None,
            session_id: Some("session-1".to_string()),
            produced_at_monotonic_ms: Some(42),
        };

        let delivery =
            build_transition_derived_delivery("session-1", &event, &transition, Some(&update));

        let primary = delivery.primary.expect("primary delta");
        let SessionStatePayload::Delta { delta } = primary.payload else {
            panic!("expected delta payload");
        };
        assert_eq!(delta.transcript_operations.len(), 1);
        assert!(delta
            .changed_fields
            .contains(&SessionStateField::TranscriptSnapshot));
        assert_eq!(delivery.additional.len(), 1);
        assert_eq!(
            delivery
                .transcript_delta
                .as_ref()
                .expect("delta")
                .operations
                .len(),
            1
        );
        let SessionStatePayload::AssistantTextDelta { delta } = &delivery.additional[0].payload
        else {
            panic!("expected assistant text delta");
        };
        assert_eq!(delta.delta_text, "hello");
        assert_eq!(delta.produced_at_monotonic_ms, 42);
    }

    #[test]
    fn duplicate_transition_emits_nothing() {
        let event = ProviderEvent {
            source: CanonicalAgentId::Codex,
            provider_seq: 7,
            provider_row_id: "assistant-7".to_string(),
            timestamp_ms: None,
            kind: ProviderEventKind::AssistantText {
                text: "hello".to_string(),
            },
        };
        let mut transition = transition_for(&event);
        transition.applied = false;

        let delivery = build_transition_derived_delivery("session-1", &event, &transition, None);

        assert!(delivery.primary.is_none());
        assert!(delivery.additional.is_empty());
        assert!(delivery.transcript_delta.is_none());
    }

    #[test]
    fn lifecycle_and_control_plane_events_emit_canonical_envelopes() {
        let ready = ProviderEvent {
            source: CanonicalAgentId::Codex,
            provider_seq: 1,
            provider_row_id: "journal:1".to_string(),
            timestamp_ms: None,
            kind: ProviderEventKind::SessionReady {
                models: default_session_model_state(),
                modes: default_modes(),
                available_commands: None,
                config_options: None,
                autonomous_enabled: None,
            },
        };
        let ready_delivery =
            build_transition_derived_delivery("session-1", &ready, &transition_for(&ready), None);
        assert!(matches!(
            ready_delivery.primary.map(|envelope| envelope.payload),
            Some(SessionStatePayload::Capabilities { .. })
        ));
        assert_eq!(ready_delivery.additional.len(), 1);
        assert!(matches!(
            ready_delivery.additional[0].payload,
            SessionStatePayload::Lifecycle { .. }
        ));

        let config = ProviderEvent {
            source: CanonicalAgentId::Codex,
            provider_seq: 2,
            provider_row_id: "journal:2".to_string(),
            timestamp_ms: None,
            kind: ProviderEventKind::ConfigOptionsUpdate(
                crate::acp::session_update::ConfigOptionUpdateData {
                    config_options: Vec::new(),
                },
            ),
        };
        let config_delivery =
            build_transition_derived_delivery("session-1", &config, &transition_for(&config), None);
        assert!(matches!(
            config_delivery.primary.map(|envelope| envelope.payload),
            Some(SessionStatePayload::Capabilities { .. })
        ));

        for event_kind in [
            ProviderEventKind::SessionFailed {
                error: "offline".to_string(),
                failure_reason: FailureReason::ResumeFailed,
            },
            ProviderEventKind::SessionDetached {
                detached_reason: DetachedReason::ReconnectExhausted,
            },
        ] {
            let event = ProviderEvent {
                source: CanonicalAgentId::Codex,
                provider_seq: 3,
                provider_row_id: "journal:3".to_string(),
                timestamp_ms: None,
                kind: event_kind,
            };
            let delivery = build_transition_derived_delivery(
                "session-1",
                &event,
                &transition_for(&event),
                None,
            );
            assert!(matches!(
                delivery.primary.map(|envelope| envelope.payload),
                Some(SessionStatePayload::Lifecycle { .. })
            ));
        }
    }
}
