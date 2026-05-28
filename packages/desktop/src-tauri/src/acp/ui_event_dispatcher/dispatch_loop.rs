use super::*;

pub(super) async fn run_dispatch_loop(
    hub: Arc<AcpEventHubState>,
    db: Option<DbConn>,
    policy: DispatchPolicy,
    mut rx: mpsc::UnboundedReceiver<AcpUiEvent>,
    projection_registry: Arc<ProjectionRegistry>,
    runtime_graph_registry: Arc<SessionGraphRuntimeRegistry>,
    transcript_projection_registry: Arc<TranscriptProjectionRegistry>,
    journal_write_lock_registry: Arc<JournalWriteLockRegistry>,
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
                journal_write_lock_registry.as_ref(),
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
            journal_write_lock_registry.as_ref(),
        )
        .await;
}

pub(super) struct DispatcherState {
    pub(super) policy: DispatchPolicy,
    pub(super) per_session: HashMap<String, VecDeque<AcpUiEvent>>,
    pub(super) session_order: VecDeque<String>,
    pub(super) non_session: VecDeque<AcpUiEvent>,
    pub(super) global_backlog: usize,
    pub(super) round_robin_cursor: usize,
    pub(super) telemetry: DispatcherTelemetry,
}

impl DispatcherState {
    pub(super) fn new(policy: DispatchPolicy) -> Self {
        Self {
            policy,
            per_session: HashMap::new(),
            session_order: VecDeque::new(),
            non_session: VecDeque::new(),
            global_backlog: 0,
            round_robin_cursor: 0,
            telemetry: DispatcherTelemetry::new(),
        }
    }

    pub(super) fn enqueue(&mut self, event: AcpUiEvent) {
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

    pub(super) async fn drain(
        &mut self,
        hub: &AcpEventHubState,
        db: Option<&DbConn>,
        projection_registry: &ProjectionRegistry,
        runtime_graph_registry: &SessionGraphRuntimeRegistry,
        transcript_projection_registry: &TranscriptProjectionRegistry,
        journal_write_lock_registry: &JournalWriteLockRegistry,
    ) {
        while self.global_backlog > 0 {
            let Some(event) = self.next_event() else {
                break;
            };

            self.global_backlog = self.global_backlog.saturating_sub(1);

            // Acquire the per-session journal+projection critical-section lock if this event is
            // bound to a session. The lock is held across `persist_dispatch_event` and the
            // subsequent `event.publish` so concurrent direct publishes cannot interleave their
            // journal writes or wire emissions with ours for the same session.
            let session_lock_guard = event
                .session_id
                .as_deref()
                .map(|session_id| journal_write_lock_registry.lock_for(session_id));
            let _journal_guard = if let Some(lock) = session_lock_guard.as_ref() {
                Some(lock.lock().await)
            } else {
                None
            };

            let dispatch_effects = persist_dispatch_event(
                db,
                &event,
                projection_registry,
                runtime_graph_registry,
                transcript_projection_registry,
            )
            .await;

            if should_publish_raw_event(&event, &dispatch_effects) {
                if let Err(error) = event.publish(hub) {
                    tracing::error!(
                        error = %error,
                        event_name = event.event_name,
                        session_id = ?event.session_id,
                        "Failed to emit ACP UI event"
                    );
                }
            }
            if let Some(envelope) = dispatch_effects.session_state_envelope {
                let mut envelopes = vec![envelope];
                envelopes.extend(dispatch_effects.additional_session_state_envelopes);
                for envelope in envelopes {
                    let Some(session_state_event) = AcpUiEvent::session_state_envelope(&envelope)
                    else {
                        continue;
                    };
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
            }

            self.telemetry.emitted += 1;
            self.telemetry.max_wait_ms = self
                .telemetry
                .max_wait_ms
                .max(event.created_at.elapsed().as_millis());

            self.telemetry.maybe_report(self.global_backlog);
        }

        self.telemetry.maybe_report(self.global_backlog);
    }

    pub(super) fn next_event(&mut self) -> Option<AcpUiEvent> {
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
