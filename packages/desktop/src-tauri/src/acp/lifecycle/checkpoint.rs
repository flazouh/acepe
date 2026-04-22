use crate::acp::lifecycle::state::{
    DetachedReason, FailureReason, LifecycleState, LifecycleStatus,
};
use crate::acp::session_state_engine::selectors::{
    SessionGraphCapabilities, SessionGraphLifecycle, SessionGraphLifecycleStatus,
};
use serde::{Deserialize, Serialize};
use specta::Type;

pub const LIFECYCLE_CHECKPOINT_SCHEMA_VERSION: u8 = 2;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleCheckpoint {
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
        let persisted_lifecycle = match lifecycle.status {
            SessionGraphLifecycleStatus::Idle => LifecycleState::reserved(),
            SessionGraphLifecycleStatus::Connecting => LifecycleState::activating(),
            SessionGraphLifecycleStatus::Ready => LifecycleState::ready(),
            SessionGraphLifecycleStatus::Error => {
                if lifecycle.can_reconnect {
                    LifecycleState::detached_with_message(
                        DetachedReason::LegacyAmbiguousRestore,
                        lifecycle.error_message,
                    )
                } else {
                    LifecycleState::failed(
                        FailureReason::ExplicitErrorHandlingRequired,
                        lifecycle.error_message,
                    )
                }
            }
        };

        Self::new(graph_revision, persisted_lifecycle, capabilities)
    }

    #[must_use]
    pub fn compat_graph_lifecycle(&self) -> SessionGraphLifecycle {
        match self.lifecycle.status {
            LifecycleStatus::Reserved => SessionGraphLifecycle {
                status: SessionGraphLifecycleStatus::Idle,
                error_message: None,
                can_reconnect: true,
            },
            LifecycleStatus::Activating | LifecycleStatus::Reconnecting => SessionGraphLifecycle {
                status: SessionGraphLifecycleStatus::Connecting,
                error_message: None,
                can_reconnect: true,
            },
            LifecycleStatus::Ready => SessionGraphLifecycle {
                status: SessionGraphLifecycleStatus::Ready,
                error_message: None,
                can_reconnect: true,
            },
            LifecycleStatus::Detached => SessionGraphLifecycle {
                status: SessionGraphLifecycleStatus::Error,
                error_message: self.lifecycle.error_message.clone(),
                can_reconnect: true,
            },
            LifecycleStatus::Failed | LifecycleStatus::Archived => SessionGraphLifecycle {
                status: SessionGraphLifecycleStatus::Error,
                error_message: self.lifecycle.error_message.clone(),
                can_reconnect: false,
            },
        }
    }
}
