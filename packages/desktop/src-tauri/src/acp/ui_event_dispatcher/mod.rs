use crate::acp::domain_events::{
    SessionDomainEvent, SessionDomainEventKind, SessionDomainEventPayload,
};
use crate::acp::event_hub::AcpEventHubState;
use crate::acp::journal_write_lock::JournalWriteLockRegistry;
use crate::acp::pre_reservation_event_buffer::{
    PreReservationEventBuffer, PreReservationIngressDecision,
};
use crate::acp::projections::{InteractionSnapshot, ProjectionRegistry};
use crate::acp::session_state_engine::{
    session_state_envelope_byte_budget_status, LiveSessionStateEnvelopeRequest,
    SessionGraphRevision, SessionGraphRuntimeRegistry, SessionStateEnvelope,
};
use crate::acp::session_update::SessionUpdate;
use crate::acp::session_update_parser::session_update_to_domain_event;
use crate::acp::transcript_projection::TranscriptProjectionRegistry;
use crate::db::repository::SessionJournalEventRepository;
use sea_orm::DbConn;
use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};
use tokio::sync::mpsc;
use uuid::Uuid;

mod direct_publish;
mod dispatch_loop;
mod dispatcher;
mod event;
mod persistence;
mod policy;
mod timestamp;

#[cfg(test)]
mod tests;

pub(crate) use direct_publish::publish_direct_session_update;
use dispatch_loop::run_dispatch_loop;
pub use dispatcher::AcpUiEventDispatcher;
pub use event::{AcpUiEvent, AcpUiEventPayload, AcpUiEventPriority};
use persistence::{persist_dispatch_event, should_publish_raw_event};
pub use policy::DispatchPolicy;
use policy::DispatcherTelemetry;
use timestamp::{stamp_agent_message_chunk_timestamp, stamp_session_update_event};

#[cfg(test)]
use dispatch_loop::DispatcherState;
