use super::*;

const MAX_PRE_RESERVATION_DRAIN_BATCHES: usize = 8;

#[derive(Clone)]
pub struct AcpUiEventDispatcher {
    pub(super) tx: Option<mpsc::UnboundedSender<AcpUiEvent>>,
    /// Process-local ordering for the separate `SessionDomainEvent` dispatch
    /// stream. This is not the durable delivery `event_seq` assigned by the
    /// database-backed `SessionEventWriter`.
    pub(super) dispatch_domain_event_seq: Arc<AtomicI64>,
    pub(super) projection_registry: Arc<ProjectionRegistry>,
    pub(super) runtime_graph_registry: Arc<SessionGraphRuntimeRegistry>,
    pub(super) transcript_projection_registry: Arc<TranscriptProjectionRegistry>,
    pub(super) pre_reservation_event_buffer: Arc<PreReservationEventBuffer>,
    // Held so the registry's lifetime is tied to the dispatcher; cloned into
    // `run_dispatch_loop` and read out of Tauri state by
    // `publish_direct_session_update`. Kept on the struct for symmetry with
    // the other registries even though no method reads it directly.
    #[allow(dead_code)]
    pub(super) journal_write_lock_registry: Arc<JournalWriteLockRegistry>,
    #[cfg(test)]
    pub(super) bypass_pre_reservation_gate: bool,
    #[cfg(test)]
    pub(super) test_sink: Option<Arc<std::sync::Mutex<Vec<AcpUiEvent>>>>,
}

