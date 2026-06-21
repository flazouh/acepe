use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

#[derive(Debug)]
struct SessionAnchor {
    started_at: Instant,
}

impl SessionAnchor {
    fn new() -> Self {
        Self {
            started_at: Instant::now(),
        }
    }

    fn elapsed_ms(&self) -> u64 {
        let elapsed = self.started_at.elapsed();
        u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX)
    }
}

#[derive(Debug, Clone)]
pub struct AnchorLedger {
    session_anchors: Arc<Mutex<HashMap<String, Arc<SessionAnchor>>>>,
}

impl AnchorLedger {
    #[must_use]
    pub fn new() -> Self {
        Self {
            session_anchors: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Returns ms elapsed since the session anchor (created on first call).
    /// Monotonic per session under a single ledger instance.
    pub fn record_chunk_timestamp(&self, session_id: &str) -> u64 {
        self.anchor_for(session_id).elapsed_ms()
    }

    fn anchor_for(&self, session_id: &str) -> Arc<SessionAnchor> {
        let mut guard = self
            .session_anchors
            .lock()
            .expect("session_anchors mutex poisoned");
        guard
            .entry(session_id.to_string())
            .or_insert_with(|| Arc::new(SessionAnchor::new()))
            .clone()
    }

    pub fn remove_session(&self, session_id: &str) {
        self.session_anchors
            .lock()
            .expect("session_anchors mutex poisoned")
            .remove(session_id);
    }
}

impl Default for AnchorLedger {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::AnchorLedger;

    #[test]
    fn record_chunk_timestamp_is_monotonic_per_session() {
        let ledger = AnchorLedger::new();
        let session_id = "sess-mono-1";
        let t0 = ledger.record_chunk_timestamp(session_id);
        let t1 = ledger.record_chunk_timestamp(session_id);
        let t2 = ledger.record_chunk_timestamp(session_id);
        assert!(t1 >= t0, "t1={t1} t0={t0} expected non-decreasing");
        assert!(t2 >= t1, "t2={t2} t1={t1} expected non-decreasing");
    }

    #[test]
    fn record_chunk_timestamp_isolates_sessions() {
        let ledger = AnchorLedger::new();
        let _ = ledger.record_chunk_timestamp("sess-a");
        std::thread::sleep(std::time::Duration::from_millis(2));
        let a_after_sleep = ledger.record_chunk_timestamp("sess-a");
        let b_first = ledger.record_chunk_timestamp("sess-b");
        assert!(
            a_after_sleep > b_first,
            "a_after_sleep={a_after_sleep} b_first={b_first}"
        );
    }

    #[test]
    fn remove_session_clears_anchor() {
        let ledger = AnchorLedger::new();
        let session_id = "sess-remove";
        let _ = ledger.record_chunk_timestamp(session_id);
        std::thread::sleep(std::time::Duration::from_millis(5));
        let before = ledger.record_chunk_timestamp(session_id);
        assert!(
            before > 0,
            "anchor should have measurable elapsed time before remove"
        );
        ledger.remove_session(session_id);
        let after = ledger.record_chunk_timestamp(session_id);
        assert!(
            after < before,
            "after remove, a fresh anchor should reset elapsed time (before={before}, after={after})"
        );
    }
}
