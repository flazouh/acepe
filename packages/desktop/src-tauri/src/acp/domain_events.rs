use serde::{Deserialize, Serialize};

use crate::acp::projections::{InteractionKind, InteractionSnapshot, OperationSnapshot};
use crate::acp::session_update::{TodoUpdate, ToolCallStatus, ToolKind, UsageTelemetryData};

/// Marker enum identifying the domain event kind.
///
/// Kept as a flat string enum for backward-compatible discrimination
/// in frontend subscribers (`event.kind === "..."` comparisons).
/// Typed payload data is carried in [`SessionDomainEvent::payload`].
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "snake_case")]
pub enum SessionDomainEventKind {
    SessionIdentityResolved,
    SessionConnected,
    SessionDisconnected,
    SessionConfigChanged,
    TurnStarted,
    TurnCompleted,
    TurnFailed,
    TurnCancelled,
    UserMessageSegmentAppended,
    AssistantMessageSegmentAppended,
    AssistantThoughtSegmentAppended,
    OperationUpserted,
    OperationChildLinked,
    OperationCompleted,
    InteractionUpserted,
    InteractionResolved,
    InteractionCancelled,
    UsageTelemetryUpdated,
    TodoStateUpdated,
}

/// Typed payload carried by a canonical domain event.
///
/// Each variant corresponds to a [`SessionDomainEventKind`] and carries the
/// structured data that downstream reducers and projections need.  Consumers
/// can switch on `event.kind` for quick discrimination and access the typed
/// payload via `event.payload` when richer data is required.
#[expect(
    clippy::large_enum_variant,
    reason = "Canonical operation and interaction snapshots stay inline so the desktop event payload matches the projection contract directly."
)]
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SessionDomainEventPayload {
    SessionIdentityResolved {
        resolved_provider_session_id: String,
    },
    SessionConnected,
    SessionDisconnected,
    SessionConfigChanged,
    TurnStarted {
        turn_id: String,
    },
    TurnCompleted {
        turn_id: Option<String>,
    },
    TurnFailed {
        turn_id: Option<String>,
        error_message: String,
    },
    TurnCancelled {
        turn_id: Option<String>,
    },
    UserMessageSegmentAppended {
        message_id: String,
        part_id: Option<String>,
        text: String,
    },
    AssistantMessageSegmentAppended {
        message_id: String,
        part_id: Option<String>,
        text: String,
    },
    AssistantThoughtSegmentAppended {
        message_id: String,
        part_id: Option<String>,
        text: String,
    },
    OperationUpserted {
        operation_id: String,
        tool_call_id: String,
        tool_name: String,
        tool_kind: ToolKind,
        status: ToolCallStatus,
        parent_operation_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        operation: Option<OperationSnapshot>,
    },
    OperationChildLinked {
        parent_operation_id: String,
        child_operation_id: String,
    },
    OperationCompleted {
        operation_id: String,
        tool_call_id: String,
        status: ToolCallStatus,
    },
    InteractionUpserted {
        interaction_id: String,
        interaction_kind: InteractionKind,
        #[serde(skip_serializing_if = "Option::is_none")]
        operation_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        interaction: Option<InteractionSnapshot>,
    },
    InteractionResolved {
        interaction_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        operation_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        interaction: Option<InteractionSnapshot>,
    },
    InteractionCancelled {
        interaction_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        operation_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        interaction: Option<InteractionSnapshot>,
    },
    UsageTelemetryUpdated {
        data: UsageTelemetryData,
    },
    TodoStateUpdated {
        update: TodoUpdate,
    },
}

/// Canonical domain event envelope.
///
/// `kind` identifies the event type for quick string-based discrimination.
/// `payload` carries typed structured data — `None` only for events where
/// payloads are not yet wired at the emission site.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct SessionDomainEvent {
    pub event_id: String,
    pub seq: i64,
    pub session_id: String,
    pub provider_session_id: Option<String>,
    pub occurred_at_ms: i64,
    pub causation_id: Option<String>,
    pub kind: SessionDomainEventKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<SessionDomainEventPayload>,
}
