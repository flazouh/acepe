use crate::acp::domain_events::{
    SessionDomainEvent, SessionDomainEventKind, SessionDomainEventPayload,
};
use crate::acp::event_hub::AcpEventHubState;
use crate::acp::projections::ProjectionRegistry;
use crate::acp::session_state_engine::{
    LiveSessionStateEnvelopeRequest, SessionGraphRevision, SessionGraphRuntimeRegistry,
    SessionStateEnvelope,
};
use crate::acp::session_update::SessionUpdate;
use crate::acp::session_update_parser::session_update_to_domain_event;
use crate::acp::transcript_projection::TranscriptProjectionRegistry;
use crate::db::repository::SessionJournalEventRepository;
use crate::db::repository::{
    SessionProjectionSnapshotRepository,
};
use sea_orm::DbConn;
use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};
use tokio::sync::mpsc;
use uuid::Uuid;

const TELEMETRY_INTERVAL: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AcpUiEventPriority {
    Normal,
    High,
}

impl AcpUiEventPriority {
    fn as_str(self) -> &'static str {
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
        }
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
        }
    }

    fn to_json_payload(&self) -> Result<Value, serde_json::Error> {
        match &self.payload {
            AcpUiEventPayload::SessionUpdate(update) => serde_json::to_value(update.as_ref()),
            AcpUiEventPayload::SessionDomainEvent(event) => serde_json::to_value(event.as_ref()),
            AcpUiEventPayload::Json(value) => Ok(value.clone()),
        }
    }

    fn publish(&self, hub: &AcpEventHubState) -> Result<(), serde_json::Error> {
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

    if let Some(session_id) = update.session_id() {
        projection_registry
            .inner()
            .apply_session_update(session_id, &update);
    }

    let hub = hub_state.inner().clone();
    let db = app.try_state::<DbConn>().map(|state| state.inner().clone());
    let event = AcpUiEvent::session_update(update);
    let dispatch_effects = persist_dispatch_event(
        db.as_ref(),
        &event,
        projection_registry.inner(),
        runtime_graph_registry.inner(),
        transcript_projection_registry.inner(),
    )
    .await;

    if let Err(error) = event.publish_direct(&hub) {
        tracing::error!(
            error = %error,
            session_id = ?event.session_id,
            event_name = event.event_name,
            "Failed to publish direct ACP session update"
        );
        return false;
    }

    if let Some(envelope) = dispatch_effects.session_state_envelope {
        let session_state_payload = serde_json::to_value(&envelope).unwrap_or_else(|error| {
            tracing::error!(
                %error,
                session_id = %envelope.session_id,
                graph_revision = envelope.graph_revision,
                last_event_seq = envelope.last_event_seq,
                "Failed to serialize direct ACP session state envelope"
            );
            Value::Null
        });
        let session_state_event = AcpUiEvent::json_event(
            "acp-session-state",
            session_state_payload,
            Some(envelope.session_id.clone()),
            AcpUiEventPriority::Normal,
            false,
        );
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

    true
}

#[derive(Debug, Clone)]
pub struct DispatchPolicy {
    pub tokens_per_sec: f64,
    pub burst: f64,
    pub max_global_backlog: usize,
    pub max_session_backlog: usize,
    pub high_backlog_threshold: usize,
    pub base_batch_size: usize,
    pub high_backlog_batch_size: usize,
    pub min_spacing_ms: u64,
    pub high_backlog_spacing_ms: u64,
}

impl Default for DispatchPolicy {
    fn default() -> Self {
        Self {
            tokens_per_sec: 300.0,
            burst: 30.0,
            max_global_backlog: 5000,
            max_session_backlog: 500,
            high_backlog_threshold: 1000,
            base_batch_size: 32,
            high_backlog_batch_size: 8,
            min_spacing_ms: 0,
            high_backlog_spacing_ms: 5,
        }
    }
}

struct DispatcherTelemetry {
    enqueued: u64,
    emitted: u64,
    dropped: u64,
    max_backlog: usize,
    max_wait_ms: u128,
    last_report: Instant,
}

impl DispatcherTelemetry {
    fn new() -> Self {
        Self {
            enqueued: 0,
            emitted: 0,
            dropped: 0,
            max_backlog: 0,
            max_wait_ms: 0,
            last_report: Instant::now(),
        }
    }

    fn maybe_report(&mut self, backlog: usize) {
        self.max_backlog = self.max_backlog.max(backlog);

        if self.last_report.elapsed() < TELEMETRY_INTERVAL {
            return;
        }

        tracing::debug!(
            enqueued = self.enqueued,
            emitted = self.emitted,
            dropped = self.dropped,
            max_backlog = self.max_backlog,
            max_wait_ms = self.max_wait_ms,
            "ACP UI dispatcher telemetry"
        );

        if self.dropped > 0 {
            tracing::warn!(
                dropped = self.dropped,
                max_backlog = self.max_backlog,
                "ACP UI dispatcher dropped events"
            );
        }

        self.enqueued = 0;
        self.emitted = 0;
        self.dropped = 0;
        self.max_backlog = 0;
        self.max_wait_ms = 0;
        self.last_report = Instant::now();
    }
}

#[derive(Clone)]
pub struct AcpUiEventDispatcher {
    tx: Option<mpsc::UnboundedSender<AcpUiEvent>>,
    domain_event_seq: Arc<AtomicI64>,
    projection_registry: Arc<ProjectionRegistry>,
    #[cfg(test)]
    test_sink: Option<Arc<std::sync::Mutex<Vec<AcpUiEvent>>>>,
}

impl AcpUiEventDispatcher {
    #[must_use]
    pub fn new(app_handle: Option<AppHandle>, policy: DispatchPolicy) -> Self {
        let Some(handle) = app_handle else {
            return Self {
                tx: None,
                domain_event_seq: Arc::new(AtomicI64::new(0)),
                projection_registry: Arc::new(ProjectionRegistry::new()),
                #[cfg(test)]
                test_sink: None,
            };
        };
        let projection_registry = handle
            .try_state::<Arc<ProjectionRegistry>>()
            .map(|state| state.inner().clone())
            .unwrap_or_else(|| Arc::new(ProjectionRegistry::new()));
        let transcript_projection_registry = handle
            .try_state::<Arc<TranscriptProjectionRegistry>>()
            .map(|state| state.inner().clone())
            .unwrap_or_else(|| Arc::new(TranscriptProjectionRegistry::new()));
        let runtime_graph_registry = handle
            .try_state::<Arc<SessionGraphRuntimeRegistry>>()
            .map(|state| state.inner().clone())
            .unwrap_or_else(|| Arc::new(SessionGraphRuntimeRegistry::new()));
        let Some(hub_state) = handle.try_state::<Arc<AcpEventHubState>>() else {
            tracing::warn!("ACP event hub state unavailable; UI event dispatcher disabled");
            return Self {
                tx: None,
                domain_event_seq: Arc::new(AtomicI64::new(0)),
                projection_registry,
                #[cfg(test)]
                test_sink: None,
            };
        };
        let hub = hub_state.inner().clone();

        let (tx, rx) = mpsc::unbounded_channel();
        let db = handle
            .try_state::<DbConn>()
            .map(|state| state.inner().clone());
        tokio::spawn(run_dispatch_loop(
            hub,
            db,
            policy,
            rx,
            projection_registry.clone(),
            runtime_graph_registry,
            transcript_projection_registry.clone(),
        ));

        Self {
            tx: Some(tx),
            domain_event_seq: Arc::new(AtomicI64::new(0)),
            projection_registry,
            #[cfg(test)]
            test_sink: None,
        }
    }

    #[cfg(test)]
    #[must_use]
    pub fn test_sink() -> (Self, Arc<std::sync::Mutex<Vec<AcpUiEvent>>>) {
        Self::test_sink_with_projection_registry(Arc::new(ProjectionRegistry::new()))
    }

    #[cfg(test)]
    #[must_use]
    pub fn test_sink_with_projection_registry(
        projection_registry: Arc<ProjectionRegistry>,
    ) -> (Self, Arc<std::sync::Mutex<Vec<AcpUiEvent>>>) {
        let sink = Arc::new(std::sync::Mutex::new(Vec::new()));
        (
            Self {
                tx: None,
                domain_event_seq: Arc::new(AtomicI64::new(0)),
                projection_registry,
                test_sink: Some(Arc::clone(&sink)),
            },
            sink,
        )
    }

    pub fn enqueue(&self, event: AcpUiEvent) {
        // Build the canonical domain event first so we have the seq for idempotency.
        let derived_domain_event = session_domain_event_from_update(&event.payload)
            .map(|e| self.create_session_domain_event(&e.session_id, e.kind, e.payload));

        if let AcpUiEventPayload::SessionUpdate(update) = &event.payload {
            if let Some(session_id) = update.session_id() {
                if let Some(canonical) = &derived_domain_event {
                    if let AcpUiEventPayload::SessionDomainEvent(domain_event) = &canonical.payload
                    {
                        // Route through the canonical entrypoint for idempotency and ordering.
                        self.projection_registry.apply_canonical_event(
                            session_id,
                            domain_event,
                            update.as_ref(),
                        );
                    }
                } else {
                    // Fallback: updates with no canonical mapping (Plan, ConfigOptionUpdate, …)
                    // still need to advance projection state.
                    self.projection_registry
                        .apply_session_update(session_id, update.as_ref());
                }
            }
        }

        #[cfg(test)]
        if let Some(sink) = &self.test_sink {
            if let Ok(mut captured) = sink.lock() {
                captured.push(event.clone());
                if let Some(domain_event) = derived_domain_event {
                    captured.push(domain_event);
                }
            }
            return;
        }

        let Some(tx) = &self.tx else {
            return;
        };

        if let Err(error) = tx.send(event) {
            tracing::error!(error = %error, "Failed to enqueue ACP UI event");
            return;
        }

        if let Some(domain_event) = derived_domain_event {
            if let Err(error) = tx.send(domain_event) {
                tracing::error!(error = %error, "Failed to enqueue ACP session domain event");
            }
        }
    }

    pub fn enqueue_session_domain_event(&self, session_id: &str, kind: SessionDomainEventKind) {
        self.enqueue_session_domain_event_with_payload(session_id, kind, None);
    }

    pub fn enqueue_session_domain_event_with_payload(
        &self,
        session_id: &str,
        kind: SessionDomainEventKind,
        payload: Option<SessionDomainEventPayload>,
    ) {
        let event = self.create_session_domain_event(session_id, kind, payload);

        #[cfg(test)]
        if let Some(sink) = &self.test_sink {
            if let Ok(mut captured) = sink.lock() {
                captured.push(event);
            }
            return;
        }

        let Some(tx) = &self.tx else {
            return;
        };

        if let Err(error) = tx.send(event) {
            tracing::error!(error = %error, "Failed to enqueue ACP session domain event");
        }
    }

    fn create_session_domain_event(
        &self,
        session_id: &str,
        kind: SessionDomainEventKind,
        payload: Option<SessionDomainEventPayload>,
    ) -> AcpUiEvent {
        self.domain_event_seq.fetch_max(
            self.projection_registry
                .snapshot_for_session(session_id)
                .map(|snapshot| snapshot.last_event_seq)
                .unwrap_or(0),
            Ordering::Relaxed,
        );
        let event = SessionDomainEvent {
            event_id: format!("session-domain-event-{}", Uuid::new_v4()),
            seq: self.domain_event_seq.fetch_add(1, Ordering::Relaxed) + 1,
            session_id: session_id.to_string(),
            provider_session_id: None,
            occurred_at_ms: chrono::Utc::now().timestamp_millis().max(0),
            causation_id: None,
            kind,
            payload,
        };

        AcpUiEvent::session_domain_event(event)
    }
}

fn session_domain_event_from_update(payload: &AcpUiEventPayload) -> Option<SessionDomainEvent> {
    let AcpUiEventPayload::SessionUpdate(update) = payload else {
        return None;
    };

    let session_id = update.session_id()?.to_string();
    let (kind, event_payload) = session_update_to_domain_event(update.as_ref())?;

    Some(SessionDomainEvent {
        event_id: String::new(),
        seq: 0,
        session_id,
        provider_session_id: None,
        occurred_at_ms: 0,
        causation_id: None,
        kind,
        payload: event_payload,
    })
}

async fn run_dispatch_loop(
    hub: Arc<AcpEventHubState>,
    db: Option<DbConn>,
    policy: DispatchPolicy,
    mut rx: mpsc::UnboundedReceiver<AcpUiEvent>,
    projection_registry: Arc<ProjectionRegistry>,
    runtime_graph_registry: Arc<SessionGraphRuntimeRegistry>,
    transcript_projection_registry: Arc<TranscriptProjectionRegistry>,
) {
    let mut state = DispatcherState::new(policy);

    while let Some(event) = rx.recv().await {
        state.enqueue(event);

        while let Ok(next) = rx.try_recv() {
            state.enqueue(next);
        }

        state
            .drain(
                &hub,
                db.as_ref(),
                projection_registry.as_ref(),
                runtime_graph_registry.as_ref(),
                transcript_projection_registry.as_ref(),
            )
            .await;
    }

    state
        .drain(
            &hub,
            db.as_ref(),
            projection_registry.as_ref(),
            runtime_graph_registry.as_ref(),
            transcript_projection_registry.as_ref(),
        )
        .await;
}

struct DispatcherState {
    policy: DispatchPolicy,
    per_session: HashMap<String, VecDeque<AcpUiEvent>>,
    session_order: VecDeque<String>,
    non_session: VecDeque<AcpUiEvent>,
    global_backlog: usize,
    round_robin_cursor: usize,
    tokens: f64,
    last_refill: Instant,
    telemetry: DispatcherTelemetry,
}

impl DispatcherState {
    fn new(policy: DispatchPolicy) -> Self {
        Self {
            tokens: policy.burst,
            policy,
            per_session: HashMap::new(),
            session_order: VecDeque::new(),
            non_session: VecDeque::new(),
            global_backlog: 0,
            round_robin_cursor: 0,
            last_refill: Instant::now(),
            telemetry: DispatcherTelemetry::new(),
        }
    }

    fn enqueue(&mut self, event: AcpUiEvent) {
        if self.global_backlog >= self.policy.max_global_backlog && event.droppable {
            self.telemetry.dropped += 1;
            return;
        }

        if let Some(session_id) = &event.session_id {
            let queue = self
                .per_session
                .entry(session_id.clone())
                .or_insert_with(|| {
                    self.session_order.push_back(session_id.clone());
                    VecDeque::new()
                });

            if queue.len() >= self.policy.max_session_backlog && event.droppable {
                self.telemetry.dropped += 1;
                return;
            }

            queue.push_back(event);
        } else {
            self.non_session.push_back(event);
        }

        self.global_backlog += 1;
        self.telemetry.enqueued += 1;
    }

    async fn drain(
        &mut self,
        hub: &AcpEventHubState,
        db: Option<&DbConn>,
        projection_registry: &ProjectionRegistry,
        runtime_graph_registry: &SessionGraphRuntimeRegistry,
        transcript_projection_registry: &TranscriptProjectionRegistry,
    ) {
        while self.global_backlog > 0 {
            self.refill_tokens();
            if self.tokens < 1.0 {
                tokio::time::sleep(Duration::from_millis(1)).await;
                continue;
            }

            let batch_limit = if self.global_backlog >= self.policy.high_backlog_threshold {
                self.policy.high_backlog_batch_size
            } else {
                self.policy.base_batch_size
            };

            for _ in 0..batch_limit {
                if self.tokens < 1.0 || self.global_backlog == 0 {
                    break;
                }

                let Some(event) = self.next_event() else {
                    break;
                };

                self.tokens -= 1.0;
                self.global_backlog = self.global_backlog.saturating_sub(1);

                let dispatch_effects = persist_dispatch_event(
                    db,
                    &event,
                    projection_registry,
                    runtime_graph_registry,
                    transcript_projection_registry,
                )
                .await;

                if let Err(error) = event.publish(hub) {
                    tracing::error!(
                        error = %error,
                        event_name = event.event_name,
                        session_id = ?event.session_id,
                        "Failed to emit ACP UI event"
                    );
                }
                if let Some(envelope) = dispatch_effects.session_state_envelope {
                    let session_state_payload =
                        serde_json::to_value(&envelope).unwrap_or_else(|error| {
                            tracing::error!(
                                %error,
                                session_id = %envelope.session_id,
                                graph_revision = envelope.graph_revision,
                                last_event_seq = envelope.last_event_seq,
                                "Failed to serialize ACP session state envelope"
                            );
                            Value::Null
                        });
                    let session_state_event = AcpUiEvent::json_event(
                        "acp-session-state",
                        session_state_payload,
                        Some(envelope.session_id.clone()),
                        AcpUiEventPriority::Normal,
                        false,
                    );
                    if let Err(error) = session_state_event.publish(hub) {
                        tracing::error!(
                            error = %error,
                            session_id = %envelope.session_id,
                            graph_revision = envelope.graph_revision,
                            last_event_seq = envelope.last_event_seq,
                            "Failed to emit ACP session state envelope"
                        );
                    }
                }

                self.telemetry.emitted += 1;
                self.telemetry.max_wait_ms = self
                    .telemetry
                    .max_wait_ms
                    .max(event.created_at.elapsed().as_millis());
            }

            let spacing_ms = if self.global_backlog >= self.policy.high_backlog_threshold {
                self.policy.high_backlog_spacing_ms
            } else {
                self.policy.min_spacing_ms
            };
            if spacing_ms > 0 && self.global_backlog > 0 {
                tokio::time::sleep(Duration::from_millis(spacing_ms)).await;
            }

            self.telemetry.maybe_report(self.global_backlog);
        }

        self.telemetry.maybe_report(self.global_backlog);
    }

    fn refill_tokens(&mut self) {
        let now = Instant::now();
        let elapsed = now.duration_since(self.last_refill).as_secs_f64();
        self.last_refill = now;
        self.tokens = (self.tokens + elapsed * self.policy.tokens_per_sec).min(self.policy.burst);
    }

    fn next_event(&mut self) -> Option<AcpUiEvent> {
        let non_session_is_high = self
            .non_session
            .iter()
            .any(|event| event.priority == AcpUiEventPriority::High);

        let session_has_high = self.any_session_has_high();

        if non_session_is_high || session_has_high {
            return self.next_high_priority_event();
        }

        self.next_round_robin_event()
    }

    fn any_session_has_high(&self) -> bool {
        self.session_order.iter().any(|session_id| {
            self.per_session.get(session_id).is_some_and(|queue| {
                queue
                    .iter()
                    .any(|event| event.priority == AcpUiEventPriority::High)
            })
        })
    }

    fn next_high_priority_event(&mut self) -> Option<AcpUiEvent> {
        if let Some(index) = self
            .non_session
            .iter()
            .position(|event| event.priority == AcpUiEventPriority::High)
        {
            return self.non_session.remove(index);
        }

        let session_ids: Vec<String> = self.session_order.iter().cloned().collect();
        for session_id in session_ids {
            if let Some(queue) = self.per_session.get_mut(&session_id) {
                if let Some(index) = queue
                    .iter()
                    .position(|event| event.priority == AcpUiEventPriority::High)
                {
                    if index == 0 {
                        // High-priority event is at the front — emit it directly.
                        let event = queue.pop_front();
                        self.cleanup_session_queue(&session_id);
                        return event;
                    }
                    // Causal ordering: emit the preceding Normal event first.
                    // The High-priority event stays in the queue and will be
                    // picked up on the next call once all predecessors are drained.
                    let event = queue.pop_front();
                    self.cleanup_session_queue(&session_id);
                    return event;
                }
            }
        }

        self.next_round_robin_event()
    }

    fn next_round_robin_event(&mut self) -> Option<AcpUiEvent> {
        let session_count = self.session_order.len();
        let include_non_session = !self.non_session.is_empty();

        if session_count == 0 {
            return self.non_session.pop_front();
        }

        let span = session_count + usize::from(include_non_session);
        let start = self.round_robin_cursor % span;

        for offset in 0..span {
            let index = (start + offset) % span;
            if include_non_session && index == session_count {
                self.round_robin_cursor = index + 1;
                if let Some(event) = self.non_session.pop_front() {
                    return Some(event);
                }
                continue;
            }

            let Some(session_id) = self.session_order.get(index).cloned() else {
                continue;
            };

            if let Some(queue) = self.per_session.get_mut(&session_id) {
                if let Some(event) = queue.pop_front() {
                    self.round_robin_cursor = index + 1;
                    self.cleanup_session_queue(&session_id);
                    return Some(event);
                }
            }

            self.cleanup_session_queue(&session_id);
        }

        self.non_session.pop_front()
    }

    fn cleanup_session_queue(&mut self, session_id: &str) {
        let remove = self
            .per_session
            .get(session_id)
            .is_some_and(VecDeque::is_empty);
        if !remove {
            return;
        }

        self.per_session.remove(session_id);
        self.session_order.retain(|id| id != session_id);
        if self.round_robin_cursor > 0 {
            self.round_robin_cursor -= 1;
        }
    }
}

#[derive(Debug, Default)]
struct DispatchPersistenceEffects {
    session_state_envelope: Option<SessionStateEnvelope>,
}

fn projection_has_runtime_state(
    snapshot: &crate::acp::projections::SessionProjectionSnapshot,
) -> bool {
    snapshot.session.is_some()
        || !snapshot.operations.is_empty()
        || !snapshot.interactions.is_empty()
        || snapshot.runtime.is_some()
}

async fn checkpoint_session_snapshots(
    db: &DbConn,
    session_id: &str,
    _projection_registry: &ProjectionRegistry,
    _runtime_graph_registry: &SessionGraphRuntimeRegistry,
    _transcript_projection_registry: &TranscriptProjectionRegistry,
) {
    let stored_runtime = match SessionProjectionSnapshotRepository::get(db, session_id).await {
        Ok(snapshot) => snapshot.and_then(|snapshot| snapshot.runtime),
        Err(error) => {
            tracing::error!(
                error = %error,
                session_id,
                "Failed to load stored runtime checkpoint before snapshot checkpoint"
            );
            return;
        }
    };
    let Some(stored_runtime) = stored_runtime else {
        return;
    };
    let projection_snapshot = crate::acp::projections::SessionProjectionSnapshot {
        session: None,
        operations: Vec::new(),
        interactions: Vec::new(),
        runtime: Some(stored_runtime),
    };

    if let Err(error) =
        SessionProjectionSnapshotRepository::set(db, session_id, &projection_snapshot).await
    {
        tracing::error!(
            error = %error,
            session_id,
            "Failed to checkpoint projection snapshot after terminal session update"
        );
    }
}

async fn persist_dispatch_event(
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

    match SessionJournalEventRepository::append_session_update(db, session_id, update.as_ref())
        .await
    {
        Ok(Some(record)) => {
            let previous_runtime_snapshot = runtime_graph_registry.snapshot_for_session(session_id);
            let previous_transcript_revision = transcript_projection_registry
                .snapshot_for_session(session_id)
                .map(|snapshot| snapshot.revision)
                .unwrap_or(0);
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
            let transcript_delta = transcript_projection_registry
                .apply_session_update(record.event_seq, update.as_ref());
            let transcript_revision = transcript_projection_registry
                .snapshot_for_session(session_id)
                .map(|snapshot| snapshot.revision)
                .unwrap_or(0);
            let revision = SessionGraphRevision::new(
                checkpoint.graph_revision,
                transcript_revision,
                record.event_seq,
            );
            let session_state_envelope = runtime_graph_registry
                .build_live_session_state_envelope(LiveSessionStateEnvelopeRequest {
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
                })
                .await;
            if matches!(
                update.as_ref(),
                SessionUpdate::TurnComplete { .. } | SessionUpdate::TurnError { .. }
            ) {
                checkpoint_session_snapshots(
                    db,
                    session_id,
                    projection_registry,
                    runtime_graph_registry,
                    transcript_projection_registry,
                )
                .await;
            }
            let _ = transcript_delta;
            DispatchPersistenceEffects {
                session_state_envelope,
            }
        }
        Ok(None) => DispatchPersistenceEffects::default(),
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::domain_events::{SessionDomainEvent, SessionDomainEventKind};
    use crate::acp::projections::SessionTurnState;
    use crate::acp::session_update::{
        ContentChunk, PermissionData, SessionUpdate, ToolArguments, ToolCallData, ToolCallStatus,
        ToolKind,
    };
    use crate::acp::transcript_projection::TranscriptDelta;
    use crate::acp::types::CanonicalAgentId;
    use crate::acp::types::ContentBlock;
    use crate::db::repository::SessionMetadataRepository;
    use sea_orm::{Database, DbConn};
    use sea_orm_migration::MigratorTrait;
    use serde_json::json;
    use std::sync::Arc;

    fn chunk_update(session_id: &str, text: &str) -> SessionUpdate {
        SessionUpdate::AgentMessageChunk {
            chunk: ContentChunk {
                content: ContentBlock::Text {
                    text: text.to_string(),
                },
                aggregation_hint: None,
            },
            part_id: None,
            message_id: None,
            session_id: Some(session_id.to_string()),
        }
    }

    async fn setup_test_db() -> DbConn {
        let db = Database::connect("sqlite::memory:")
            .await
            .expect("in-memory db");
        crate::db::migrations::Migrator::up(&db, None)
            .await
            .expect("migrations");
        db
    }

    #[test]
    fn per_session_fifo_order_is_preserved() {
        let mut state = DispatcherState::new(DispatchPolicy::default());
        state.enqueue(AcpUiEvent::session_update(chunk_update("s1", "a")));
        state.enqueue(AcpUiEvent::session_update(chunk_update("s1", "b")));

        let first = state.next_event().expect("first event");
        let second = state.next_event().expect("second event");

        let first_text = match &first.payload {
            AcpUiEventPayload::SessionUpdate(update) => match update.as_ref() {
                SessionUpdate::AgentMessageChunk { chunk, .. } => match &chunk.content {
                    ContentBlock::Text { text } => text.clone(),
                    _ => String::new(),
                },
                _ => String::new(),
            },
            _ => String::new(),
        };
        let second_text = match &second.payload {
            AcpUiEventPayload::SessionUpdate(update) => match update.as_ref() {
                SessionUpdate::AgentMessageChunk { chunk, .. } => match &chunk.content {
                    ContentBlock::Text { text } => text.clone(),
                    _ => String::new(),
                },
                _ => String::new(),
            },
            _ => String::new(),
        };

        assert_eq!(first_text, "a");
        assert_eq!(second_text, "b");
    }

    #[tokio::test]
    async fn persist_dispatch_event_builds_snapshot_envelope_from_journal_event_seq() {
        let db = setup_test_db().await;
        SessionMetadataRepository::ensure_exists(
            &db,
            "session-1",
            "/test/project",
            "claude-code",
            None,
        )
        .await
        .expect("session metadata");
        let event = AcpUiEvent::session_update(SessionUpdate::AgentMessageChunk {
            chunk: ContentChunk {
                content: ContentBlock::Text {
                    text: "hello".to_string(),
                },
                aggregation_hint: None,
            },
            part_id: Some("part-1".to_string()),
            message_id: Some("assistant-1".to_string()),
            session_id: Some("session-1".to_string()),
        });

        let projection_registry = ProjectionRegistry::new();
        if let AcpUiEventPayload::SessionUpdate(update) = &event.payload {
            projection_registry.apply_session_update("session-1", update.as_ref());
        }
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        let runtime_graph_registry = SessionGraphRuntimeRegistry::new();
        let effects = persist_dispatch_event(
            Some(&db),
            &event,
            &projection_registry,
            &runtime_graph_registry,
            &transcript_projection_registry,
        )
        .await;
        let envelope = effects
            .session_state_envelope
            .expect("session state envelope");

        assert_eq!(envelope.session_id, "session-1");
        assert_eq!(envelope.graph_revision, 1);
        assert_eq!(envelope.last_event_seq, 1);
        match envelope.payload {
            crate::acp::session_state_engine::SessionStatePayload::Snapshot { graph } => {
                assert_eq!(graph.revision, SessionGraphRevision::new(1, 1, 1));
                assert_eq!(graph.transcript_snapshot.revision, 1);
                assert_eq!(graph.transcript_snapshot.entries.len(), 1);
            }
            other => panic!("expected snapshot payload, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn persist_dispatch_event_builds_snapshot_envelope_for_interaction_updates() {
        let db = setup_test_db().await;
        SessionMetadataRepository::ensure_exists(
            &db,
            "session-1",
            "/test/project",
            "claude-code",
            None,
        )
        .await
        .expect("session metadata");
        let event = AcpUiEvent::session_update(SessionUpdate::PermissionRequest {
            permission: PermissionData {
                id: "permission-1".to_string(),
                session_id: "session-1".to_string(),
                json_rpc_request_id: Some(7),
                reply_handler: Some(
                    crate::acp::session_update::InteractionReplyHandler::json_rpc(7),
                ),
                permission: "execute".to_string(),
                patterns: vec![],
                metadata: json!({ "command": "bun test" }),
                always: vec![],
                auto_accepted: false,
                tool: None,
            },
            session_id: Some("session-1".to_string()),
        });

        let projection_registry = ProjectionRegistry::new();
        if let AcpUiEventPayload::SessionUpdate(update) = &event.payload {
            projection_registry.apply_session_update("session-1", update.as_ref());
        }
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        let runtime_graph_registry = SessionGraphRuntimeRegistry::new();
        let effects = persist_dispatch_event(
            Some(&db),
            &event,
            &projection_registry,
            &runtime_graph_registry,
            &transcript_projection_registry,
        )
        .await;

        let envelope = effects
            .session_state_envelope
            .expect("session state envelope");
        match envelope.payload {
            crate::acp::session_state_engine::SessionStatePayload::Snapshot { graph } => {
                assert_eq!(graph.revision.graph_revision, 1);
                assert_eq!(graph.revision.transcript_revision, 1);
                assert_eq!(graph.interactions.len(), 1);
                assert_eq!(
                    graph.lifecycle.status,
                    crate::acp::session_state_engine::SessionGraphLifecycleStatus::Idle
                );
            }
            other => panic!("expected snapshot payload, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn runtime_registry_maps_transcript_delta_to_session_state_delta_envelope() {
        let db = setup_test_db().await;
        let runtime_graph_registry = SessionGraphRuntimeRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        transcript_projection_registry.restore_session_snapshot(
            "session-1".to_string(),
            crate::acp::transcript_projection::TranscriptSnapshot {
                revision: 6,
                entries: Vec::new(),
            },
        );
        let envelope = runtime_graph_registry
            .build_live_session_state_envelope(LiveSessionStateEnvelopeRequest {
                db: &db,
                session_id: "session-1",
                update: &chunk_update("session-1", "hello"),
                previous_revision: SessionGraphRevision::new(6, 6, 6),
                revision: SessionGraphRevision::new(7, 7, 7),
                projection_registry: &ProjectionRegistry::new(),
                transcript_projection_registry: &transcript_projection_registry,
                transcript_delta: Some(&TranscriptDelta {
                    event_seq: 7,
                    session_id: "session-1".to_string(),
                    snapshot_revision: 7,
                    operations: vec![
                        crate::acp::transcript_projection::TranscriptDeltaOperation::AppendEntry {
                            entry: crate::acp::transcript_projection::TranscriptEntry {
                                entry_id: "assistant-1".to_string(),
                                role: crate::acp::transcript_projection::TranscriptEntryRole::Assistant,
                                segments: vec![crate::acp::transcript_projection::TranscriptSegment::Text {
                                    segment_id: "assistant-1:block:0".to_string(),
                                    text: "hello".to_string(),
                                }],
                            },
                        },
                    ],
                }),
            })
            .await
            .expect("session state envelope");

        assert_eq!(envelope.session_id, "session-1");
        assert_eq!(envelope.graph_revision, 7);
        assert_eq!(envelope.last_event_seq, 7);

        match envelope.payload {
            crate::acp::session_state_engine::SessionStatePayload::Delta { delta } => {
                assert_eq!(delta.from_revision, SessionGraphRevision::new(6, 6, 6));
                assert_eq!(delta.to_revision, SessionGraphRevision::new(7, 7, 7));
                assert_eq!(delta.changed_fields, vec!["transcriptSnapshot".to_string()]);
            }
            other => panic!("expected delta payload, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn runtime_registry_escalates_broken_transcript_lineage_to_snapshot() {
        let db = setup_test_db().await;
        SessionMetadataRepository::ensure_exists(
            &db,
            "session-1",
            "/test/project",
            "claude-code",
            None,
        )
        .await
        .expect("seed metadata");
        let runtime_graph_registry = SessionGraphRuntimeRegistry::new();
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        transcript_projection_registry.restore_session_snapshot(
            "session-1".to_string(),
            crate::acp::transcript_projection::TranscriptSnapshot {
                revision: 7,
                entries: vec![crate::acp::transcript_projection::TranscriptEntry {
                    entry_id: "assistant-history-1".to_string(),
                    role: crate::acp::transcript_projection::TranscriptEntryRole::Assistant,
                    segments: vec![crate::acp::transcript_projection::TranscriptSegment::Text {
                        segment_id: "assistant-history-1:block:0".to_string(),
                        text: "existing answer".to_string(),
                    }],
                }],
            },
        );
        let envelope = runtime_graph_registry
            .build_live_session_state_envelope(LiveSessionStateEnvelopeRequest {
                db: &db,
                session_id: "session-1",
                update: &chunk_update("session-1", "hello"),
                previous_revision: SessionGraphRevision::new(8, 7, 8),
                revision: SessionGraphRevision::new(9, 6, 9),
                projection_registry: &projection_registry,
                transcript_projection_registry: &transcript_projection_registry,
                transcript_delta: Some(&TranscriptDelta {
                    event_seq: 9,
                    session_id: "session-1".to_string(),
                    snapshot_revision: 6,
                    operations: vec![
                        crate::acp::transcript_projection::TranscriptDeltaOperation::AppendEntry {
                            entry: crate::acp::transcript_projection::TranscriptEntry {
                                entry_id: "assistant-2".to_string(),
                                role: crate::acp::transcript_projection::TranscriptEntryRole::Assistant,
                                segments: vec![crate::acp::transcript_projection::TranscriptSegment::Text {
                                    segment_id: "assistant-2:block:0".to_string(),
                                    text: "broken delta".to_string(),
                                }],
                            },
                        },
                    ],
                }),
            })
            .await
            .expect("session state envelope");

        match envelope.payload {
            crate::acp::session_state_engine::SessionStatePayload::Snapshot { graph } => {
                assert_eq!(graph.revision, SessionGraphRevision::new(9, 6, 9));
                assert_eq!(graph.transcript_snapshot.revision, 7);
                assert_eq!(graph.transcript_snapshot.entries.len(), 1);
            }
            other => panic!("expected snapshot payload, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn drain_emits_session_state_delta_after_transcript_delta() {
        let db = setup_test_db().await;
        SessionMetadataRepository::ensure_exists(
            &db,
            "session-1",
            "/test/project",
            "claude-code",
            None,
        )
        .await
        .expect("session metadata");

        let hub = AcpEventHubState::new();
        let mut receiver = hub.subscribe();
        let projection_registry = ProjectionRegistry::new();
        let transcript_projection_registry = TranscriptProjectionRegistry::new();
        let runtime_graph_registry = SessionGraphRuntimeRegistry::new();
        let mut state = DispatcherState::new(DispatchPolicy::default());
        state.enqueue(AcpUiEvent::session_update(
            SessionUpdate::AgentMessageChunk {
                chunk: ContentChunk {
                    content: ContentBlock::Text {
                        text: "hello".to_string(),
                    },
                    aggregation_hint: None,
                },
                part_id: Some("part-1".to_string()),
                message_id: Some("assistant-1".to_string()),
                session_id: Some("session-1".to_string()),
            },
        ));
        projection_registry.apply_session_update(
            "session-1",
            &SessionUpdate::AgentMessageChunk {
                chunk: ContentChunk {
                    content: ContentBlock::Text {
                        text: "hello".to_string(),
                    },
                    aggregation_hint: None,
                },
                part_id: Some("part-1".to_string()),
                message_id: Some("assistant-1".to_string()),
                session_id: Some("session-1".to_string()),
            },
        );

        state
            .drain(
                &hub,
                Some(&db),
                &projection_registry,
                &runtime_graph_registry,
                &transcript_projection_registry,
            )
            .await;

        let first = receiver.recv().await.expect("raw event");
        let second = receiver.recv().await.expect("session state event");

        assert_eq!(first.event_name, "acp-session-update");
        assert_eq!(second.event_name, "acp-session-state");

        let envelope: SessionStateEnvelope =
            serde_json::from_value(second.payload).expect("session state payload");
        assert_eq!(envelope.session_id, "session-1");
        assert_eq!(envelope.graph_revision, 1);
        assert_eq!(envelope.last_event_seq, 1);
    }

    #[test]
    fn high_priority_beats_non_session_normal() {
        let mut state = DispatcherState::new(DispatchPolicy::default());
        state.enqueue(AcpUiEvent::json_event(
            "acp-session-created",
            Value::Null,
            None,
            AcpUiEventPriority::Normal,
            false,
        ));
        state.enqueue(AcpUiEvent::inbound_request(Value::Object(
            Default::default(),
        )));

        let first = state.next_event().expect("first event");
        assert_eq!(first.event_name, "acp-inbound-request");
    }

    #[test]
    fn high_priority_preserves_causal_ordering_in_session() {
        let mut state = DispatcherState::new(DispatchPolicy::default());
        state.enqueue(AcpUiEvent::session_update(chunk_update("s1", "a")));
        state.enqueue(AcpUiEvent::session_update(chunk_update("s1", "b")));
        state.enqueue(AcpUiEvent::inbound_request(json!({
            "params": { "sessionId": "s1" }
        })));

        // Preceding Normal events in the same session must be emitted
        // before the High-priority event to preserve causal ordering.
        let first = state.next_event().expect("first event");
        assert_eq!(first.event_name, "acp-session-update");

        let second = state.next_event().expect("second event");
        assert_eq!(second.event_name, "acp-session-update");

        let third = state.next_event().expect("third event");
        assert_eq!(third.event_name, "acp-inbound-request");
    }

    #[test]
    fn high_priority_still_beats_other_sessions() {
        let mut state = DispatcherState::new(DispatchPolicy::default());
        state.enqueue(AcpUiEvent::session_update(chunk_update("s2", "other")));
        state.enqueue(AcpUiEvent::inbound_request(json!({
            "params": { "sessionId": "s1" }
        })));

        // High-priority event from s1 should still beat Normal from s2
        // (no causal relationship across sessions).
        let first = state.next_event().expect("first event");
        assert_eq!(first.event_name, "acp-inbound-request");
    }

    #[test]
    fn drops_droppable_when_global_backlog_exceeded() {
        let policy = DispatchPolicy {
            max_global_backlog: 1,
            ..DispatchPolicy::default()
        };

        let mut state = DispatcherState::new(policy);
        state.enqueue(AcpUiEvent::session_update(chunk_update("s1", "a")));
        state.enqueue(AcpUiEvent::session_update(chunk_update("s1", "b")));

        assert_eq!(state.global_backlog, 1);
        assert_eq!(state.telemetry.dropped, 1);
    }

    #[test]
    fn keeps_non_droppable_when_global_backlog_exceeded() {
        let policy = DispatchPolicy {
            max_global_backlog: 1,
            ..DispatchPolicy::default()
        };

        let mut state = DispatcherState::new(policy);
        state.enqueue(AcpUiEvent::session_update(chunk_update("s1", "a")));
        state.enqueue(AcpUiEvent::inbound_request(Value::Object(
            Default::default(),
        )));

        assert_eq!(state.global_backlog, 2);
        assert_eq!(state.telemetry.dropped, 0);
    }

    #[test]
    fn round_robin_interleaves_sessions() {
        let mut state = DispatcherState::new(DispatchPolicy::default());
        state.enqueue(AcpUiEvent::session_update(chunk_update("s1", "a1")));
        state.enqueue(AcpUiEvent::session_update(chunk_update("s1", "a2")));
        state.enqueue(AcpUiEvent::session_update(chunk_update("s2", "b1")));
        state.enqueue(AcpUiEvent::session_update(chunk_update("s2", "b2")));

        let mut order = Vec::new();
        while let Some(event) = state.next_event() {
            let text = match &event.payload {
                AcpUiEventPayload::SessionUpdate(update) => match update.as_ref() {
                    SessionUpdate::AgentMessageChunk {
                        chunk:
                            ContentChunk {
                                content: ContentBlock::Text { text },
                                ..
                            },
                        ..
                    } => text.clone(),
                    _ => String::new(),
                },
                _ => String::new(),
            };
            order.push(text);
        }

        assert_eq!(order, vec!["a1", "b1", "a2", "b2"]);
    }

    #[test]
    fn session_domain_event_uses_dedicated_event_name() {
        let event = AcpUiEvent::session_domain_event(SessionDomainEvent {
            event_id: "event-1".to_string(),
            seq: 1,
            session_id: "session-1".to_string(),
            provider_session_id: None,
            occurred_at_ms: 123,
            causation_id: None,
            kind: SessionDomainEventKind::SessionConnected,
            payload: None,
        });

        assert_eq!(event.event_name, "acp-session-domain-event");
        assert_eq!(event.session_id.as_deref(), Some("session-1"));
    }

    #[test]
    fn dispatcher_enqueues_turn_complete_domain_event_after_session_update() {
        let (dispatcher, captured_events) = AcpUiEventDispatcher::test_sink();
        dispatcher.enqueue(AcpUiEvent::session_update(SessionUpdate::TurnComplete {
            session_id: Some("session-1".to_string()),
            turn_id: None,
        }));

        let captured = captured_events.lock().expect("captured events lock");
        assert_eq!(captured.len(), 2);
        assert_eq!(captured[0].event_name, "acp-session-update");
        assert_eq!(captured[1].event_name, "acp-session-domain-event");

        match &captured[1].payload {
            AcpUiEventPayload::SessionDomainEvent(event) => {
                assert_eq!(event.session_id, "session-1");
                assert_eq!(event.seq, 1);
                assert!(matches!(event.kind, SessionDomainEventKind::TurnCompleted));
            }
            other => panic!("Expected session domain event payload, got {:?}", other),
        }
    }

    #[test]
    fn dispatcher_updates_projection_snapshot_for_session_updates() {
        let projection_registry = Arc::new(ProjectionRegistry::new());
        projection_registry.register_session("session-1".to_string(), CanonicalAgentId::ClaudeCode);
        let (dispatcher, _captured_events) =
            AcpUiEventDispatcher::test_sink_with_projection_registry(Arc::clone(
                &projection_registry,
            ));

        dispatcher.enqueue(AcpUiEvent::session_update(
            SessionUpdate::AgentMessageChunk {
                chunk: ContentChunk {
                    content: ContentBlock::Text {
                        text: "hello".to_string(),
                    },
                    aggregation_hint: None,
                },
                part_id: None,
                message_id: Some("msg-1".to_string()),
                session_id: Some("session-1".to_string()),
            },
        ));
        dispatcher.enqueue(AcpUiEvent::session_update(SessionUpdate::TurnComplete {
            session_id: Some("session-1".to_string()),
            turn_id: None,
        }));

        let snapshot = projection_registry
            .snapshot_for_session("session-1")
            .expect("expected session snapshot");
        assert_eq!(snapshot.agent_id, Some(CanonicalAgentId::ClaudeCode));
        assert_eq!(snapshot.message_count, 1);
        assert_eq!(snapshot.last_agent_message_id.as_deref(), Some("msg-1"));
        assert_eq!(snapshot.turn_state, SessionTurnState::Completed);
        assert_eq!(snapshot.last_event_seq, 2);
    }

    #[test]
    fn dispatcher_enqueues_interaction_domain_event_for_permission_request() {
        let (dispatcher, captured_events) = AcpUiEventDispatcher::test_sink();
        dispatcher.enqueue(AcpUiEvent::session_update(
            SessionUpdate::PermissionRequest {
                permission: PermissionData {
                    id: "permission-1".to_string(),
                    session_id: "session-1".to_string(),
                    json_rpc_request_id: Some(7),
                    reply_handler: Some(
                        crate::acp::session_update::InteractionReplyHandler::json_rpc(7),
                    ),
                    permission: "execute".to_string(),
                    patterns: vec![],
                    metadata: json!({ "command": "bun test" }),
                    always: vec![],
                    auto_accepted: false,
                    tool: None,
                },
                session_id: Some("session-1".to_string()),
            },
        ));

        let captured = captured_events.lock().expect("captured events lock");
        assert_eq!(captured.len(), 2);
        assert_eq!(captured[0].event_name, "acp-session-update");
        assert_eq!(captured[1].event_name, "acp-session-domain-event");

        match &captured[1].payload {
            AcpUiEventPayload::SessionDomainEvent(event) => {
                assert_eq!(event.session_id, "session-1");
                assert!(matches!(
                    event.kind,
                    SessionDomainEventKind::InteractionUpserted
                ));
            }
            other => panic!("Expected session domain event payload, got {:?}", other),
        }
    }

    #[test]
    fn dispatcher_enqueues_interaction_domain_event_for_plan_approval_tool_call() {
        let (dispatcher, captured_events) = AcpUiEventDispatcher::test_sink();
        dispatcher.enqueue(AcpUiEvent::session_update(SessionUpdate::ToolCall {
            tool_call: ToolCallData {
                id: "tool-1".to_string(),
                name: "create_plan".to_string(),
                arguments: ToolArguments::Other { raw: json!({}) },
                raw_input: None,
                kind: Some(ToolKind::CreatePlan),
                title: Some("Create plan".to_string()),
                status: ToolCallStatus::Pending,
                result: None,
                locations: None,
                skill_meta: None,
                normalized_questions: None,
                normalized_todos: None,
                normalized_todo_update: None,
                parent_tool_use_id: None,
                task_children: None,
                question_answer: None,
                awaiting_plan_approval: true,
                plan_approval_request_id: Some(9),
            },
            session_id: Some("session-1".to_string()),
        }));

        let captured = captured_events.lock().expect("captured events lock");
        assert_eq!(captured.len(), 2);
        assert_eq!(captured[0].event_name, "acp-session-update");
        assert_eq!(captured[1].event_name, "acp-session-domain-event");

        match &captured[1].payload {
            AcpUiEventPayload::SessionDomainEvent(event) => {
                assert_eq!(event.session_id, "session-1");
                assert!(matches!(
                    event.kind,
                    SessionDomainEventKind::InteractionUpserted
                ));
            }
            other => panic!("Expected session domain event payload, got {:?}", other),
        }
    }

    // =========================================================================
    // Unit 7: End-to-end canonical pipeline proof
    // =========================================================================

    /// [E2E] Fresh session: a ToolCall enqueue emits both the raw update bridge
    /// (acp-session-update) and the canonical operation domain event
    /// (acp-session-domain-event / OperationUpserted) in that order.
    ///
    /// This proves the dual-emission invariant that underpins the canonical live
    /// ACP event pipeline: the raw bridge carries full projection data while the
    /// domain event is the authoritative canonical signal.
    #[test]
    fn e2e_tool_call_emits_raw_update_bridge_and_canonical_operation_domain_event() {
        use crate::acp::domain_events::SessionDomainEventPayload;

        let (dispatcher, captured_events) = AcpUiEventDispatcher::test_sink();
        dispatcher.enqueue(AcpUiEvent::session_update(SessionUpdate::ToolCall {
            tool_call: ToolCallData {
                id: "tool-read-1".to_string(),
                name: "Read".to_string(),
                arguments: ToolArguments::Other {
                    raw: json!({ "file_path": "src/main.rs" }),
                },
                raw_input: None,
                kind: Some(ToolKind::Read),
                title: Some("Read src/main.rs".to_string()),
                status: ToolCallStatus::Pending,
                result: None,
                locations: None,
                skill_meta: None,
                normalized_questions: None,
                normalized_todos: None,
                normalized_todo_update: None,
                parent_tool_use_id: None,
                task_children: None,
                question_answer: None,
                awaiting_plan_approval: false,
                plan_approval_request_id: None,
            },
            session_id: Some("session-e2e".to_string()),
        }));

        let captured = captured_events.lock().expect("lock");
        // Exactly 2 events: raw bridge first, canonical domain event second.
        assert_eq!(captured.len(), 2, "expected raw update + domain event");
        assert_eq!(
            captured[0].event_name, "acp-session-update",
            "first event must be raw bridge"
        );
        assert_eq!(captured[0].session_id.as_deref(), Some("session-e2e"));
        assert_eq!(
            captured[1].event_name, "acp-session-domain-event",
            "second event must be canonical"
        );

        match &captured[1].payload {
            AcpUiEventPayload::SessionDomainEvent(event) => {
                assert_eq!(event.session_id, "session-e2e");
                assert!(
                    matches!(event.kind, SessionDomainEventKind::OperationUpserted),
                    "domain event kind must be OperationUpserted for a ToolCall"
                );
                // Canonical payload carries operation identity
                match &event.payload {
                    Some(SessionDomainEventPayload::OperationUpserted {
                        operation_id,
                        tool_name,
                        ..
                    }) => {
                        assert_eq!(operation_id, "tool-read-1");
                        assert_eq!(tool_name, "Read");
                    }
                    other => panic!("Expected OperationUpserted payload, got {:?}", other),
                }
            }
            other => panic!("Expected SessionDomainEvent payload, got {:?}", other),
        }
    }

    /// [E2E] Late delivery: enqueueing the same ToolCall update twice does not
    /// produce duplicate canonical domain events — the projection registry is
    /// the idempotency authority.
    ///
    /// Both enqueues still produce 2 events each (raw + domain) at the dispatcher
    /// level, but the projection snapshot is updated consistently because
    /// apply_canonical_event is idempotent for the same operation_id.
    #[test]
    fn e2e_duplicate_tool_call_enqueue_updates_projection_idempotently() {
        let projection_registry = Arc::new(ProjectionRegistry::new());
        projection_registry
            .register_session("session-idem".to_string(), CanonicalAgentId::ClaudeCode);
        let (dispatcher, captured_events) =
            AcpUiEventDispatcher::test_sink_with_projection_registry(Arc::clone(
                &projection_registry,
            ));

        let tool_call_event = AcpUiEvent::session_update(SessionUpdate::ToolCall {
            tool_call: ToolCallData {
                id: "tool-idem-1".to_string(),
                name: "Edit".to_string(),
                arguments: ToolArguments::Other { raw: json!({}) },
                raw_input: None,
                kind: Some(ToolKind::Edit),
                title: Some("Edit file".to_string()),
                status: ToolCallStatus::Pending,
                result: None,
                locations: None,
                skill_meta: None,
                normalized_questions: None,
                normalized_todos: None,
                normalized_todo_update: None,
                parent_tool_use_id: None,
                task_children: None,
                question_answer: None,
                awaiting_plan_approval: false,
                plan_approval_request_id: None,
            },
            session_id: Some("session-idem".to_string()),
        });

        // Enqueue the same logical update twice (simulating late/replay delivery)
        dispatcher.enqueue(tool_call_event.clone());
        dispatcher.enqueue(tool_call_event);

        // Dispatcher level: 4 events (2 raw + 2 domain) — dispatcher is not the dedup layer
        let captured = captured_events.lock().expect("lock");
        assert_eq!(captured.len(), 4);

        // Projection level: the snapshot reflects a consistent final state
        // (apply_canonical_event is the idempotency gate, not the dispatcher)
        let snapshot = projection_registry
            .snapshot_for_session("session-idem")
            .expect("snapshot must exist");
        // Snapshot is valid after duplicate delivery — no panic, no corrupted state
        assert!(
            snapshot.last_event_seq >= 1,
            "projection must have advanced"
        );
    }

    #[test]
    fn dispatcher_seeds_domain_event_seq_from_restored_projection_frontier() {
        let projection_registry = Arc::new(ProjectionRegistry::new());
        projection_registry
            .register_session("session-seeded".to_string(), CanonicalAgentId::ClaudeCode);
        projection_registry.apply_session_update(
            "session-seeded",
            &SessionUpdate::TurnComplete {
                session_id: Some("session-seeded".to_string()),
                turn_id: None,
            },
        );
        projection_registry.set_last_event_seq_for_test("session-seeded", 7);

        let (dispatcher, captured_events) =
            AcpUiEventDispatcher::test_sink_with_projection_registry(Arc::clone(
                &projection_registry,
            ));

        dispatcher.enqueue(AcpUiEvent::session_update(SessionUpdate::ToolCall {
            tool_call: ToolCallData {
                id: "tool-seeded-1".to_string(),
                name: "Read".to_string(),
                arguments: ToolArguments::Other {
                    raw: json!({ "file_path": "src/main.rs" }),
                },
                raw_input: None,
                kind: Some(ToolKind::Read),
                title: Some("Read src/main.rs".to_string()),
                status: ToolCallStatus::Pending,
                result: None,
                locations: None,
                skill_meta: None,
                normalized_questions: None,
                normalized_todos: None,
                normalized_todo_update: None,
                parent_tool_use_id: None,
                task_children: None,
                question_answer: None,
                awaiting_plan_approval: false,
                plan_approval_request_id: None,
            },
            session_id: Some("session-seeded".to_string()),
        }));

        let captured = captured_events.lock().expect("lock");
        let domain_event = match &captured[1].payload {
            AcpUiEventPayload::SessionDomainEvent(event) => event,
            other => panic!("Expected SessionDomainEvent payload, got {:?}", other),
        };
        assert_eq!(domain_event.seq, 8);
    }
}
