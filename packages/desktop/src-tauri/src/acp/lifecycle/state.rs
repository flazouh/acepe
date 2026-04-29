use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum LifecycleStatus {
    Reserved,
    Activating,
    Ready,
    Reconnecting,
    Detached,
    Failed,
    Archived,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum DetachedReason {
    RestoredRequiresAttach,
    ReconnectExhausted,
    AbandonedInFlight,
    LegacyAmbiguousRestore,
    ClosedByClient,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum FailureReason {
    DeterministicRestoreFault,
    ActivationFailed,
    ResumeFailed,
    ProviderSessionMismatch,
    CorruptedPersistedState,
    ExplicitErrorHandlingRequired,
    LegacyIrrecoverable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LifecycleState {
    pub status: LifecycleStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detached_reason: Option<DetachedReason>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_reason: Option<FailureReason>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
}

impl LifecycleState {
    #[must_use]
    pub fn reserved() -> Self {
        Self {
            status: LifecycleStatus::Reserved,
            detached_reason: None,
            failure_reason: None,
            error_message: None,
        }
    }

    #[must_use]
    pub fn activating() -> Self {
        Self {
            status: LifecycleStatus::Activating,
            detached_reason: None,
            failure_reason: None,
            error_message: None,
        }
    }

    #[must_use]
    pub fn ready() -> Self {
        Self {
            status: LifecycleStatus::Ready,
            detached_reason: None,
            failure_reason: None,
            error_message: None,
        }
    }

    #[must_use]
    pub fn reconnecting() -> Self {
        Self {
            status: LifecycleStatus::Reconnecting,
            detached_reason: None,
            failure_reason: None,
            error_message: None,
        }
    }

    #[must_use]
    pub fn detached(reason: DetachedReason) -> Self {
        Self {
            status: LifecycleStatus::Detached,
            detached_reason: Some(reason),
            failure_reason: None,
            error_message: None,
        }
    }

    #[must_use]
    pub fn detached_with_message(reason: DetachedReason, error_message: Option<String>) -> Self {
        Self {
            status: LifecycleStatus::Detached,
            detached_reason: Some(reason),
            failure_reason: None,
            error_message,
        }
    }

    #[must_use]
    pub fn failed(reason: FailureReason, error_message: Option<String>) -> Self {
        Self {
            status: LifecycleStatus::Failed,
            detached_reason: None,
            failure_reason: Some(reason),
            error_message,
        }
    }

    #[must_use]
    pub fn archived() -> Self {
        Self {
            status: LifecycleStatus::Archived,
            detached_reason: None,
            failure_reason: None,
            error_message: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Reserved;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Activating;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Ready;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Reconnecting;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Detached;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Failed;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Archived;
