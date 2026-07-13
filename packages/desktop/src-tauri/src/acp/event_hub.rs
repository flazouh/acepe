use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tokio::sync::{broadcast, RwLock};
use uuid::Uuid;

const DEFAULT_EVENT_CHANNEL_CAPACITY: usize = 8192;
/// Default time-to-live for an unused open-token reservation.
pub const RESERVATION_TTL: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AcpEventEnvelope {
    pub seq: u64,
    pub event_name: String,
    pub session_id: Option<String>,
    pub payload: Value,
    pub priority: String,
    pub droppable: bool,
    pub emitted_at_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AcpEventBridgeInfo {
    pub events_url: String,
}

/// Per-token pre-attach reservation.
///
/// Created by `arm_reservation` when a session-open result is assembled.
/// Buffers all hub events for `canonical_session_id` published after the
/// reservation is armed, so they can be flushed to the client at connect
/// time (Unit 3).
///
/// Tokens are single-use: the first successful committed claim removes the
/// entry and returns the buffered events. Preparing a claim leaves the entry
/// installed so events continue buffering during fallible attach setup.
/// Reservations expire after [`RESERVATION_TTL`] of inactivity to prevent
/// abandoned opens from leaking buffered deltas indefinitely.
pub struct OpenTokenReservation {
    /// Canonical (Acepe-local) session ID this reservation belongs to.
    pub canonical_session_id: String,
    /// Proven journal cutoff at the time the reservation was armed.
    pub last_event_seq: i64,
    /// Wall-clock epoch of the open attempt in milliseconds.
    pub epoch_ms: u64,
    /// Deltas buffered since arming.
    pub delta_buffer: VecDeque<AcpEventEnvelope>,
    /// Monotonic instant of reservation creation (for TTL).
    pub created_at: Instant,
    /// Monotonic instant of the last buffer write (for TTL activity tracking).
    pub last_activity: Instant,
    /// Exclusive claimant that may commit or release this reservation.
    prepared_claim_id: Option<Uuid>,
}

pub struct OpenTokenClaim {
    pub last_event_seq: i64,
    pub buffered_events: Vec<AcpEventEnvelope>,
}

/// Opaque permit for the only claimant currently preparing a reservation.
///
/// Commit consumes the permit and retires the reservation. Release consumes
/// it and makes the same token available for another attach attempt.
pub struct PreparedOpenTokenClaim {
    token: Uuid,
    canonical_session_id: String,
    claim_id: Uuid,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OpenTokenReservationArmError {
    PreparedClaimInProgress { canonical_session_id: String },
    ReservationStoreUnavailable { canonical_session_id: String },
}

impl std::fmt::Display for OpenTokenReservationArmError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::PreparedClaimInProgress {
                canonical_session_id,
            } => write!(
                formatter,
                "another attach already owns a prepared open-token reservation for session {canonical_session_id}"
            ),
            Self::ReservationStoreUnavailable {
                canonical_session_id,
            } => write!(
                formatter,
                "open-token reservation store is unavailable for session {canonical_session_id}"
            ),
        }
    }
}

impl std::error::Error for OpenTokenReservationArmError {}

pub struct AcpEventHubState {
    sender: broadcast::Sender<AcpEventEnvelope>,
    next_seq: AtomicU64,
    bridge_info: RwLock<Option<AcpEventBridgeInfo>>,
    /// Per-token pre-attach reservations.  Keyed by the open token UUID.
    reservations: std::sync::RwLock<HashMap<Uuid, OpenTokenReservation>>,
}

impl Default for AcpEventHubState {
    fn default() -> Self {
        Self::new()
    }
}

impl AcpEventHubState {
    #[must_use]
    pub fn new() -> Self {
        Self::with_capacity(DEFAULT_EVENT_CHANNEL_CAPACITY)
    }

