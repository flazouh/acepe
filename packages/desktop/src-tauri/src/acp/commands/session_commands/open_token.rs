//! Open-token reservation helper for session commands.
//! Extracted verbatim from session_commands.rs.

use super::super::*;
use super::*;
use crate::acp::event_hub::{AcpEventHubState, OpenTokenClaim};
use std::sync::Arc;

pub(super) fn claim_open_token_reservation<R: tauri::Runtime>(
    app: &AppHandle<R>,
    session_id: &str,
    open_token: Option<&str>,
) -> Result<Option<OpenTokenClaim>, SerializableAcpError> {
    let Some(raw_open_token) = open_token else {
        return Ok(None);
    };

    let token = uuid::Uuid::parse_str(raw_open_token).map_err(|error| {
        SerializableAcpError::InvalidState {
            message: format!("Failed to parse open token for session {session_id}: {error}"),
        }
    })?;
    let hub = app.state::<Arc<AcpEventHubState>>();
    hub.gc_expired_reservations();
    let Some(claim) = hub.claim_reservation_for_session(token, session_id) else {
        return Err(SerializableAcpError::InvalidState {
            message: format!("Session open token is no longer valid for session {session_id}"),
        });
    };

    Ok(Some(claim))
}
