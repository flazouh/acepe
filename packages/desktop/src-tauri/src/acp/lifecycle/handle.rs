use super::LifecycleStatus;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReadyDispatchPermit {
    session_id: String,
    runtime_epoch: u64,
}

impl ReadyDispatchPermit {
    pub(crate) fn new(session_id: String, runtime_epoch: u64) -> Self {
        Self {
            session_id,
            runtime_epoch,
        }
    }

    #[must_use]
    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    #[must_use]
    pub fn runtime_epoch(&self) -> u64 {
        self.runtime_epoch
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReadyDispatchError {
    SessionNotFound {
        session_id: String,
    },
    SessionNotReady {
        session_id: String,
        status: LifecycleStatus,
    },
    RuntimeEpochChanged {
        session_id: String,
        expected_epoch: u64,
        actual_epoch: u64,
    },
}

impl std::fmt::Display for ReadyDispatchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::SessionNotFound { session_id } => {
                write!(f, "session {session_id} is not available for ready-only dispatch")
            }
            Self::SessionNotReady { session_id, status } => write!(
                f,
                "session {session_id} is not ready for ready-only dispatch while lifecycle is {:?}",
                status
            ),
            Self::RuntimeEpochChanged {
                session_id,
                expected_epoch,
                actual_epoch,
            } => write!(
                f,
                "session {session_id} changed runtime epoch before dispatch (expected {expected_epoch}, actual {actual_epoch})"
            ),
        }
    }
}

impl std::error::Error for ReadyDispatchError {}
