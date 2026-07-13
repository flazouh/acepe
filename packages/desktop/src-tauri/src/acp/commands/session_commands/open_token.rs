//! Open-token reservation helper for session commands.
//! Extracted verbatim from session_commands.rs.

use super::super::*;
use super::*;
use crate::acp::event_hub::{AcpEventHubState, OpenTokenClaim, PreparedOpenTokenClaim};
use std::sync::Arc;

pub(crate) struct PreparedOpenTokenReservation {
    hub: Arc<AcpEventHubState>,
    prepared: Option<PreparedOpenTokenClaim>,
}

impl PreparedOpenTokenReservation {
    pub(crate) fn commit(mut self) -> Result<OpenTokenClaim, SerializableAcpError> {
        let prepared = self
            .prepared
            .take()
            .expect("prepared open-token claim must exist until commit");
        self.hub
            .commit_prepared_reservation_claim(prepared)
            .ok_or_else(|| SerializableAcpError::InvalidState {
                message: "Session open token expired or was superseded before commit".to_string(),
            })
    }
}

impl Drop for PreparedOpenTokenReservation {
    fn drop(&mut self) {
        if let Some(prepared) = self.prepared.take() {
            let _ = self.hub.release_prepared_reservation_claim(prepared);
        }
    }
}

pub(super) fn prepare_open_token_reservation<R: tauri::Runtime>(
    app: &AppHandle<R>,
    session_id: &str,
    open_token: Option<&str>,
) -> Result<Option<PreparedOpenTokenReservation>, SerializableAcpError> {
    let Some(raw_open_token) = open_token else {
        return Ok(None);
    };

    let token = uuid::Uuid::parse_str(raw_open_token).map_err(|error| {
        SerializableAcpError::InvalidState {
            message: format!("Failed to parse open token for session {session_id}: {error}"),
        }
    })?;
    let hub = app.state::<Arc<AcpEventHubState>>().inner().clone();
    hub.gc_expired_reservations();
    let Some(prepared) = hub.prepare_reservation_claim_for_session(token, session_id) else {
        return Err(SerializableAcpError::InvalidState {
            message: format!("Session open token is no longer valid for session {session_id}"),
        });
    };

    Ok(Some(PreparedOpenTokenReservation {
        hub,
        prepared: Some(prepared),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn prepared_reservation(
        session_id: &str,
    ) -> (
        Arc<AcpEventHubState>,
        uuid::Uuid,
        PreparedOpenTokenReservation,
    ) {
        let hub = Arc::new(AcpEventHubState::new());
        let token = uuid::Uuid::new_v4();
        hub.arm_reservation(token, session_id.to_string(), 0, 0)
            .expect("reservation should arm");
        let prepared = hub
            .prepare_reservation_claim_for_session(token, session_id)
            .expect("reservation should prepare");
        let reservation = PreparedOpenTokenReservation {
            hub: Arc::clone(&hub),
            prepared: Some(prepared),
        };
        (hub, token, reservation)
    }

    #[tokio::test]
    async fn timeout_drops_prepared_reservation_and_allows_retry() {
        let session_id = "timeout-open-token";
        let (hub, token, reservation) = prepared_reservation(session_id);

        let result = tokio::time::timeout(std::time::Duration::from_millis(1), async move {
            let _reservation = reservation;
            std::future::pending::<()>().await;
        })
        .await;

        assert!(result.is_err(), "test worker should time out");
        assert!(
            hub.prepare_reservation_claim_for_session(token, session_id)
                .is_some(),
            "timeout must release the prepared token for retry"
        );
    }

    #[tokio::test]
    async fn panic_drops_prepared_reservation_and_allows_retry() {
        let session_id = "panic-open-token";
        let (hub, token, reservation) = prepared_reservation(session_id);

        let worker = tokio::spawn(async move {
            let _reservation = reservation;
            panic!("simulated attach panic");
        });

        assert!(worker.await.is_err(), "test worker should panic");
        assert!(
            hub.prepare_reservation_claim_for_session(token, session_id)
                .is_some(),
            "panic must release the prepared token for retry"
        );
    }
}
