//! Non-streaming event batcher for Tauri event coalescing.
//!
//! Batches rapid non-streaming session updates (like AvailableCommandsUpdate) into
//! spaced emissions at 8ms intervals to prevent frontend JS event loop saturation.
//!
//! Unlike StreamingDeltaBatcher which coalesces text content, this batcher
//! replaces older updates with newer ones (latest-wins semantics).
//!
//! # Comparison with streaming batcher
//!
//! | Aspect | NonStreamingEventBatcher | StreamingDeltaBatcher |
//! |--------|--------------------------|----------------------|
//! | Content | SessionUpdate (commands) | SessionUpdate deltas |
//! | Coalescing | Latest-wins replacement | Content merging |
//! | Interval | 8ms | 16ms |
//! | Use case | Prevent JS event saturation | Reduce IPC overhead |

use std::collections::HashMap;
use std::time::{Duration, Instant};

use crate::acp::session_update::SessionUpdate;

/// Batch interval - 8ms for non-streaming updates.
/// Short enough to feel responsive, long enough to give JS breathing room.
const BATCH_INTERVAL: Duration = Duration::from_millis(8);

/// Maximum number of concurrent session buffers.
/// Prevents unbounded HashMap growth from many simultaneous sessions.
const MAX_PENDING_SESSIONS: usize = 100;

/// Maximum buffer size in bytes - prevents memory exhaustion.
const MAX_BUFFER_BYTES: usize = 1024 * 1024; // 1MB

/// Batches non-streaming session updates to reduce Tauri event frequency.
///
/// Instead of emitting every update immediately (which can saturate the JS
/// event loop when multiple arrive at the same millisecond), this batcher
/// accumulates updates and emits them spaced apart.
///
/// For a given session, only the latest update is kept (replacement semantics).
pub struct NonStreamingEventBatcher {
    /// Map of session_id -> latest pending update
    pending: HashMap<String, SessionUpdate>,
    /// When the first update in the current batch was received
    last_flush: Instant,
    /// Approximate buffer size in bytes (for memory protection)
    approx_bytes: usize,
}

impl NonStreamingEventBatcher {
    pub fn new() -> Self {
        Self {
            pending: HashMap::with_capacity(8),
            last_flush: Instant::now(),
            approx_bytes: 0,
        }
    }

    /// Process a session update, potentially batching it.
    ///
    /// Returns updates ready to emit. May be empty (buffered) or multiple (flushed).
    #[must_use = "updates must be emitted to the frontend"]
    pub fn process(&mut self, session_id: &str, update: SessionUpdate) -> Vec<SessionUpdate> {
        let now = Instant::now();

        // Force flush if at capacity (new session and limits exceeded)
        if !self.pending.contains_key(session_id)
            && (self.pending.len() >= MAX_PENDING_SESSIONS || self.approx_bytes >= MAX_BUFFER_BYTES)
        {
            tracing::warn!(
                pending_sessions = self.pending.len(),
                approx_bytes = self.approx_bytes,
                "NonStreamingEventBatcher at capacity, force flushing"
            );
            return self.flush_all();
        }

        // Estimate size (rough approximation using size_of_val)
        let update_size = std::mem::size_of_val(&update);

        // If replacing an existing entry, subtract old size
        if let Some(old) = self.pending.get(session_id) {
            self.approx_bytes = self.approx_bytes.saturating_sub(std::mem::size_of_val(old));
        }

        self.approx_bytes += update_size;
        self.pending.insert(session_id.to_string(), update);

        // Check if enough time has passed to flush
        if now.duration_since(self.last_flush) >= BATCH_INTERVAL {
            self.flush_all()
        } else {
            vec![]
        }
    }

    /// Flush all pending updates.
    #[must_use = "flushed updates must be emitted to the frontend"]
    pub fn flush_all(&mut self) -> Vec<SessionUpdate> {
        self.last_flush = Instant::now();
        self.approx_bytes = 0;
        self.pending.drain().map(|(_, v)| v).collect()
    }

    /// Check if any updates are pending.
    pub fn has_pending(&self) -> bool {
        !self.pending.is_empty()
    }

    /// Get the time until the next scheduled flush, if any updates are pending.
    /// Returns None if no updates are pending.
    #[must_use = "check the time to coordinate with tokio::select! timer"]
    pub fn time_until_flush(&self) -> Option<Duration> {
        if self.pending.is_empty() {
            None
        } else {
            let elapsed = self.last_flush.elapsed();
            if elapsed >= BATCH_INTERVAL {
                Some(Duration::ZERO)
            } else {
                Some(BATCH_INTERVAL - elapsed)
            }
        }
    }

    /// Get the number of pending updates.
    pub fn pending_count(&self) -> usize {
        self.pending.len()
    }
}

impl Default for NonStreamingEventBatcher {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::session_update::{AvailableCommand, AvailableCommandsData};

