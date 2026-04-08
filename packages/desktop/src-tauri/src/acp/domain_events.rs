use serde::{Deserialize, Serialize};

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

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct SessionDomainEvent {
    pub event_id: String,
    pub seq: i64,
    pub session_id: String,
    pub provider_session_id: Option<String>,
    pub occurred_at_ms: i64,
    pub causation_id: Option<String>,
    pub kind: SessionDomainEventKind,
}
