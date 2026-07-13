use super::*;
use crate::acp::session::ingress::event::ProviderEvent;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AcpUiEventPriority {
    Normal,
    High,
}

impl AcpUiEventPriority {
    pub(super) fn as_str(self) -> &'static str {
        match self {
            Self::Normal => "normal",
            Self::High => "high",
        }
    }
}

#[derive(Debug, Clone)]
pub enum AcpUiEventPayload {
    SessionUpdate(Box<SessionUpdate>),
    SessionDomainEvent(Box<SessionDomainEvent>),
    Json(Value),
}

#[derive(Debug, Clone)]
pub struct AcpUiEvent {
    pub session_id: Option<String>,
    pub event_name: &'static str,
    pub payload: AcpUiEventPayload,
    pub priority: AcpUiEventPriority,
    pub droppable: bool,
    pub created_at: Instant,
    /// Pre-normalized ingress event for fold replay (avoids SessionUpdate re-normalization).
    pub ingress_fold_event: Option<ProviderEvent>,
}

impl AcpUiEvent {
    #[must_use]
    pub fn session_update(update: SessionUpdate) -> Self {
        let session_id = update.session_id().map(ToString::to_string);
        let priority = match &update {
            SessionUpdate::PermissionRequest { .. } | SessionUpdate::QuestionRequest { .. } => {
                AcpUiEventPriority::High
            }
            _ => AcpUiEventPriority::Normal,
        };

        let droppable = match &update {
            SessionUpdate::AgentMessageChunk { .. } | SessionUpdate::AgentThoughtChunk { .. } => {
                true
            }
            SessionUpdate::ToolCallUpdate { update, .. } => update.streaming_input_delta.is_some(),
            _ => false,
        };

        Self {
            session_id,
            event_name: "acp-session-update",
            payload: AcpUiEventPayload::SessionUpdate(Box::new(update)),
            priority,
            droppable,
            created_at: Instant::now(),
            ingress_fold_event: None,
        }
    }

    #[must_use]
    pub fn session_update_with_ingress_fold(
        update: SessionUpdate,
        ingress_fold_event: Option<ProviderEvent>,
    ) -> Self {
        let mut event = Self::session_update(update);
        event.ingress_fold_event = ingress_fold_event;
        event
    }

    #[must_use]
    pub fn inbound_request(request: Value) -> Self {
        let session_id = request
            .get("params")
            .and_then(|params| params.get("sessionId"))
            .and_then(Value::as_str)
            .map(ToString::to_string);

        Self {
            session_id,
            event_name: "acp-inbound-request",
            payload: AcpUiEventPayload::Json(request),
            priority: AcpUiEventPriority::High,
            droppable: false,
            created_at: Instant::now(),
            ingress_fold_event: None,
        }
    }

    #[must_use]
    pub fn session_domain_event(event: SessionDomainEvent) -> Self {
        let session_id = Some(event.session_id.clone());

        Self {
            session_id,
            event_name: "acp-session-domain-event",
            payload: AcpUiEventPayload::SessionDomainEvent(Box::new(event)),
            priority: AcpUiEventPriority::Normal,
            droppable: false,
            created_at: Instant::now(),
            ingress_fold_event: None,
        }
    }

    #[must_use]
    pub fn json_event(
        event_name: &'static str,
        payload: Value,
        session_id: Option<String>,
        priority: AcpUiEventPriority,
        droppable: bool,
    ) -> Self {
        Self {
            session_id,
            event_name,
            payload: AcpUiEventPayload::Json(payload),
            priority,
            droppable,
            created_at: Instant::now(),
            ingress_fold_event: None,
        }
    }

    pub(crate) fn session_state_envelope(envelope: &SessionStateEnvelope) -> Option<Self> {
        if let Err(status) = session_state_envelope_byte_budget_status(envelope) {
            tracing::warn!(
                session_id = %envelope.session_id,
                graph_revision = envelope.graph_revision,
                last_event_seq = envelope.last_event_seq,
                kind = ?status.kind,
                byte_len = status.byte_len,
                max_bytes = status.max_bytes,
                "Skipping oversized ACP session state envelope"
            );
            return None;
        }

        let payload = serde_json::to_value(envelope).unwrap_or_else(|error| {
            tracing::error!(
                %error,
                session_id = %envelope.session_id,
                graph_revision = envelope.graph_revision,
                last_event_seq = envelope.last_event_seq,
                "Failed to serialize ACP session state envelope"
            );
            Value::Null
        });
        Some(AcpUiEvent::json_event(
            "acp-session-state",
            payload,
            Some(envelope.session_id.clone()),
            AcpUiEventPriority::Normal,
            false,
        ))
    }

    fn to_json_payload(&self) -> Result<Value, serde_json::Error> {
        match &self.payload {
            AcpUiEventPayload::SessionUpdate(update) => serde_json::to_value(update.as_ref()),
            AcpUiEventPayload::SessionDomainEvent(event) => serde_json::to_value(event.as_ref()),
            AcpUiEventPayload::Json(value) => Ok(value.clone()),
        }
    }

    pub(super) fn publish(&self, hub: &AcpEventHubState) -> Result<(), serde_json::Error> {
        let payload = self.to_json_payload()?;
        hub.publish(
            self.event_name,
            self.session_id.clone(),
            payload,
            self.priority.as_str(),
            self.droppable,
        );
        Ok(())
    }

    /// Publish directly to the event hub, bypassing the rate-limited dispatch loop.
    /// Used for lifecycle events (connectionComplete/connectionFailed) that must
    /// not be delayed or dropped.
    pub fn publish_direct(&self, hub: &AcpEventHubState) -> Result<(), serde_json::Error> {
        self.publish(hub)
    }
}
