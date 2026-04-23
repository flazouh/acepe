use crate::acp::lifecycle::{
    LifecycleCheckpoint, LifecycleState, LifecycleStatus, ReadyDispatchError, ReadyDispatchPermit,
};
use crate::acp::projections::ProjectionRegistry;
use crate::acp::session_state_engine::runtime_registry::SessionGraphRuntimeSnapshot;
use crate::acp::session_state_engine::SessionGraphCapabilities;
use crate::acp::session_update::SessionUpdate;
use crate::db::repository::{SessionJournalEventRepository, SessionProjectionSnapshotRepository};
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
    Persistence { message: String },
}

impl fmt::Display for SessionSupervisorError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::AlreadyReserved { session_id } => {
                write!(f, "session {session_id} is already reserved")
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
        if self.sessions.contains_key(&session_id) {
            return false;
        }

        self.sessions
            .insert(session_id, SessionSupervisorEntry::new(checkpoint));
        true
    }

    pub(crate) fn replace_checkpoint_for_compat(
        &self,
        session_id: String,
        checkpoint: LifecycleCheckpoint,
    ) {
        self.store_checkpoint(&session_id, checkpoint, true);
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
        let checkpoint = LifecycleCheckpoint::new(
            barrier.event_seq,
            LifecycleState::reserved(),
            SessionGraphCapabilities::empty(),
        );
        self.persist_runtime_checkpoint(db, projection_registry, session_id, &checkpoint)
            .await?;
        self.store_checkpoint(session_id, checkpoint.clone(), true);
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
        let previous_checkpoint = self.snapshot_for_session(session_id);
        let mut runtime_snapshot = previous_checkpoint
            .as_ref()
            .map(SessionGraphRuntimeSnapshot::from_checkpoint)
            .unwrap_or_default();
        runtime_snapshot.apply_update_with_graph_seed(event_seq.saturating_sub(1), update);
        let checkpoint = runtime_snapshot.into_checkpoint();
        let advances_runtime_epoch = previous_checkpoint
            .as_ref()
            .is_none_or(|previous| previous.lifecycle != checkpoint.lifecycle);
        self.persist_runtime_checkpoint(db, projection_registry, session_id, &checkpoint)
            .await?;
        self.store_checkpoint(session_id, checkpoint.clone(), advances_runtime_epoch);
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
        let mut runtime_snapshot = self
            .snapshot_for_session(session_id)
            .map(|checkpoint| SessionGraphRuntimeSnapshot::from_checkpoint(&checkpoint))
            .unwrap_or_default();
        runtime_snapshot.graph_revision = runtime_snapshot.graph_revision.max(barrier.event_seq);
        runtime_snapshot.apply_update(update);
        let checkpoint = runtime_snapshot.into_checkpoint();
        self.persist_runtime_checkpoint(db, projection_registry, session_id, &checkpoint)
            .await?;
        self.store_checkpoint(session_id, checkpoint.clone(), true);
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
            .map(|checkpoint| checkpoint.capabilities)
            .unwrap_or_else(SessionGraphCapabilities::empty);
        let checkpoint = LifecycleCheckpoint::new(barrier.event_seq, lifecycle, capabilities);
        self.persist_runtime_checkpoint(db, projection_registry, session_id, &checkpoint)
            .await?;
        self.store_checkpoint(session_id, checkpoint.clone(), true);
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
    ) {
        let next_entry = self
            .sessions
            .get(session_id)
            .map(|entry| {
                if advance_runtime_epoch {
                    entry.advance(checkpoint.clone())
                } else {
                    entry.replace_checkpoint(checkpoint.clone())
                }
            })
            .unwrap_or_else(|| SessionSupervisorEntry::new(checkpoint));
        self.sessions.insert(session_id.to_string(), next_entry);
    }

    async fn persist_runtime_checkpoint(
        &self,
        db: &DbConn,
        _projection_registry: &ProjectionRegistry,
        session_id: &str,
        checkpoint: &LifecycleCheckpoint,
    ) -> Result<(), SessionSupervisorError> {
        let projection_snapshot = crate::acp::projections::SessionProjectionSnapshot {
            session: None,
            operations: Vec::new(),
            interactions: Vec::new(),
            runtime: Some(checkpoint.clone()),
        };
        SessionProjectionSnapshotRepository::set(db, session_id, &projection_snapshot)
            .await
            .map_err(|error| SessionSupervisorError::Persistence {
                message: format!(
                    "Failed to persist runtime checkpoint for session {session_id}: {error}"
                ),
            })
    }
}
