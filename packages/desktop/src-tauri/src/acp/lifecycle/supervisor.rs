use crate::acp::lifecycle::{
    LifecycleCheckpoint, LifecycleState, LifecycleStatus, ReadyDispatchError, ReadyDispatchPermit,
};
use crate::acp::projections::ProjectionRegistry;
use crate::acp::session_state_engine::runtime_registry::SessionGraphRuntimeSnapshot;
use crate::acp::session_state_engine::SessionGraphCapabilities;
use crate::acp::session_update::SessionUpdate;
use crate::db::repository::SessionJournalEventRepository;
use dashmap::DashMap;
use sea_orm::DbConn;
use std::fmt;
#[cfg(test)]
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::Mutex;
#[cfg(test)]
use tokio::sync::Notify;

#[cfg(test)]
#[derive(Debug, Clone)]
pub(crate) struct SupervisorTestPause {
    reached: Arc<Notify>,
    resume: Arc<Notify>,
}

#[cfg(test)]
impl SupervisorTestPause {
    pub(crate) fn new() -> Self {
        Self {
            reached: Arc::new(Notify::new()),
            resume: Arc::new(Notify::new()),
        }
    }

    pub(crate) async fn wait_until_reached(&self) {
        self.reached.notified().await;
    }

    pub(crate) fn resume(&self) {
        self.resume.notify_one();
    }
}

#[derive(Debug, Clone)]
struct SessionSupervisorEntry {
    checkpoint: LifecycleCheckpoint,
    runtime_epoch: u64,
    checkpoint_version: u64,
}

impl SessionSupervisorEntry {
    fn new(checkpoint: LifecycleCheckpoint) -> Self {
        Self {
            checkpoint,
            runtime_epoch: 1,
            checkpoint_version: 1,
        }
    }

    fn advance(&self, checkpoint: LifecycleCheckpoint) -> Self {
        Self {
            checkpoint,
            runtime_epoch: self.runtime_epoch.saturating_add(1),
            checkpoint_version: self.checkpoint_version.saturating_add(1),
        }
    }

    fn replace_checkpoint(&self, checkpoint: LifecycleCheckpoint) -> Self {
        Self {
            checkpoint,
            runtime_epoch: self.runtime_epoch,
            checkpoint_version: self.checkpoint_version.saturating_add(1),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionSupervisorError {
    AlreadyReserved {
        session_id: String,
    },
    SessionNotFound {
        session_id: String,
    },
    InvalidActivationState {
        session_id: String,
        status: LifecycleStatus,
    },
    Persistence {
        message: String,
    },
}

impl fmt::Display for SessionSupervisorError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::AlreadyReserved { session_id } => {
                write!(f, "session {session_id} is already reserved")
            }
            Self::SessionNotFound { session_id } => {
                write!(f, "session {session_id} is not lifecycle-reserved")
            }
            Self::InvalidActivationState { session_id, status } => {
                write!(
                    f,
                    "session {session_id} cannot begin activation from {status:?}"
                )
            }
            Self::Persistence { message } => f.write_str(message),
        }
    }
}

impl std::error::Error for SessionSupervisorError {}

#[derive(Debug, Clone)]
pub enum BeginActivationOutcome {
    Started(LifecycleCheckpoint),
    Joined(LifecycleCheckpoint),
}

#[derive(Debug, Clone, Default)]
pub struct SessionSupervisor {
    sessions: Arc<DashMap<String, SessionSupervisorEntry>>,
    gates: Arc<DashMap<String, Arc<Mutex<()>>>>,
    #[cfg(test)]
    conditional_transition_hook: Arc<std::sync::Mutex<Option<SupervisorTestPause>>>,
    #[cfg(test)]
    checkpoint_persistence_hook: Arc<std::sync::Mutex<Option<SupervisorTestPause>>>,
    #[cfg(test)]
    fail_next_checkpoint_persistence: Arc<AtomicBool>,
}