impl AcpUiEventDispatcher {
    #[must_use]
    pub fn new(app_handle: Option<AppHandle>, policy: DispatchPolicy) -> Self {
        let Some(handle) = app_handle else {
            return Self {
                tx: None,
                dispatch_domain_event_seq: Arc::new(AtomicI64::new(0)),
                projection_registry: Arc::new(ProjectionRegistry::new()),
                runtime_graph_registry: Arc::new(SessionGraphRuntimeRegistry::new()),
                transcript_projection_registry: Arc::new(TranscriptProjectionRegistry::new()),
                pre_reservation_event_buffer: Arc::new(PreReservationEventBuffer::new()),
                journal_write_lock_registry: Arc::new(JournalWriteLockRegistry::new()),
                #[cfg(test)]
                bypass_pre_reservation_gate: false,
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
        let pre_reservation_event_buffer = handle
            .try_state::<Arc<PreReservationEventBuffer>>()
            .map(|state| state.inner().clone())
            .unwrap_or_else(|| Arc::new(PreReservationEventBuffer::new()));
        let journal_write_lock_registry = handle
            .try_state::<Arc<JournalWriteLockRegistry>>()
            .map(|state| state.inner().clone())
            .unwrap_or_else(|| Arc::new(JournalWriteLockRegistry::new()));
        let Some(hub_state) = handle.try_state::<Arc<AcpEventHubState>>() else {
            tracing::warn!("ACP event hub state unavailable; UI event dispatcher disabled");
            return Self {
                tx: None,
                dispatch_domain_event_seq: Arc::new(AtomicI64::new(0)),
                projection_registry,
                runtime_graph_registry,
                transcript_projection_registry,
                pre_reservation_event_buffer,
                journal_write_lock_registry,
                #[cfg(test)]
                bypass_pre_reservation_gate: false,
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
            runtime_graph_registry.clone(),
            transcript_projection_registry.clone(),
            journal_write_lock_registry.clone(),
        ));

        Self {
            tx: Some(tx),
            dispatch_domain_event_seq: Arc::new(AtomicI64::new(0)),
            projection_registry,
            runtime_graph_registry,
            transcript_projection_registry,
            pre_reservation_event_buffer,
            journal_write_lock_registry,
            #[cfg(test)]
            bypass_pre_reservation_gate: false,
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
    pub fn test_sink_with_pre_reservation_gate() -> (Self, Arc<std::sync::Mutex<Vec<AcpUiEvent>>>) {
        Self::test_sink_with_projection_registry_and_gate(
            Arc::new(ProjectionRegistry::new()),
            false,
        )
    }

    #[cfg(test)]
    #[must_use]
    pub fn test_sink_with_projection_registry_and_pre_reservation_gate(
        projection_registry: Arc<ProjectionRegistry>,
    ) -> (Self, Arc<std::sync::Mutex<Vec<AcpUiEvent>>>) {
        Self::test_sink_with_projection_registry_and_gate(projection_registry, false)
    }

    #[cfg(test)]
    #[must_use]
    pub fn test_sink_with_projection_registry(
        projection_registry: Arc<ProjectionRegistry>,
    ) -> (Self, Arc<std::sync::Mutex<Vec<AcpUiEvent>>>) {
        Self::test_sink_with_projection_registry_and_gate(projection_registry, true)
    }

    #[cfg(test)]
    fn test_sink_with_projection_registry_and_gate(
        projection_registry: Arc<ProjectionRegistry>,
        bypass_pre_reservation_gate: bool,
    ) -> (Self, Arc<std::sync::Mutex<Vec<AcpUiEvent>>>) {
        let sink = Arc::new(std::sync::Mutex::new(Vec::new()));
        (
            Self {
                tx: None,
                dispatch_domain_event_seq: Arc::new(AtomicI64::new(0)),
                projection_registry,
                runtime_graph_registry: Arc::new(SessionGraphRuntimeRegistry::new()),
                transcript_projection_registry: Arc::new(TranscriptProjectionRegistry::new()),
                pre_reservation_event_buffer: Arc::new(PreReservationEventBuffer::new()),
                journal_write_lock_registry: Arc::new(JournalWriteLockRegistry::new()),
                bypass_pre_reservation_gate,
                test_sink: Some(Arc::clone(&sink)),
            },
            sink,
        )
    }

    pub fn enqueue(&self, event: AcpUiEvent) {
        let event = stamp_session_update_event(self.runtime_graph_registry.as_ref(), event);
        #[cfg(test)]
        let bypass_pre_reservation_gate = self.bypass_pre_reservation_gate;
        #[cfg(not(test))]
        let bypass_pre_reservation_gate = false;

        if !bypass_pre_reservation_gate && self.should_hold_pre_reservation_event(&event) {
            return;
        }

        self.enqueue_lifecycle_known(event);
    }

    fn enqueue_lifecycle_known(&self, event: AcpUiEvent) {
        // Derive the separate domain-event dispatch stream without mutating
        // canonical projections. Durable event allocation and projection
        // application happen together in the persistence path.
        let derived_domain_event = session_domain_event_from_update(&event.payload)
            .map(|e| self.create_session_domain_event(&e.session_id, e.kind, e.payload));

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

    fn should_hold_pre_reservation_event(&self, event: &AcpUiEvent) -> bool {
        let AcpUiEventPayload::SessionUpdate(update) = &event.payload else {
            return false;
        };
        let Some(session_id) = update.session_id() else {
            tracing::warn!(
                event_name = event.event_name,
                "Rejecting pre-reservation session update without session id"
            );
            return true;
        };
        let lifecycle_exists = self
            .runtime_graph_registry
            .supervisor()
            .snapshot_for_session(session_id)
            .is_some();
        match self.pre_reservation_event_buffer.decide_ingress(
            session_id,
            lifecycle_exists,
            update.as_ref(),
        ) {
            PreReservationIngressDecision::Allow => false,
            PreReservationIngressDecision::Buffered | PreReservationIngressDecision::Rejected => {
                true
            }
        }
    }

    pub fn begin_pre_reservation_drain(&self, session_id: &str) {
        self.pre_reservation_event_buffer.begin_draining(session_id);
    }

    pub fn drain_pre_reservation_events(&self, session_id: &str) {
        let mut batch = self
            .pre_reservation_event_buffer
            .take_draining_batch(session_id);
        let mut drained_batches = 0usize;
        loop {
            drained_batches = drained_batches.saturating_add(1);
            for update in batch {
                self.enqueue_lifecycle_known(AcpUiEvent::session_update(update));
            }

            if drained_batches >= MAX_PRE_RESERVATION_DRAIN_BATCHES {
                tracing::warn!(
                    session_id,
                    max_batches = MAX_PRE_RESERVATION_DRAIN_BATCHES,
                    "Stopping pre-reservation drain after bounded batch limit"
                );
                self.pre_reservation_event_buffer
                    .discard(session_id, "drain_batch_limit");
                break;
            }

            let Some(next_batch) = self
                .pre_reservation_event_buffer
                .finish_draining_or_next_batch(session_id)
            else {
                break;
            };
            batch = next_batch;
        }
    }

    pub fn discard_pre_reservation_events(&self, session_id: &str, reason: &'static str) {
        self.pre_reservation_event_buffer
            .discard(session_id, reason);
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

    pub(crate) fn enqueue_interaction_transition_state(
        &self,
        session_id: &str,
        interaction_patch: InteractionSnapshot,
    ) {
        let Some(session_snapshot) = self.projection_registry.snapshot_for_session(session_id)
        else {
            tracing::warn!(
                session_id,
                interaction_id = %interaction_patch.id,
                "Skipping interaction transition state envelope because the session projection is missing"
            );
            return;
        };
        let previous_runtime_snapshot =
            self.runtime_graph_registry.snapshot_for_session(session_id);
        let transcript_snapshot = self
            .transcript_projection_registry
            .snapshot_for_session(session_id);
        let previous_transcript_revision = transcript_snapshot
            .as_ref()
            .map(|snapshot| snapshot.revision)
            .unwrap_or(0);
        let previous_graph_revision = previous_runtime_snapshot.graph_revision;
        let graph_revision = self
            .runtime_graph_registry
            .advance_graph_revision_with_seed(session_id, previous_graph_revision);
        let revision = SessionGraphRevision::new(
            graph_revision,
            previous_transcript_revision,
            session_snapshot.last_event_seq,
        );
        let projection_snapshot = self.projection_registry.session_projection(session_id);
        let runtime_snapshot = self.runtime_graph_registry.snapshot_for_session(session_id);
        let activity = select_session_graph_activity(
            &runtime_snapshot.lifecycle,
            &session_snapshot.turn_state,
            &projection_snapshot.operations,
            &projection_snapshot.interactions,
            session_snapshot.active_turn_failure.as_ref(),
        );
        let active_streaming_tail = transcript_snapshot.as_ref().and_then(|snapshot| {
            select_active_streaming_tail(&session_snapshot.turn_state, &activity, snapshot)
        });
        let operation_patches = match interaction_patch.canonical_operation_id.as_deref() {
            Some(operation_id) => match self.projection_registry.operation(operation_id) {
                Some(operation) => vec![operation],
                None => {
                    tracing::warn!(
                        session_id,
                        interaction_id = %interaction_patch.id,
                        operation_id,
                        "Interaction transition state envelope has no linked operation patch"
                    );
                    Vec::new()
                }
            },
            None => Vec::new(),
        };
        let mut changed_fields = turn_terminal_change_fields();
        changed_fields.insert(0, SessionStateField::Interactions);
        if !operation_patches.is_empty() {
            changed_fields.insert(0, SessionStateField::Operations);
        }
        let envelope = build_delta_envelope(DeltaEnvelopeParts {
            session_id,
            from_revision: SessionGraphRevision::new(
                previous_graph_revision,
                previous_transcript_revision,
                session_snapshot.last_event_seq.saturating_sub(1),
            ),
            to_revision: revision,
            projection: DeltaSessionProjectionFields {
                activity,
                turn_state: session_snapshot.turn_state,
                active_turn_failure: session_snapshot.active_turn_failure,
                last_terminal_turn_id: session_snapshot.last_terminal_turn_id,
                active_streaming_tail,
            },
            transcript_operations: Vec::new(),
            operation_patches,
            interaction_patches: vec![interaction_patch],
            changed_fields,
        });
        self.enqueue_session_state_envelope(envelope);
    }

    fn enqueue_session_state_envelope(&self, envelope: SessionStateEnvelope) {
        if let Some(event) = AcpUiEvent::session_state_envelope(&envelope) {
            self.enqueue(event);
        }
    }

    fn create_session_domain_event(
        &self,
        session_id: &str,
        kind: SessionDomainEventKind,
        payload: Option<SessionDomainEventPayload>,
    ) -> AcpUiEvent {
        let event = SessionDomainEvent {
            event_id: format!("session-domain-event-{}", Uuid::new_v4()),
            seq: self
                .dispatch_domain_event_seq
                .fetch_add(1, Ordering::Relaxed)
                + 1,
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

pub(super) fn session_domain_event_from_update(
    payload: &AcpUiEventPayload,
) -> Option<SessionDomainEvent> {
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
