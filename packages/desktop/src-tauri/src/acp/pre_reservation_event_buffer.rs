use crate::acp::session_update::SessionUpdate;
use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;

const MAX_EVENTS_PER_KEY: usize = 16;
const MAX_BYTES_PER_KEY: usize = 64 * 1024;
const MAX_SESSION_KEYS: usize = 128;
const MAX_TOTAL_BYTES: usize = 2 * 1024 * 1024;
const DEFAULT_RUNTIME_SOURCE: &str = "rust-acp-runtime";

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct PreReservationEventKey {
    source_id: String,
    session_id: String,
}

impl PreReservationEventKey {
    fn runtime(session_id: &str) -> Self {
        Self {
            source_id: DEFAULT_RUNTIME_SOURCE.to_string(),
            session_id: session_id.to_string(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PreReservationEntryState {
    Collecting,
    Draining,
}

#[derive(Debug)]
struct PreReservationEntry {
    state: PreReservationEntryState,
    updates: VecDeque<SessionUpdate>,
    byte_size: usize,
    diagnostics: HashMap<&'static str, usize>,
}

impl PreReservationEntry {
    fn collecting() -> Self {
        Self {
            state: PreReservationEntryState::Collecting,
            updates: VecDeque::new(),
            byte_size: 0,
            diagnostics: HashMap::new(),
        }
    }

    fn draining() -> Self {
        Self {
            state: PreReservationEntryState::Draining,
            updates: VecDeque::new(),
            byte_size: 0,
            diagnostics: HashMap::new(),
        }
    }
}

#[derive(Debug, Default)]
struct PreReservationBufferState {
    entries: HashMap<PreReservationEventKey, PreReservationEntry>,
    total_bytes: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreReservationIngressDecision {
    Allow,
    Buffered,
    Rejected,
}

#[derive(Debug, Default)]
pub struct PreReservationEventBuffer {
    state: Mutex<PreReservationBufferState>,
}

impl PreReservationEventBuffer {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    #[must_use]
    pub fn decide_ingress(
        &self,
        session_id: &str,
        lifecycle_exists: bool,
        update: &SessionUpdate,
    ) -> PreReservationIngressDecision {
        let key = PreReservationEventKey::runtime(session_id);
        let mut state = self.state.lock().expect("pre-reservation buffer lock");
        let entry_state = state.entries.get(&key).map(|entry| entry.state);

        if lifecycle_exists && entry_state != Some(PreReservationEntryState::Draining) {
            return PreReservationIngressDecision::Allow;
        }

        if lifecycle_exists && entry_state == Some(PreReservationEntryState::Draining) {
            return buffer_update(&mut state, key, update, true);
        }

        if !is_pre_reservation_buffer_eligible(update) {
            record_diagnostic(&mut state, key, "edge_ordering_rejected");
            return PreReservationIngressDecision::Rejected;
        }

        buffer_update(&mut state, key, update, false)
    }

    pub fn begin_draining(&self, session_id: &str) {
        let key = PreReservationEventKey::runtime(session_id);
        let mut state = self.state.lock().expect("pre-reservation buffer lock");
        let existing_key_count = state.entries.len();
        let entry = state.entries.entry(key.clone()).or_insert_with(|| {
            if existing_key_count >= MAX_SESSION_KEYS {
                tracing::warn!(
                    session_id = %redacted_session_id(&key.session_id),
                    reason = "session_key_limit",
                    "Pre-reservation event buffer cannot create drain guard"
                );
            }
            PreReservationEntry::draining()
        });
        entry.state = PreReservationEntryState::Draining;
    }

    #[must_use]
    pub fn take_draining_batch(&self, session_id: &str) -> Vec<SessionUpdate> {
        let key = PreReservationEventKey::runtime(session_id);
        let mut state = self.state.lock().expect("pre-reservation buffer lock");
        let Some((drained_bytes, updates)) = ({
            let Some(entry) = state.entries.get_mut(&key) else {
                return Vec::new();
            };
            let drained_bytes = entry.byte_size;
            entry.byte_size = 0;
            let updates = entry.updates.drain(..).collect();
            Some((drained_bytes, updates))
        }) else {
            return Vec::new();
        };
        state.total_bytes = state.total_bytes.saturating_sub(drained_bytes);
        updates
    }

    #[must_use]
    pub fn finish_draining_or_next_batch(&self, session_id: &str) -> Option<Vec<SessionUpdate>> {
        let key = PreReservationEventKey::runtime(session_id);
        let mut state = self.state.lock().expect("pre-reservation buffer lock");
        if state
            .entries
            .get(&key)
            .is_none_or(|entry| entry.updates.is_empty())
        {
            state.entries.remove(&key);
            return None;
        }

        let (drained_bytes, updates) = {
            let entry = state.entries.get_mut(&key)?;
            let drained_bytes = entry.byte_size;
            entry.byte_size = 0;
            let updates = entry.updates.drain(..).collect();
            (drained_bytes, updates)
        };
        state.total_bytes = state.total_bytes.saturating_sub(drained_bytes);
        Some(updates)
    }

    pub fn discard(&self, session_id: &str, reason: &'static str) {
        let key = PreReservationEventKey::runtime(session_id);
        let mut state = self.state.lock().expect("pre-reservation buffer lock");
        let Some(entry) = state.entries.remove(&key) else {
            return;
        };
        state.total_bytes = state.total_bytes.saturating_sub(entry.byte_size);
        tracing::warn!(
            session_id = %redacted_session_id(&key.session_id),
            reason,
            buffered_events = entry.updates.len(),
            "Discarded pre-reservation buffered events"
        );
    }

    #[cfg(test)]
    #[must_use]
    pub fn buffered_event_count(&self, session_id: &str) -> usize {
        let key = PreReservationEventKey::runtime(session_id);
        let state = self.state.lock().expect("pre-reservation buffer lock");
        state
            .entries
            .get(&key)
            .map(|entry| entry.updates.len())
            .unwrap_or(0)
    }
}

fn buffer_update(
    state: &mut PreReservationBufferState,
    key: PreReservationEventKey,
    update: &SessionUpdate,
    lifecycle_known_drain: bool,
) -> PreReservationIngressDecision {
    let serialized_size = serialized_update_size(update);
    let existing_key_count = state.entries.len();
    if !state.entries.contains_key(&key) && existing_key_count >= MAX_SESSION_KEYS {
        tracing::warn!(
            session_id = %redacted_session_id(&key.session_id),
            source_id = %key.source_id,
            reason = "session_key_limit",
            "Pre-reservation event was not accepted into product state"
        );
        return PreReservationIngressDecision::Rejected;
    }

    let total_bytes_before = state.total_bytes;
    let accepted = {
        let entry = state
            .entries
            .entry(key.clone())
            .or_insert_with(PreReservationEntry::collecting);
        if lifecycle_known_drain {
            entry.state = PreReservationEntryState::Draining;
        }

        if entry.updates.len() >= MAX_EVENTS_PER_KEY
            || entry.byte_size.saturating_add(serialized_size) > MAX_BYTES_PER_KEY
            || total_bytes_before.saturating_add(serialized_size) > MAX_TOTAL_BYTES
        {
            record_entry_diagnostic(&key, entry, "buffer_limit");
            false
        } else {
            entry.updates.push_back(update.clone());
            entry.byte_size = entry.byte_size.saturating_add(serialized_size);
            true
        }
    };
    if !accepted {
        return PreReservationIngressDecision::Rejected;
    }
    state.total_bytes = state.total_bytes.saturating_add(serialized_size);
    PreReservationIngressDecision::Buffered
}

fn record_diagnostic(
    state: &mut PreReservationBufferState,
    key: PreReservationEventKey,
    reason: &'static str,
) {
    let existing_key_count = state.entries.len();
    let entry = state.entries.entry(key.clone()).or_insert_with(|| {
        if existing_key_count >= MAX_SESSION_KEYS {
            tracing::warn!(
                session_id = %redacted_session_id(&key.session_id),
                reason = "session_key_limit",
                "Pre-reservation event buffer diagnostic could not allocate normal entry"
            );
        }
        PreReservationEntry::collecting()
    });
    record_entry_diagnostic(&key, entry, reason);
}

fn record_entry_diagnostic(
    key: &PreReservationEventKey,
    entry: &mut PreReservationEntry,
    reason: &'static str,
) {
    let count = entry.diagnostics.entry(reason).or_insert(0);
    *count = count.saturating_add(1);
    if *count == 1 {
        tracing::warn!(
            session_id = %redacted_session_id(&key.session_id),
            source_id = %key.source_id,
            reason,
            "Pre-reservation event was not accepted into product state"
        );
    }
}

fn serialized_update_size(update: &SessionUpdate) -> usize {
    serde_json::to_vec(update)
        .map(|bytes| bytes.len())
        .unwrap_or(MAX_BYTES_PER_KEY.saturating_add(1))
}

fn is_pre_reservation_buffer_eligible(update: &SessionUpdate) -> bool {
    matches!(
        update,
        SessionUpdate::AvailableCommandsUpdate { .. }
            | SessionUpdate::CurrentModeUpdate { .. }
            | SessionUpdate::ConfigOptionUpdate { .. }
    )
}

fn redacted_session_id(session_id: &str) -> String {
    let prefix: String = session_id.chars().take(8).collect();
    format!("{prefix}...")
}