impl SessionSupervisor {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    #[must_use]
    pub fn snapshot_for_session(&self, session_id: &str) -> Option<LifecycleCheckpoint> {
        self.sessions
            .get(session_id)
            .map(|entry| entry.checkpoint.clone())
    }

    #[must_use]
    pub fn seed_checkpoint(&self, session_id: String, checkpoint: LifecycleCheckpoint) -> bool {
        match self.sessions.entry(session_id) {
            dashmap::mapref::entry::Entry::Occupied(_) => false,
            dashmap::mapref::entry::Entry::Vacant(entry) => {
                entry.insert(SessionSupervisorEntry::new(checkpoint));
                true
            }
        }
    }

    pub(crate) fn replace_checkpoint(
        &self,
        session_id: String,
        checkpoint: LifecycleCheckpoint,
    ) -> bool {
        self.store_checkpoint(&session_id, checkpoint, true)
    }

    pub(crate) async fn restore_open_checkpoint(
        &self,
        session_id: String,
        frontier: i64,
        lifecycle: crate::acp::session_state_engine::selectors::SessionGraphLifecycle,
        capabilities: SessionGraphCapabilities,
    ) -> bool {
        let gate = self.gate_for_session(&session_id);
        let _guard = gate.lock().await;
        let Some(current) = self.snapshot_for_session(&session_id) else {
            return self.seed_checkpoint(
                session_id,
                LifecycleCheckpoint::from_live_runtime(frontier, lifecycle, capabilities),
            );
        };
        if current.lifecycle.status != LifecycleStatus::Detached
            || frontier < current.graph_revision
        {
            return false;
        }
        self.replace_checkpoint(
            session_id,
            LifecycleCheckpoint::from_live_runtime(
                current.graph_revision.max(frontier),
                lifecycle,
                capabilities,
            ),
        )
    }

    pub fn remove_session(&self, session_id: &str) {
        self.sessions.remove(session_id);
        self.gates.remove(session_id);
    }

    pub fn issue_ready_dispatch_permit(
        &self,
        session_id: &str,
    ) -> Result<ReadyDispatchPermit, ReadyDispatchError> {
        let entry =
            self.sessions
                .get(session_id)
                .ok_or_else(|| ReadyDispatchError::SessionNotFound {
                    session_id: session_id.to_string(),
                })?;

        if entry.checkpoint.lifecycle.status != LifecycleStatus::Ready {
            return Err(ReadyDispatchError::SessionNotReady {
                session_id: session_id.to_string(),
                status: entry.checkpoint.lifecycle.status,
            });
        }

        Ok(ReadyDispatchPermit::new(
            session_id.to_string(),
            entry.runtime_epoch,
        ))
    }

    pub fn validate_ready_dispatch_permit(
        &self,
        permit: &ReadyDispatchPermit,
    ) -> Result<(), ReadyDispatchError> {
        let entry = self.sessions.get(permit.session_id()).ok_or_else(|| {
            ReadyDispatchError::SessionNotFound {
                session_id: permit.session_id().to_string(),
            }
        })?;

        if entry.runtime_epoch != permit.runtime_epoch() {
            return Err(ReadyDispatchError::RuntimeEpochChanged {
                session_id: permit.session_id().to_string(),
                expected_epoch: permit.runtime_epoch(),
                actual_epoch: entry.runtime_epoch,
            });
        }

        if entry.checkpoint.lifecycle.status != LifecycleStatus::Ready {
            return Err(ReadyDispatchError::SessionNotReady {
                session_id: permit.session_id().to_string(),
                status: entry.checkpoint.lifecycle.status,
            });
        }

        Ok(())
    }

    pub async fn reserve(
        &self,
        db: &DbConn,
        projection_registry: &ProjectionRegistry,
        session_id: &str,
    ) -> Result<LifecycleCheckpoint, SessionSupervisorError> {
        self.reserve_with_capabilities(
            db,
            projection_registry,
            session_id,
            SessionGraphCapabilities::empty(),
        )
        .await
    }

