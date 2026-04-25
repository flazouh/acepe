use crate::acp::lifecycle::state::LifecycleState;
use crate::acp::session_state_engine::selectors::{
    SessionGraphCapabilities, SessionGraphLifecycle,
};
use serde::{Deserialize, Serialize};
use specta::Type;

pub const LIFECYCLE_CHECKPOINT_SCHEMA_VERSION: u8 = 2;

fn default_lifecycle_checkpoint_schema_version() -> u8 {
    LIFECYCLE_CHECKPOINT_SCHEMA_VERSION
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleCheckpoint {
    /// Older persisted checkpoints may omit this field; treat as current version for migration.
    #[serde(default = "default_lifecycle_checkpoint_schema_version")]
    pub schema_version: u8,
    pub graph_revision: i64,
    pub lifecycle: LifecycleState,
    pub capabilities: SessionGraphCapabilities,
}

impl LifecycleCheckpoint {
    #[must_use]
    pub fn new(
        graph_revision: i64,
        lifecycle: LifecycleState,
        capabilities: SessionGraphCapabilities,
    ) -> Self {
        Self {
            schema_version: LIFECYCLE_CHECKPOINT_SCHEMA_VERSION,
            graph_revision,
            lifecycle,
            capabilities,
        }
    }

    #[must_use]
    pub fn from_live_runtime(
        graph_revision: i64,
        lifecycle: SessionGraphLifecycle,
        capabilities: SessionGraphCapabilities,
    ) -> Self {
        Self::new(graph_revision, lifecycle.lifecycle_state(), capabilities)
    }

    #[must_use]
    pub fn graph_lifecycle(&self) -> SessionGraphLifecycle {
        SessionGraphLifecycle::from_lifecycle_state(self.lifecycle.clone())
    }
}
