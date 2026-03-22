use std::collections::HashMap;

/// Tracks in-flight permission requests so we can emit synthetic
/// `ToolCallUpdate(failed)` events when the user denies a permission.
///
/// Populated when a permission request is forwarded to the UI with a
/// `SyntheticToolCallHint`. Consumed when the UI responds (allow or deny).
/// Cleaned up on subprocess death or session teardown.
#[derive(Debug, Default)]
pub(crate) struct PermissionTracker {
    /// Maps JSON-RPC request ID → permission context.
    contexts: HashMap<u64, PermissionContext>,
}

/// Context needed to emit a synthetic failed tool call update on deny.
#[derive(Debug, Clone)]
pub(crate) struct PermissionContext {
    pub session_id: String,
    pub tool_call_id: String,
}

impl PermissionTracker {
    pub fn new() -> Self {
        Self::default()
    }

    /// Track a permission request that was forwarded to the UI.
    pub fn track(&mut self, request_id: u64, ctx: PermissionContext) {
        self.contexts.insert(request_id, ctx);
    }

    /// Resolve (consume) a tracked permission by request ID.
    /// Returns the context if it was tracked, removing it from the map.
    pub fn resolve(&mut self, request_id: u64) -> Option<PermissionContext> {
        self.contexts.remove(&request_id)
    }

    /// Drain all tracked permissions. Returns all contexts for cleanup emission.
    pub fn drain_all(&mut self) -> Vec<(u64, PermissionContext)> {
        self.contexts.drain().collect()
    }
}

/// Deduplicates web search tool calls by remapping permission-created IDs
/// to the canonical notification-created IDs.
///
/// When Cursor performs a web search, two events arrive with different IDs:
/// - Notification: toolCall with ID like `tool_7319769b-...`
/// - Permission: session/request_permission with toolCallId like `web_search_0`
///
/// This tracker records notification IDs keyed by (session_id, query), then
/// provides the canonical ID when the permission arrives so the synthetic
/// ToolCall uses the same ID — preventing a duplicate UI row.
///
/// Accessed exclusively from the stdout reader task.
#[derive(Debug, Default)]
pub(crate) struct WebSearchDedup {
    /// Maps (session_id, query) → [notification_tool_call_ids] (FIFO).
    /// Vec handles the edge case of parallel searches with identical queries.
    entries: HashMap<(String, String), Vec<String>>,
}

impl WebSearchDedup {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record a web search notification's tool-call ID keyed by (session_id, query).
    pub fn record(&mut self, session_id: String, query: String, tool_call_id: String) {
        self.entries
            .entry((session_id, query))
            .or_default()
            .push(tool_call_id);
    }

    /// Take the first recorded canonical ID for this (session, query).
    /// Consumes the entry (FIFO order handles parallel identical queries).
    pub fn take(&mut self, session_id: &str, query: &str) -> Option<String> {
        let key = (session_id.to_string(), query.to_string());
        let ids = self.entries.get_mut(&key)?;
        if ids.is_empty() {
            self.entries.remove(&key);
            return None;
        }
        let id = ids.remove(0);
        if ids.is_empty() {
            self.entries.remove(&key);
        }
        Some(id)
    }

    /// Drain all entries. Called on EOF / error / death-monitor cleanup.
    pub fn drain_all(&mut self) {
        self.entries.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn track_and_resolve() {
        let mut tracker = PermissionTracker::new();
        tracker.track(
            1,
            PermissionContext {
                session_id: "s1".into(),
                tool_call_id: "tc1".into(),
            },
        );

        let ctx = tracker.resolve(1);
        assert!(ctx.is_some());
        assert_eq!(ctx.unwrap().tool_call_id, "tc1");

        // Second resolve returns None
        assert!(tracker.resolve(1).is_none());
    }

    #[test]
    fn resolve_unknown_returns_none() {
        let mut tracker = PermissionTracker::new();
        assert!(tracker.resolve(42).is_none());
    }

    #[test]
    fn drain_all_empties_tracker() {
        let mut tracker = PermissionTracker::new();
        tracker.track(
            1,
            PermissionContext {
                session_id: "s1".into(),
                tool_call_id: "tc1".into(),
            },
        );
        tracker.track(
            2,
            PermissionContext {
                session_id: "s2".into(),
                tool_call_id: "tc2".into(),
            },
        );

        let drained = tracker.drain_all();
        assert_eq!(drained.len(), 2);
        assert!(tracker.resolve(1).is_none());
        assert!(tracker.resolve(2).is_none());
    }

    // --- WebSearchDedup tests ---

    #[test]
    fn web_search_dedup_record_and_take() {
        let mut dedup = WebSearchDedup::new();
        dedup.record("s1".into(), "rust lang".into(), "tool_abc".into());
        let result = dedup.take("s1", "rust lang");
        assert_eq!(result, Some("tool_abc".to_string()));
        // Second take returns None
        assert_eq!(dedup.take("s1", "rust lang"), None);
    }

    #[test]
    fn web_search_dedup_take_unknown_key_returns_none() {
        let mut dedup = WebSearchDedup::new();
        assert_eq!(dedup.take("s1", "nonexistent"), None);
    }

    #[test]
    fn web_search_dedup_fifo_ordering_for_duplicate_queries() {
        let mut dedup = WebSearchDedup::new();
        dedup.record("s1".into(), "rust".into(), "tool_first".into());
        dedup.record("s1".into(), "rust".into(), "tool_second".into());
        assert_eq!(dedup.take("s1", "rust"), Some("tool_first".to_string()));
        assert_eq!(dedup.take("s1", "rust"), Some("tool_second".to_string()));
        assert_eq!(dedup.take("s1", "rust"), None);
    }

    #[test]
    fn web_search_dedup_drain_all_empties() {
        let mut dedup = WebSearchDedup::new();
        dedup.record("s1".into(), "query1".into(), "tool_1".into());
        dedup.record("s2".into(), "query2".into(), "tool_2".into());
        dedup.drain_all();
        assert_eq!(dedup.take("s1", "query1"), None);
        assert_eq!(dedup.take("s2", "query2"), None);
    }

    #[test]
    fn web_search_dedup_different_sessions_independent() {
        let mut dedup = WebSearchDedup::new();
        dedup.record("session_a".into(), "query".into(), "tool_A".into());
        dedup.record("session_b".into(), "query".into(), "tool_B".into());
        assert_eq!(dedup.take("session_a", "query"), Some("tool_A".to_string()));
        assert_eq!(dedup.take("session_b", "query"), Some("tool_B".to_string()));
    }
}