    pub async fn reserve_with_capabilities(
        &self,
        db: &DbConn,
        projection_registry: &ProjectionRegistry,
        session_id: &str,
        capabilities: SessionGraphCapabilities,
    ) -> Result<LifecycleCheckpoint, SessionSupervisorError> {
        let gate = self.gate_for_session(session_id);
        let _guard = gate.lock().await;

        if self.sessions.contains_key(session_id) {
            return Err(SessionSupervisorError::AlreadyReserved {
                session_id: session_id.to_string(),
            });
        }

        let barrier = SessionJournalEventRepository::append_materialization_barrier(db, session_id)
            .await
            .map_err(|error| SessionSupervisorError::Persistence {
                message: format!(
                    "Failed to append reservation frontier for session {session_id}: {error}"
                ),
            })?;
        let checkpoint =
            LifecycleCheckpoint::new(barrier.event_seq, LifecycleState::reserved(), capabilities);
        self.persist_runtime_checkpoint(db, projection_registry, session_id, &checkpoint)
            .await?;
        let created = self.seed_checkpoint(session_id.to_string(), checkpoint.clone());
        debug_assert!(
            created,
            "reserve checked lifecycle existence before storing"
        );
        Ok(checkpoint)
    }

    /// Atomically starts activation or joins an activation that is already
    /// running. The whole decision is protected by the session gate so two
    /// concurrent resume commands cannot both append an activation barrier.
    pub async fn begin_activation(
        &self,
        db: &DbConn,
        projection_registry: &ProjectionRegistry,
        session_id: &str,
    ) -> Result<BeginActivationOutcome, SessionSupervisorError> {
        let gate = self.gate_for_session(session_id);
        let _guard = gate.lock().await;

        let current_checkpoint = match self.snapshot_for_session(session_id) {
            Some(checkpoint) => checkpoint,
            None => {
                let barrier =
                    SessionJournalEventRepository::append_materialization_barrier(db, session_id)
                        .await
                        .map_err(|error| SessionSupervisorError::Persistence {
                            message: format!(
                        "Failed to append reservation frontier for session {session_id}: {error}"
                    ),
                        })?;
                let checkpoint = LifecycleCheckpoint::new(
                    barrier.event_seq,
                    LifecycleState::reserved(),
                    SessionGraphCapabilities::empty(),
                );
                self.persist_runtime_checkpoint(db, projection_registry, session_id, &checkpoint)
                    .await?;
                let created = self.seed_checkpoint(session_id.to_string(), checkpoint.clone());
                debug_assert!(created, "begin_activation holds the session gate");
                checkpoint
            }
        };

        match current_checkpoint.lifecycle.status {
            LifecycleStatus::Activating
            | LifecycleStatus::Ready
            | LifecycleStatus::Reconnecting => {
                return Ok(BeginActivationOutcome::Joined(current_checkpoint));
            }
            LifecycleStatus::Archived => {
                return Err(SessionSupervisorError::InvalidActivationState {
                    session_id: session_id.to_string(),
                    status: LifecycleStatus::Archived,
                });
            }
            LifecycleStatus::Reserved | LifecycleStatus::Detached | LifecycleStatus::Failed => {}
        }

        let barrier = SessionJournalEventRepository::append_materialization_barrier(db, session_id)
            .await
            .map_err(|error| SessionSupervisorError::Persistence {
                message: format!(
                    "Failed to append activation frontier for session {session_id}: {error}"
                ),
            })?;
        let checkpoint = LifecycleCheckpoint::new(
            current_checkpoint.graph_revision.max(barrier.event_seq),
            LifecycleState::activating(),
            current_checkpoint.capabilities,
        );
        self.persist_runtime_checkpoint(db, projection_registry, session_id, &checkpoint)
            .await?;
        let stored = self.store_checkpoint(session_id, checkpoint.clone(), true);
        debug_assert!(stored, "begin_activation established lifecycle ownership");
        Ok(BeginActivationOutcome::Started(checkpoint))
    }

