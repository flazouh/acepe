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
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Debug, Clone)]
struct SessionSupervisorEntry {
    checkpoint: LifecycleCheckpoint,
    runtime_epoch: u64,
}

impl SessionSupervisorEntry {
    fn new(checkpoint: LifecycleCheckpoint) -> Self {
        Self {
            checkpoint,
            runtime_epoch: 1,
        }
    }

    fn advance(&self, checkpoint: LifecycleCheckpoint) -> Self {
        Self {
            checkpoint,
            runtime_epoch: self.runtime_epoch.saturating_add(1),
        }
    }

    fn replace_checkpoint(&self, checkpoint: LifecycleCheckpoint) -> Self {
        Self {
            checkpoint,
            runtime_epoch: self.runtime_epoch,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionSupervisorError {
    AlreadyReserved { session_id: String },
    SessionNotFound { session_id: String },
    Persistence { message: String },
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
            Self::Persistence { message } => f.write_str(message),
        }
    }
}

impl std::error::Error for SessionSupervisorError {}

#[derive(Debug, Clone, Default)]
pub struct SessionSupervisor {
    sessions: Arc<DashMap<String, SessionSupervisorEntry>>,
    gates: Arc<DashMap<String, Arc<Mutex<()>>>>,
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

    pub async fn transition_lifecycle(
        &self,
        db: &DbConn,
        projection_registry: &ProjectionRegistry,
        session_id: &str,
        update: &SessionUpdate,
    ) -> Result<LifecycleCheckpoint, SessionSupervisorError> {
        let gate = self.gate_for_session(session_id);
        let _guard = gate.lock().await;
        let barrier = SessionJournalEventRepository::append_materialization_barrier(db, session_id)
            .await
            .map_err(|error| SessionSupervisorError::Persistence {
                message: format!(
                    "Failed to append lifecycle frontier for session {session_id}: {error}"
                ),
            })?;
        let current_checkpoint = self.snapshot_for_session(session_id).ok_or_else(|| {
            SessionSupervisorError::SessionNotFound {
                session_id: session_id.to_string(),
            }
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

    pub async fn transition_lifecycle_state(
        &self,
        db: &DbConn,
        projection_registry: &ProjectionRegistry,
        session_id: &str,
        lifecycle: LifecycleState,
    ) -> Result<LifecycleCheckpoint, SessionSupervisorError> {
        let gate = self.gate_for_session(session_id);
        let _guard = gate.lock().await;
        let barrier = SessionJournalEventRepository::append_materialization_barrier(db, session_id)
            .await
            .map_err(|error| SessionSupervisorError::Persistence {
                message: format!(
                    "Failed to append lifecycle frontier for session {session_id}: {error}"
                ),
            })?;
        let capabilities = self
            .snapshot_for_session(session_id)
            .ok_or_else(|| SessionSupervisorError::SessionNotFound {
                session_id: session_id.to_string(),
            })?
            .capabilities;
        let checkpoint = LifecycleCheckpoint::new(barrier.event_seq, lifecycle, capabilities);
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
        let next_entry = {
            let Some(entry) = self.sessions.get(session_id) else {
                return false;
            };
            if advance_runtime_epoch {
                entry.advance(checkpoint)
            } else {
                entry.replace_checkpoint(checkpoint)
            }
        };
        self.sessions.insert(session_id.to_string(), next_entry);
        true
    }

    async fn persist_runtime_checkpoint(
        &self,
        _db: &DbConn,
        _projection_registry: &ProjectionRegistry,
        session_id: &str,
        _checkpoint: &LifecycleCheckpoint,
    ) -> Result<(), SessionSupervisorError> {
        let _ = session_id;
        Ok(())
    }
}