    fn make_commands_update(session_id: &str, command_count: usize) -> SessionUpdate {
        let commands: Vec<AvailableCommand> = (0..command_count)
            .map(|i| AvailableCommand {
                name: format!("command-{}", i),
                description: format!("Description for command {}", i),
                input: None,
            })
            .collect();

        SessionUpdate::AvailableCommandsUpdate {
            update: AvailableCommandsData {
                available_commands: commands,
            },
            session_id: Some(session_id.to_string()),
        }
    }

    #[test]
    fn test_normal_update_buffered() {
        let mut batcher = NonStreamingEventBatcher::new();
        let update = make_commands_update("session-1", 5);

        let result = batcher.process("session-1", update);

        assert!(result.is_empty());
        assert!(batcher.has_pending());
        assert_eq!(batcher.pending_count(), 1);
    }

    #[test]
    fn test_rapid_updates_coalesce() {
        let mut batcher = NonStreamingEventBatcher::new();

        // Queue 3 updates rapidly for same session
        let result1 = batcher.process("session-1", make_commands_update("session-1", 1));
        let result2 = batcher.process("session-1", make_commands_update("session-1", 2));
        let result3 = batcher.process("session-1", make_commands_update("session-1", 3));

        // Should not emit yet (within interval)
        assert!(result1.is_empty());
        assert!(result2.is_empty());
        assert!(result3.is_empty());

        // Only one pending (latest wins)
        assert_eq!(batcher.pending_count(), 1);
    }

    #[test]
    fn test_flush_all_returns_accumulated() {
        let mut batcher = NonStreamingEventBatcher::new();

        let _ = batcher.process("session-1", make_commands_update("session-1", 5));
        let _ = batcher.process("session-2", make_commands_update("session-2", 10));

        let flushed = batcher.flush_all();
        assert_eq!(flushed.len(), 2);
        assert!(!batcher.has_pending());
    }

    #[test]
    fn test_respects_interval() {
        let mut batcher = NonStreamingEventBatcher::new();

        let _ = batcher.process("session-1", make_commands_update("session-1", 1));
        assert!(batcher.has_pending());

        std::thread::sleep(Duration::from_millis(10));

        let updates = batcher.process("session-1", make_commands_update("session-1", 2));
        // Should have flushed due to interval
        assert!(!updates.is_empty() || !batcher.has_pending());
    }

    #[test]
    fn test_max_pending_sessions_triggers_flush() {
        let mut batcher = NonStreamingEventBatcher::new();

        // Fill to capacity
        for i in 0..MAX_PENDING_SESSIONS {
            let _ = batcher.process(
                &format!("session-{}", i),
                make_commands_update(&format!("session-{}", i), 1),
            );
        }
        assert_eq!(batcher.pending_count(), MAX_PENDING_SESSIONS);

        // Next insert for a new session should force flush
        let updates = batcher.process(
            "overflow-session",
            make_commands_update("overflow-session", 1),
        );
        assert!(!updates.is_empty());
    }

    #[test]
    fn test_time_until_flush_returns_remaining_time() {
        let mut batcher = NonStreamingEventBatcher::new();

        assert!(batcher.time_until_flush().is_none()); // Empty

        let _ = batcher.process("session-1", make_commands_update("session-1", 1));

        let remaining = batcher.time_until_flush();
        assert!(remaining.is_some());
        assert!(remaining.unwrap() <= Duration::from_millis(8));
    }

    #[test]
    fn test_empty_flush() {
        let mut batcher = NonStreamingEventBatcher::new();

        let result = batcher.flush_all();

        assert!(result.is_empty());
    }

    #[test]
    fn test_replacement_semantics() {
        let mut batcher = NonStreamingEventBatcher::new();

        // Add update with 5 commands
        let _ = batcher.process("session-1", make_commands_update("session-1", 5));

        // Replace with update with 10 commands
        let _ = batcher.process("session-1", make_commands_update("session-1", 10));

        // Should only have 1 pending (the latest)
        assert_eq!(batcher.pending_count(), 1);

        let flushed = batcher.flush_all();
        assert_eq!(flushed.len(), 1);

        // Verify it's the 10-command update
        if let SessionUpdate::AvailableCommandsUpdate { update, .. } = &flushed[0] {
            assert_eq!(update.available_commands.len(), 10);
        } else {
            panic!("Expected AvailableCommandsUpdate");
        }
    }

    #[test]
    fn test_large_payload_does_not_panic() {
        let mut batcher = NonStreamingEventBatcher::new();

        // Create payload with 80+ commands (matching production crash scenario)
        let commands: Vec<AvailableCommand> = (0..80)
            .map(|i| AvailableCommand {
                name: format!("command-{}", i),
                description: "A".repeat(200), // ~200 chars each
                input: None,
            })
            .collect();

        let update = SessionUpdate::AvailableCommandsUpdate {
            update: AvailableCommandsData {
                available_commands: commands,
            },
            session_id: Some("test".to_string()),
        };

        // Process through batcher - should not panic
        let _ = batcher.process("test", update);
        let _ = batcher.flush_all();
    }
}