    pub async fn record_session_update(
        &self,
        db: &DbConn,
        projection_registry: &ProjectionRegistry,
        session_id: &str,
        event_seq: i64,
        update: &SessionUpdate,
    ) -> Result<LifecycleCheckpoint, SessionSupervisorError> {
        let gate = self.gate_for_session(session_id);
        let _guard = gate.lock().await;
        let previous_checkpoint = self.snapshot_for_session(session_id).ok_or_else(|| {
            SessionSupervisorError::SessionNotFound {
                session_id: session_id.to_string(),
            }
        })?;
        let mut runtime_snapshot =
            SessionGraphRuntimeSnapshot::from_checkpoint(&previous_checkpoint);
        runtime_snapshot.apply_update_with_graph_seed(event_seq.saturating_sub(1), update);
        let checkpoint = runtime_snapshot.into_checkpoint();
        let advances_runtime_epoch = previous_checkpoint.lifecycle != checkpoint.lifecycle;
        self.persist_runtime_checkpoint(db, projection_registry, session_id, &checkpoint)
            .await?;
        let stored = self.store_checkpoint(session_id, checkpoint.clone(), advances_runtime_epoch);
        debug_assert!(
            stored,
            "record_session_update checked lifecycle existence before storing"
        );
        Ok(checkpoint)
    }

    /// Mirrors canonical graph-owned lifecycle/capability facts into the
    /// compatibility checkpoint without reducing the provider update again.
    /// Older journal events may advance no fields after a newer checkpoint
    /// has already won the per-session gate.
    pub async fn record_canonical_graph_transition(
        &self,
        db: &DbConn,
        projection_registry: &ProjectionRegistry,
        session_id: &str,
        event_seq: i64,
        after: SessionGraphRuntimeSnapshot,
        replaces_lifecycle: bool,
        replaces_capabilities: bool,
    ) -> Result<LifecycleCheckpoint, SessionSupervisorError> {
        let gate = self.gate_for_session(session_id);
        let _guard = gate.lock().await;
        let previous = self.snapshot_for_session(session_id).ok_or_else(|| {
            SessionSupervisorError::SessionNotFound {
                session_id: session_id.to_string(),
            }
        })?;
        let event_is_current = event_seq >= previous.graph_revision;
        let lifecycle = if event_is_current && replaces_lifecycle {
            after.lifecycle.lifecycle_state()
        } else {
            previous.lifecycle.clone()
        };
        let capabilities = if event_is_current && replaces_capabilities {
            after.capabilities
        } else {
            previous.capabilities.clone()
        };
        let checkpoint = LifecycleCheckpoint::new(
            previous.graph_revision.max(event_seq),
            lifecycle,
            capabilities,
        );
        let advances_runtime_epoch = previous.lifecycle != checkpoint.lifecycle;
        self.persist_runtime_checkpoint(db, projection_registry, session_id, &checkpoint)
            .await?;
        let stored = self.store_checkpoint(session_id, checkpoint.clone(), advances_runtime_epoch);
        debug_assert!(stored, "canonical mirror checked lifecycle existence");
        Ok(checkpoint)
    }

    pub async fn transition_lifecycle(
        &self,
        db: &DbConn,
        projection_registry: &ProjectionRegistry,
        session_id: &str,
        update: &SessionUpdate,
    ) -> Result<LifecycleCheckpoint, SessionSupervisorError> {
        let gate = self.gate_for_session(session_id);
        let _guard = gate.lock().await;
        let current_checkpoint = self.snapshot_for_session(session_id).ok_or_else(|| {
            SessionSupervisorError::SessionNotFound {
                session_id: session_id.to_string(),
            }
        })?;
        let barrier = SessionJournalEventRepository::append_materialization_barrier(db, session_id)
            .await
            .map_err(|error| SessionSupervisorError::Persistence {
                message: format!(
                    "Failed to append lifecycle frontier for session {session_id}: {error}"
                ),
            })?;
        let mut runtime_snapshot =
            SessionGraphRuntimeSnapshot::from_checkpoint(&current_checkpoint);
        runtime_snapshot.graph_revision = runtime_snapshot.graph_revision.max(barrier.event_seq);
        runtime_snapshot.apply_update(update);
        let checkpoint = runtime_snapshot.into_checkpoint();
        self.persist_runtime_checkpoint(db, projection_registry, session_id, &checkpoint)
            .await?;
        let stored = self.store_checkpoint(session_id, checkpoint.clone(), true);
        debug_assert!(
            stored,
            "transition_lifecycle checked lifecycle existence before storing"
        );
        Ok(checkpoint)
    }

