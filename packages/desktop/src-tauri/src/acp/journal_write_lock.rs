//! Per-session journal write serialization.
//!
//! Multiple Tokio tasks can publish session updates concurrently for the same
//! session — most notably the command-handler task in
//! [`crate::acp::commands::interaction_commands::send_prompt_with_app_handle`]
//! (which calls
//! [`crate::acp::ui_event_dispatcher::publish_direct_session_update`] for the
//! synthetic `UserMessageChunk`) and the streaming bridge task in
//! `cc_sdk_client::run_streaming_bridge` (which calls `dispatcher.enqueue` for
//! `AgentMessageChunk` events that drain through
//! [`crate::acp::ui_event_dispatcher::run_dispatch_loop`]).
//!
//! Both paths converge on
//! [`crate::acp::ui_event_dispatcher::persist_dispatch_event`], which assigns
//! the durable delivery `event_seq`, records a runtime checkpoint, applies the
//! update to projections, and builds the live session-state envelope. Graph
//! and transcript revisions remain separate counters; neither is an alias for
//! delivery `event_seq`.
//!
//! Every update receives its seq from
//! `SessionEventWriter::commit_session_update`, including updates
//! that do not store a raw journal payload. The database-owned sequence is the
//! ordering authority for delivery; journal rows reference it when a raw
//! payload is stored.
//!
//! Without serialization, two same-session tasks can observe the same previous
//! frontier and then interleave their seq assignment and transcript apply. The
//! transcript projection revision counter only advances forward, so a late
//! smaller-seq apply can leave the entry list tail order inconsistent with the
//! effective event order — the reproducible `[assistant, user]` symptom that
//! motivates Phase A of the canonical-only entry list refactor.
//!
//! This registry hands out a [`tokio::sync::Mutex`] keyed by `session_id`. The
//! lock is acquired by the direct-publish and dispatcher-drain callers before
//! entering `persist_dispatch_event` and released after that event's publish
//! work completes. It does **not** span the full prompt lifecycle — only one
//! per-event persistence/projection critical section. Concurrent sessions
//! remain fully parallel.
//!
//! Plan reference: `docs/plans/2026-05-03-001-refactor-canonical-only-entry-list-plan.md`
//! sub-task 1a. The plan's wording ("for the duration of the journal write")
//! is too narrow; the projection apply must also be inside the lock or the
//! ordering invariant is not actually preserved. See the plan resolution
//! note for the deviation rationale.

use dashmap::DashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Hands out per-session async mutexes used to serialize journal+projection
/// writes for the same session across concurrent Tokio tasks.
#[derive(Debug, Default)]
pub struct JournalWriteLockRegistry {
    locks: DashMap<String, Arc<Mutex<()>>>,
}

impl JournalWriteLockRegistry {
    #[must_use]
    pub fn new() -> Self {
        Self {
            locks: DashMap::new(),
        }
    }

    /// Returns a clone of the per-session mutex, creating it on first use.
    ///
    /// Callers acquire `lock().await` on the returned `Arc<Mutex<()>>` to enter
    /// the journal-and-projection critical section for the given session.
    #[must_use]
    pub fn lock_for(&self, session_id: &str) -> Arc<Mutex<()>> {
        if let Some(existing) = self.locks.get(session_id) {
            return Arc::clone(existing.value());
        }
        // Race-tolerant insert: if two tasks race to create the lock for the
        // same session, both end up with the same `Arc` because `DashMap::entry`
        // serializes the bucket.
        Arc::clone(
            self.locks
                .entry(session_id.to_string())
                .or_insert_with(|| Arc::new(Mutex::new(())))
                .value(),
        )
    }

    /// Drops the mutex for a session. Safe to call after the session has been
    /// fully terminated; any in-flight `lock()` futures will still resolve
    /// because they hold their own `Arc` reference.
    pub fn forget(&self, session_id: &str) {
        self.locks.remove(session_id);
    }

    #[must_use]
    pub fn tracked_session_count(&self) -> usize {
        self.locks.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn lock_for_returns_same_mutex_across_calls_for_same_session() {
        let registry = JournalWriteLockRegistry::new();
        let a = registry.lock_for("session-1");
        let b = registry.lock_for("session-1");
        assert!(Arc::ptr_eq(&a, &b));
    }

    #[tokio::test]
    async fn lock_for_returns_distinct_mutexes_for_distinct_sessions() {
        let registry = JournalWriteLockRegistry::new();
        let a = registry.lock_for("session-1");
        let b = registry.lock_for("session-2");
        assert!(!Arc::ptr_eq(&a, &b));
    }

    #[tokio::test]
    async fn concurrent_lock_for_calls_yield_a_single_shared_mutex() {
        let registry = Arc::new(JournalWriteLockRegistry::new());
        let mut handles = Vec::new();
        for _ in 0..16 {
            let registry = Arc::clone(&registry);
            handles.push(tokio::spawn(
                async move { registry.lock_for("racey-session") },
            ));
        }
        let mut mutexes = Vec::new();
        for handle in handles {
            mutexes.push(handle.await.expect("join"));
        }
        for pair in mutexes.windows(2) {
            assert!(Arc::ptr_eq(&pair[0], &pair[1]));
        }
        assert_eq!(registry.tracked_session_count(), 1);
    }

    #[tokio::test]
    async fn forget_drops_session_entry() {
        let registry = JournalWriteLockRegistry::new();
        let _held = registry.lock_for("session-1");
        registry.forget("session-1");
        assert_eq!(registry.tracked_session_count(), 0);
    }
}