    #[must_use]
    pub fn with_capacity(capacity: usize) -> Self {
        let (sender, _) = broadcast::channel(capacity);
        Self {
            sender,
            next_seq: AtomicU64::new(0),
            bridge_info: RwLock::new(None),
            reservations: std::sync::RwLock::new(HashMap::new()),
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<AcpEventEnvelope> {
        self.sender.subscribe()
    }

    pub fn publish(
        &self,
        event_name: &str,
        session_id: Option<String>,
        payload: Value,
        priority: &str,
        droppable: bool,
    ) {
        let seq = self.next_seq.fetch_add(1, Ordering::Relaxed) + 1;
        let emitted_at_ms = chrono::Utc::now().timestamp_millis().max(0) as u64;
        let envelope = AcpEventEnvelope {
            seq,
            event_name: event_name.to_string(),
            session_id: session_id.clone(),
            payload,
            priority: priority.to_string(),
            droppable,
            emitted_at_ms,
        };

        // Buffer into any active reservations for this session.
        if let Some(sid) = &session_id {
            if let Ok(mut map) = self.reservations.write() {
                let now = Instant::now();
                for reservation in map.values_mut() {
                    if &reservation.canonical_session_id == sid {
                        reservation.delta_buffer.push_back(envelope.clone());
                        reservation.last_activity = now;
                    }
                }
            }
        }

        if let Err(error) = self.sender.send(envelope) {
            tracing::trace!(%error, "ACP event hub send failed (no active subscribers)");
        }
    }

    pub fn replay_buffered_events(&self, events: Vec<AcpEventEnvelope>) {
        for envelope in events {
            if let Err(error) = self.sender.send(envelope) {
                tracing::trace!(%error, "ACP event hub replay send failed (no active subscribers)");
            }
        }
    }

    // -----------------------------------------------------------------------
    // Open-token reservation primitives (Unit 1)
    // -----------------------------------------------------------------------

    /// Arm a pre-attach reservation for `canonical_session_id`.
    ///
    /// After this call, every event published to the hub for
    /// `canonical_session_id` is appended to the reservation's delta buffer.
    /// Must be called **before** snapshot assembly returns so no delta can
    /// fall through the gap between snapshot read and client connect.
    /// Returns an explicit error when a prepared claimant already owns the
    /// session or the reservation store cannot be updated.
    pub fn arm_reservation(
        &self,
        token: Uuid,
        canonical_session_id: String,
        last_event_seq: i64,
        epoch_ms: u64,
    ) -> Result<(), OpenTokenReservationArmError> {
        let now = Instant::now();
        let reservation = OpenTokenReservation {
            canonical_session_id: canonical_session_id.clone(),
            last_event_seq,
            epoch_ms,
            delta_buffer: VecDeque::new(),
            created_at: now,
            last_activity: now,
            prepared_claim_id: None,
        };
        let mut map = self.reservations.write().map_err(|_| {
            OpenTokenReservationArmError::ReservationStoreUnavailable {
                canonical_session_id: canonical_session_id.clone(),
            }
        })?;
        if map.values().any(|existing_reservation| {
            existing_reservation.canonical_session_id == canonical_session_id.as_str()
                && existing_reservation.prepared_claim_id.is_some()
        }) {
            tracing::debug!(
                %token,
                %canonical_session_id,
                "open-token reservation arm rejected while session claim is prepared"
            );
            return Err(OpenTokenReservationArmError::PreparedClaimInProgress {
                canonical_session_id,
            });
        }
        map.retain(|existing_token, existing_reservation| {
            existing_token == &token
                || existing_reservation.canonical_session_id != canonical_session_id.as_str()
        });
        map.insert(token, reservation);
        Ok(())
    }

    /// Supersede (invalidate) an armed reservation without claiming it.
    ///
    /// Called when the open attempt that created the token terminates with an
    /// error, or when a new open attempt for the same session replaces the
    /// previous token.  Buffered deltas are discarded.
    pub fn supersede_reservation(&self, token: Uuid) {
        if let Ok(mut map) = self.reservations.write() {
            map.remove(&token);
        }
    }

    #[must_use]
    pub fn raise_reservation_frontier(
        &self,
        token: Uuid,
        canonical_session_id: &str,
        last_event_seq: i64,
    ) -> bool {
        if let Ok(mut map) = self.reservations.write() {
            let Some(reservation) = map.get_mut(&token) else {
                return false;
            };
            if reservation.canonical_session_id != canonical_session_id {
                return false;
            }
            reservation.last_event_seq = reservation.last_event_seq.max(last_event_seq);
            reservation.last_activity = Instant::now();
            true
        } else {
            false
        }
    }

    /// Claim a reservation: remove it and return the buffered deltas.
    ///
    /// Returns `None` if the token is unknown (expired, already claimed, or
    /// never armed).  Single-use: a successful claim removes the entry so
    /// subsequent calls with the same token return `None`.
    #[must_use]
    pub fn claim_reservation(&self, token: Uuid) -> Option<Vec<AcpEventEnvelope>> {
        if let Ok(mut map) = self.reservations.write() {
            if map
                .get(&token)
                .is_some_and(|reservation| reservation.prepared_claim_id.is_some())
            {
                return None;
            }
            map.remove(&token)
                .map(|r| r.delta_buffer.into_iter().collect())
        } else {
            None
        }
    }

    #[must_use]
    pub fn claim_reservation_for_session(
        &self,
        token: Uuid,
        canonical_session_id: &str,
    ) -> Option<OpenTokenClaim> {
        if let Ok(mut map) = self.reservations.write() {
            let matches_session = map
                .get(&token)
                .map(|reservation| {
                    reservation.canonical_session_id == canonical_session_id
                        && reservation.prepared_claim_id.is_none()
                })
                .unwrap_or(false);
            if !matches_session {
                return None;
            }
            map.remove(&token).map(|reservation| OpenTokenClaim {
                last_event_seq: reservation.last_event_seq,
                buffered_events: reservation.delta_buffer.into_iter().collect(),
            })
        } else {
            None
        }
    }

    /// Exclusively prepare a matching reservation without removing it.
    ///
    /// Events published after this call keep accumulating until the prepared
    /// claim is committed. A second claimant cannot prepare the same token.
    #[must_use]
    pub fn prepare_reservation_claim_for_session(
        &self,
        token: Uuid,
        canonical_session_id: &str,
    ) -> Option<PreparedOpenTokenClaim> {
        let claim_id = Uuid::new_v4();
        let mut map = self.reservations.write().ok()?;
        let reservation = map.get_mut(&token)?;
        if reservation.canonical_session_id != canonical_session_id
            || reservation.prepared_claim_id.is_some()
        {
            return None;
        }
        reservation.prepared_claim_id = Some(claim_id);
        reservation.last_activity = Instant::now();
        Some(PreparedOpenTokenClaim {
            token,
            canonical_session_id: canonical_session_id.to_string(),
            claim_id,
        })
    }

    /// Commit a prepared claim, retiring the token and returning every event
    /// buffered through the commit point.
    #[must_use]
    pub fn commit_prepared_reservation_claim(
        &self,
        prepared: PreparedOpenTokenClaim,
    ) -> Option<OpenTokenClaim> {
        let mut map = self.reservations.write().ok()?;
        let matches_claim = map
            .get(&prepared.token)
            .map(|reservation| {
                reservation.canonical_session_id == prepared.canonical_session_id
                    && reservation.prepared_claim_id == Some(prepared.claim_id)
            })
            .unwrap_or(false);
        if !matches_claim {
            return None;
        }
        map.remove(&prepared.token)
            .map(|reservation| OpenTokenClaim {
                last_event_seq: reservation.last_event_seq,
                buffered_events: reservation.delta_buffer.into_iter().collect(),
            })
    }

    /// Release a prepared claim without removing its reservation or buffer.
    /// Returns `false` if the reservation expired, was superseded, or no longer
    /// belongs to this claimant.
    #[must_use]
    pub fn release_prepared_reservation_claim(&self, prepared: PreparedOpenTokenClaim) -> bool {
        let Ok(mut map) = self.reservations.write() else {
            return false;
        };
        let Some(reservation) = map.get_mut(&prepared.token) else {
            return false;
        };
        if reservation.canonical_session_id != prepared.canonical_session_id
            || reservation.prepared_claim_id != Some(prepared.claim_id)
        {
            return false;
        }
        reservation.prepared_claim_id = None;
        reservation.last_activity = Instant::now();
        true
    }

    #[must_use]
    pub fn has_reservation_for_session(&self, token: Uuid, canonical_session_id: &str) -> bool {
        self.reservations
            .read()
            .map(|map| {
                map.get(&token)
                    .map(|reservation| reservation.canonical_session_id == canonical_session_id)
                    .unwrap_or(false)
            })
            .unwrap_or(false)
    }

    /// Returns `true` if `token` has an active, unclaimed reservation.
    #[must_use]
    pub fn has_reservation(&self, token: Uuid) -> bool {
        self.reservations
            .read()
            .map(|map| map.contains_key(&token))
            .unwrap_or(false)
    }

    /// Remove unprepared reservations whose last activity is older than
    /// `max_age`. A prepared claimant owns the reservation until it commits or
    /// releases, so slow fallible setup cannot lose buffered events to GC.
    ///
    /// Call this periodically (or with `max_age = Duration::ZERO` in tests) to
    /// reclaim memory from abandoned open tokens.
    pub fn gc_reservations_older_than(&self, max_age: Duration) {
        let Some(deadline) = Instant::now().checked_sub(max_age) else {
            return;
        };
        if let Ok(mut map) = self.reservations.write() {
            map.retain(|_, reservation| {
                reservation.prepared_claim_id.is_some() || reservation.last_activity > deadline
            });
        }
    }

    /// Retire expired reservations using the default [`RESERVATION_TTL`].
    pub fn gc_expired_reservations(&self) {
        self.gc_reservations_older_than(RESERVATION_TTL);
    }

    pub async fn set_bridge_info(&self, info: AcpEventBridgeInfo) {
        let mut guard = self.bridge_info.write().await;
        *guard = Some(info);
    }

    pub async fn get_bridge_info(&self) -> Option<AcpEventBridgeInfo> {
        self.bridge_info.read().await.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gc_reservations_uses_last_activity() {
        let hub = AcpEventHubState::new();
        let token = Uuid::new_v4();
        hub.arm_reservation(token, "session-1".to_string(), 0, 0)
            .expect("reservation should arm");

        {
            let mut reservations = hub.reservations.write().expect("reservation lock");
            let reservation = reservations.get_mut(&token).expect("reservation exists");
            reservation.created_at = Instant::now() - Duration::from_secs(60);
            reservation.last_activity = Instant::now();
        }

        hub.gc_reservations_older_than(Duration::from_secs(30));

        assert!(
            hub.has_reservation(token),
            "recently active reservations must survive GC"
        );
    }

    #[test]
    fn gc_reservations_returns_without_eviction_on_instant_overflow() {
        let hub = AcpEventHubState::new();
        let token = Uuid::new_v4();
        hub.arm_reservation(token, "session-1".to_string(), 0, 0)
            .expect("reservation should arm");

        hub.gc_reservations_older_than(Duration::MAX);

        assert!(
            hub.has_reservation(token),
            "overflow fallback must not evict active reservations"
        );
    }

    #[test]
    fn arm_reservation_supersedes_older_tokens_for_same_session() {
        let hub = AcpEventHubState::new();
        let first = Uuid::new_v4();
        let second = Uuid::new_v4();

        hub.arm_reservation(first, "session-1".to_string(), 0, 0)
            .expect("first reservation should arm");
        hub.arm_reservation(second, "session-1".to_string(), 0, 0)
            .expect("second reservation should arm");

        assert!(
            !hub.has_reservation(first),
            "older token for the same session must be superseded"
        );
        assert!(
            hub.has_reservation(second),
            "newest token must remain active"
        );
    }

    #[test]
    fn arm_reservation_rejects_new_token_while_same_session_claim_is_prepared() {
        let hub = AcpEventHubState::new();
        let prepared_token = Uuid::new_v4();
        let competing_token = Uuid::new_v4();

        hub.arm_reservation(prepared_token, "session-1".to_string(), 4, 0)
            .expect("first reservation should arm");
        let prepared = hub
            .prepare_reservation_claim_for_session(prepared_token, "session-1")
            .expect("first token should prepare");

        let arm_error = hub
            .arm_reservation(competing_token, "session-1".to_string(), 9, 0)
            .expect_err("competing reservation must be rejected explicitly");

        assert_eq!(
            arm_error,
            OpenTokenReservationArmError::PreparedClaimInProgress {
                canonical_session_id: "session-1".to_string(),
            }
        );

        assert!(
            hub.has_reservation(prepared_token),
            "prepared token must retain ownership"
        );
        assert!(
            !hub.has_reservation(competing_token),
            "competing token must not arm while the session has a prepared claim"
        );
        assert!(
            hub.commit_prepared_reservation_claim(prepared).is_some(),
            "prepared owner must still be able to commit"
        );
    }

    #[test]
    fn claim_reservation_for_session_returns_buffered_events_and_retires_token() {
        let hub = AcpEventHubState::new();
        let token = Uuid::new_v4();
        hub.arm_reservation(token, "session-1".to_string(), 4, 0)
            .expect("reservation should arm");
        hub.publish(
            "session_update",
            Some("session-1".to_string()),
            serde_json::json!({
                "eventSeq": 5,
                "kind": "appendEntry"
            }),
            "high",
            false,
        );

        let claimed = hub
            .claim_reservation_for_session(token, "session-1")
            .expect("claim should succeed for matching session");

        assert_eq!(claimed.last_event_seq, 4);
        assert_eq!(claimed.buffered_events.len(), 1);
        assert_eq!(claimed.buffered_events[0].event_name, "session_update");
        assert_eq!(
            claimed.buffered_events[0].session_id.as_deref(),
            Some("session-1")
        );
        assert!(
            !hub.has_reservation(token),
            "successful claim must retire the token"
        );
    }

    #[test]
    fn prepared_claim_keeps_buffering_events_until_commit() {
        let hub = AcpEventHubState::new();
        let token = Uuid::new_v4();
        hub.arm_reservation(token, "session-1".to_string(), 4, 0)
            .expect("reservation should arm");

        let prepared = hub
            .prepare_reservation_claim_for_session(token, "session-1")
            .expect("matching reservation should prepare");
        hub.publish(
            "session_update",
            Some("session-1".to_string()),
            serde_json::json!({ "eventSeq": 5 }),
            "high",
            false,
        );

        let claimed = hub
            .commit_prepared_reservation_claim(prepared)
            .expect("prepared reservation should commit");

        assert_eq!(claimed.last_event_seq, 4);
        assert_eq!(claimed.buffered_events.len(), 1);
        assert_eq!(claimed.buffered_events[0].event_name, "session_update");
        assert!(!hub.has_reservation(token));
    }

    #[test]
    fn competing_prepare_cannot_claim_the_same_reservation() {
        let hub = AcpEventHubState::new();
        let token = Uuid::new_v4();
        hub.arm_reservation(token, "session-1".to_string(), 0, 0)
            .expect("reservation should arm");

        let prepared = hub
            .prepare_reservation_claim_for_session(token, "session-1")
            .expect("first claimant should prepare");

        assert!(
            hub.prepare_reservation_claim_for_session(token, "session-1")
                .is_none(),
            "a prepared reservation must reject a competing claimant"
        );
        assert!(hub.has_reservation(token));
        assert!(hub.commit_prepared_reservation_claim(prepared).is_some());
    }

    #[test]
    fn releasing_prepared_claim_permits_retry() {
        let hub = AcpEventHubState::new();
        let token = Uuid::new_v4();
        hub.arm_reservation(token, "session-1".to_string(), 0, 0)
            .expect("reservation should arm");

        let prepared = hub
            .prepare_reservation_claim_for_session(token, "session-1")
            .expect("first claimant should prepare");
        assert!(hub.release_prepared_reservation_claim(prepared));

        let retry = hub
            .prepare_reservation_claim_for_session(token, "session-1")
            .expect("released reservation should be claimable again");
        assert!(hub.commit_prepared_reservation_claim(retry).is_some());
    }

    #[test]
    fn prepared_claim_survives_reservation_gc_during_fallible_setup() {
        let hub = AcpEventHubState::new();
        let token = Uuid::new_v4();
        hub.arm_reservation(token, "session-1".to_string(), 0, 0)
            .expect("reservation should arm");

        let prepared = hub
            .prepare_reservation_claim_for_session(token, "session-1")
            .expect("matching reservation should prepare");
        {
            let mut reservations = hub.reservations.write().expect("reservation lock");
            let reservation = reservations.get_mut(&token).expect("reservation exists");
            reservation.last_activity = Instant::now() - Duration::from_secs(60);
        }

        hub.gc_reservations_older_than(Duration::from_secs(30));

        assert!(hub.has_reservation(token));
        assert!(hub.commit_prepared_reservation_claim(prepared).is_some());
    }

    #[test]
    fn raise_reservation_frontier_updates_claim_cutoff_without_losing_buffered_events() {
        let hub = AcpEventHubState::new();
        let token = Uuid::new_v4();
        hub.arm_reservation(token, "session-1".to_string(), 0, 0)
            .expect("reservation should arm");
        hub.publish(
            "session_update",
            Some("session-1".to_string()),
            serde_json::json!({
                "eventSeq": 8,
                "kind": "appendEntry"
            }),
            "normal",
            false,
        );

        assert!(
            hub.raise_reservation_frontier(token, "session-1", 7),
            "frontier should update while reservation is active"
        );
        let claimed = hub
            .claim_reservation_for_session(token, "session-1")
            .expect("claim should succeed for matching session");

        assert_eq!(claimed.last_event_seq, 7);
        assert_eq!(claimed.buffered_events.len(), 1);
        assert_eq!(claimed.buffered_events[0].event_name, "session_update");
    }

    #[test]
    fn replay_buffered_events_preserves_event_order_for_subscribers() {
        let hub = AcpEventHubState::new();
        let mut receiver = hub.subscribe();

        hub.replay_buffered_events(vec![
            AcpEventEnvelope {
                seq: 7,
                event_name: "acp-transcript-delta".to_string(),
                session_id: Some("session-1".to_string()),
                payload: serde_json::json!({ "value": 1 }),
                priority: "normal".to_string(),
                droppable: false,
                emitted_at_ms: 1,
            },
            AcpEventEnvelope {
                seq: 8,
                event_name: "acp-transcript-delta".to_string(),
                session_id: Some("session-1".to_string()),
                payload: serde_json::json!({ "value": 2 }),
                priority: "normal".to_string(),
                droppable: false,
                emitted_at_ms: 2,
            },
        ]);

        let first = receiver.try_recv().expect("first replayed event");
        let second = receiver.try_recv().expect("second replayed event");

        assert_eq!(first.seq, 7);
        assert_eq!(second.seq, 8);
    }
}