    pub async fn transition_lifecycle_if_current(
        &self,
        db: &DbConn,
        projection_registry: &ProjectionRegistry,
        session_id: &str,
        expected: &LifecycleCheckpoint,
        update: &SessionUpdate,
    ) -> Result<Option<LifecycleCheckpoint>, SessionSupervisorError> {
        let gate = self.gate_for_session(session_id);
        let _guard = gate.lock().await;
        let current_entry = self
            .sessions
            .get(session_id)
            .map(|entry| entry.clone())
            .ok_or_else(|| SessionSupervisorError::SessionNotFound {
                session_id: session_id.to_string(),
            })?;
        let current_checkpoint = current_entry.checkpoint.clone();
        let expected_version = current_entry.checkpoint_version;
        if current_checkpoint.graph_revision != expected.graph_revision
            || current_checkpoint.lifecycle != expected.lifecycle
        {
            return Ok(None);
        }
        let barrier = SessionJournalEventRepository::append_materialization_barrier(db, session_id)
            .await
            .map_err(|error| SessionSupervisorError::Persistence {
                message: format!(
                    "Failed to append lifecycle frontier for session {session_id}: {error}"
                ),
            })?;
        let mut runtime_snapshot =
            SessionGraphRuntimeSnapshot::from_checkpoint(&current_checkpoint);
        runtime_snapshot.graph_revision = runtime_snapshot.graph_revision.max(barrier.event_seq);
        runtime_snapshot.apply_update(update);
        let checkpoint = runtime_snapshot.into_checkpoint();

        #[cfg(test)]
        let test_hook = {
            self.conditional_transition_hook
                .lock()
                .expect("conditional transition test hook mutex poisoned")
                .clone()
        };
        #[cfg(test)]
        if let Some(hook) = test_hook {
            hook.reached.notify_one();
            hook.resume.notified().await;
        }

        let Some(installed_version) = self.compare_and_replace_checkpoint(
            session_id,
            expected_version,
            checkpoint.clone(),
            true,
        ) else {
            return Ok(None);
        };
        if let Err(error) = self
            .persist_runtime_checkpoint(db, projection_registry, session_id, &checkpoint)
            .await
        {
            self.compare_and_restore_entry(session_id, installed_version, current_entry);
            return Err(error);
        }
        Ok(Some(checkpoint))
    }

    pub async fn transition_lifecycle_state(
        &self,
        db: &DbConn,
        projection_registry: &ProjectionRegistry,
        session_id: &str,
        lifecycle: LifecycleState,
    ) -> Result<LifecycleCheckpoint, SessionSupervisorError> {
        let gate = self.gate_for_session(session_id);
        let _guard = gate.lock().await;
        let current_checkpoint = self.snapshot_for_session(session_id).ok_or_else(|| {
            SessionSupervisorError::SessionNotFound {
                session_id: session_id.to_string(),
            }
        })?;
        let barrier = SessionJournalEventRepository::append_materialization_barrier(db, session_id)
            .await
            .map_err(|error| SessionSupervisorError::Persistence {
                message: format!(
                    "Failed to append lifecycle frontier for session {session_id}: {error}"
                ),
            })?;
        let checkpoint = LifecycleCheckpoint::new(
            current_checkpoint.graph_revision.max(barrier.event_seq),
            lifecycle,
            current_checkpoint.capabilities,
        );
        self.persist_runtime_checkpoint(db, projection_registry, session_id, &checkpoint)
            .await?;
        let stored = self.store_checkpoint(session_id, checkpoint.clone(), true);
        debug_assert!(
            stored,
            "transition_lifecycle_state checked lifecycle existence before storing"
        );
        Ok(checkpoint)
    }

