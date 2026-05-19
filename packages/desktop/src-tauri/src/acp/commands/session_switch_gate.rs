use crate::acp::error::SerializableAcpError;
use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};

static SWITCHING_SESSIONS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

fn switching_sessions() -> &'static Mutex<HashSet<String>> {
    SWITCHING_SESSIONS.get_or_init(|| Mutex::new(HashSet::new()))
}

pub(super) struct SessionSwitchGate {
    session_id: String,
}

impl Drop for SessionSwitchGate {
    fn drop(&mut self) {
        if let Ok(mut sessions) = switching_sessions().lock() {
            sessions.remove(&self.session_id);
        }
    }
}

pub(super) fn acquire_session_switch_gate(
    session_id: &str,
) -> Result<SessionSwitchGate, SerializableAcpError> {
    let mut sessions =
        switching_sessions()
            .lock()
            .map_err(|_| SerializableAcpError::InvalidState {
                message: "Worktree switch gate is unavailable".to_string(),
            })?;

    if !sessions.insert(session_id.to_string()) {
        return Err(SerializableAcpError::InvalidState {
            message: "This session is already switching worktrees".to_string(),
        });
    }

    Ok(SessionSwitchGate {
        session_id: session_id.to_string(),
    })
}

pub(super) fn reject_if_session_switching(session_id: &str) -> Result<(), SerializableAcpError> {
    let sessions = switching_sessions()
        .lock()
        .map_err(|_| SerializableAcpError::InvalidState {
            message: "Worktree switch gate is unavailable".to_string(),
        })?;

    if sessions.contains(session_id) {
        return Err(SerializableAcpError::InvalidState {
            message: "This session is switching worktrees. Try again after the switch finishes."
                .to_string(),
        });
    }

    Ok(())
}
