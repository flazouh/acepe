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
/// Tokens are single-use: the first successful `claim_reservation` removes
/// the entry and returns the buffered events.  Reservations expire after
/// [`RESERVATION_TTL`] of inactivity to prevent abandoned opens from leaking
/// buffered deltas indefinitely.
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
}

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

    // -----------------------------------------------------------------------
    // Open-token reservation primitives (Unit 1)
    // -----------------------------------------------------------------------

    /// Arm a pre-attach reservation for `canonical_session_id`.
    ///
    /// After this call, every event published to the hub for
    /// `canonical_session_id` is appended to the reservation's delta buffer.
    /// Must be called **before** snapshot assembly returns so no delta can
    /// fall through the gap between snapshot read and client connect.
    pub fn arm_reservation(
        &self,
        token: Uuid,
        canonical_session_id: String,
        last_event_seq: i64,
        epoch_ms: u64,
    ) {
        let now = Instant::now();
        let reservation = OpenTokenReservation {
            canonical_session_id: canonical_session_id.clone(),
            last_event_seq,
            epoch_ms,
            delta_buffer: VecDeque::new(),
            created_at: now,
            last_activity: now,
        };
        if let Ok(mut map) = self.reservations.write() {
            map.retain(|existing_token, existing_reservation| {
                existing_token == &token
                    || existing_reservation.canonical_session_id != canonical_session_id.as_str()
            });
            map.insert(token, reservation);
        }
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

    /// Claim a reservation: remove it and return the buffered deltas.
    ///
    /// Returns `None` if the token is unknown (expired, already claimed, or
    /// never armed).  Single-use: a successful claim removes the entry so
    /// subsequent calls with the same token return `None`.
    #[must_use]
    pub fn claim_reservation(&self, token: Uuid) -> Option<Vec<AcpEventEnvelope>> {
        if let Ok(mut map) = self.reservations.write() {
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
    ) -> Option<Vec<AcpEventEnvelope>> {
        if let Ok(mut map) = self.reservations.write() {
            let matches_session = map
                .get(&token)
                .map(|reservation| reservation.canonical_session_id == canonical_session_id)
                .unwrap_or(false);
            if !matches_session {
                return None;
            }
            map.remove(&token)
                .map(|reservation| reservation.delta_buffer.into_iter().collect())
        } else {
            None
        }
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

    /// Remove all reservations whose `created_at` is older than `max_age`.
    ///
    /// Call this periodically (or with `max_age = Duration::ZERO` in tests) to
    /// reclaim memory from abandoned open tokens.
    pub fn gc_reservations_older_than(&self, max_age: Duration) {
        let Some(deadline) = Instant::now().checked_sub(max_age) else {
            return;
        };
        if let Ok(mut map) = self.reservations.write() {
            map.retain(|_, r| r.last_activity > deadline);
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
        hub.arm_reservation(token, "session-1".to_string(), 0, 0);

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
        hub.arm_reservation(token, "session-1".to_string(), 0, 0);

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

        hub.arm_reservation(first, "session-1".to_string(), 0, 0);
        hub.arm_reservation(second, "session-1".to_string(), 0, 0);

        assert!(
            !hub.has_reservation(first),
            "older token for the same session must be superseded"
        );
        assert!(
            hub.has_reservation(second),
            "newest token must remain active"
        );
    }
}