    fn gate_for_session(&self, session_id: &str) -> Arc<Mutex<()>> {
        self.gates
            .entry(session_id.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }

    fn store_checkpoint(
        &self,
        session_id: &str,
        checkpoint: LifecycleCheckpoint,
        advance_runtime_epoch: bool,
    ) -> bool {
        let dashmap::mapref::entry::Entry::Occupied(mut entry) =
            self.sessions.entry(session_id.to_string())
        else {
            return false;
        };
        let next_entry = if advance_runtime_epoch {
            entry.get().advance(checkpoint)
        } else {
            entry.get().replace_checkpoint(checkpoint)
        };
        entry.insert(next_entry);
        true
    }

    fn compare_and_replace_checkpoint(
        &self,
        session_id: &str,
        expected_version: u64,
        checkpoint: LifecycleCheckpoint,
        advance_runtime_epoch: bool,
    ) -> Option<u64> {
        let dashmap::mapref::entry::Entry::Occupied(mut entry) =
            self.sessions.entry(session_id.to_string())
        else {
            return None;
        };
        if entry.get().checkpoint_version != expected_version {
            return None;
        }
        let next_entry = if advance_runtime_epoch {
            entry.get().advance(checkpoint)
        } else {
            entry.get().replace_checkpoint(checkpoint)
        };
        let installed_version = next_entry.checkpoint_version;
        entry.insert(next_entry);
        Some(installed_version)
    }

    fn compare_and_restore_entry(
        &self,
        session_id: &str,
        expected_version: u64,
        mut previous_entry: SessionSupervisorEntry,
    ) -> bool {
        let dashmap::mapref::entry::Entry::Occupied(mut entry) =
            self.sessions.entry(session_id.to_string())
        else {
            return false;
        };
        if entry.get().checkpoint_version != expected_version {
            return false;
        }
        previous_entry.checkpoint_version = expected_version.saturating_add(1);
        entry.insert(previous_entry);
        true
    }

    #[cfg(test)]
    pub(crate) fn install_conditional_transition_test_hook(&self, hook: SupervisorTestPause) {
        *self
            .conditional_transition_hook
            .lock()
            .expect("conditional transition test hook mutex poisoned") = Some(hook);
    }

    #[cfg(test)]
    pub(crate) fn fail_next_checkpoint_persistence(&self) {
        self.fail_next_checkpoint_persistence
            .store(true, Ordering::SeqCst);
    }

    #[cfg(test)]
    pub(crate) fn install_checkpoint_persistence_test_hook(&self, hook: SupervisorTestPause) {
        *self
            .checkpoint_persistence_hook
            .lock()
            .expect("checkpoint persistence test hook mutex poisoned") = Some(hook);
    }

    #[cfg(test)]
    pub(crate) fn checkpoint_version_for_session(&self, session_id: &str) -> Option<u64> {
        self.sessions
            .get(session_id)
            .map(|entry| entry.checkpoint_version)
    }

    async fn persist_runtime_checkpoint(
        &self,
        _db: &DbConn,
        _projection_registry: &ProjectionRegistry,
        session_id: &str,
        _checkpoint: &LifecycleCheckpoint,
    ) -> Result<(), SessionSupervisorError> {
        let _ = session_id;
        #[cfg(test)]
        let test_hook = {
            self.checkpoint_persistence_hook
                .lock()
                .expect("checkpoint persistence test hook mutex poisoned")
                .clone()
        };
        #[cfg(test)]
        if let Some(hook) = test_hook {
            hook.reached.notify_one();
            hook.resume.notified().await;
        }
        #[cfg(test)]
        if self
            .fail_next_checkpoint_persistence
            .swap(false, Ordering::SeqCst)
        {
            return Err(SessionSupervisorError::Persistence {
                message: "forced checkpoint persistence failure".to_string(),
            });
        }
        Ok(())
    }
}
