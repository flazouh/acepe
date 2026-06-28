//! Streaming accumulator for tool input deltas.
//!
//! Accumulates streaming_input_delta chunks per tool call, parses partial JSON,
//! and provides normalized data (todos, questions) for progressive UI display.
//!
//! Follows the TaskReconciler pattern: per-session state with DashMap for
//! concurrent access.

mod plan_streaming;
mod tool_streaming;

use dashmap::DashMap;
use std::sync::LazyLock;

pub use plan_streaming::PlanStreamingState;
pub use tool_streaming::{SessionStreamingState, StreamingNormalized, ToolStreamingDeltaResult};

use crate::acp::parsers::AgentType;
use crate::acp::session_update::PlanData;

/// Maximum accumulated size per tool call (1MB) to prevent DoS.
pub(crate) const MAX_ACCUMULATED_SIZE: usize = 1_048_576;

/// Throttle interval for emissions (150ms matches frontend batching).
pub(crate) const THROTTLE_MS: u64 = 150;

/// Owns per-session tool, plan, and codex-plan streaming state behind lifecycle verbs.
///
/// Production uses a process-scoped singleton (`streaming_state_registry`). Tests may
/// construct fresh instances directly (U4) or call `reset_for_test` on the singleton.
#[derive(Default)]
pub struct StreamingStateRegistry {
    pub(crate) session_tool_states: DashMap<String, SessionStreamingState>,
    pub(crate) plan_streaming_states: DashMap<String, PlanStreamingState>,
    pub(crate) codex_plan_states: DashMap<String, plan_streaming::CodexPlanTagState>,
}

impl StreamingStateRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Clear all session-keyed maps for test isolation.
    #[cfg(test)]
    pub fn reset_for_test(&self) {
        self.session_tool_states.clear();
        self.plan_streaming_states.clear();
        self.codex_plan_states.clear();
    }

    /// Apply a streaming delta and optionally finalize on terminal status.
    ///
    /// All `RefMut` borrows are scoped before `finalize_tool` so concurrent delta +
    /// terminal updates cannot deadlock on the same session shard.
    pub fn apply_tool_streaming_delta(
        &self,
        session_id: &str,
        tool_call_id: &str,
        tool_name: &str,
        delta: &str,
        agent: AgentType,
        is_terminal: bool,
    ) -> ToolStreamingDeltaResult {
        let (normalized, plan) = {
            let normalized =
                self.accumulate_tool_delta(session_id, tool_call_id, tool_name, delta, agent);
            let effective_tool_name = normalized
                .as_ref()
                .and_then(|n| n.effective_tool_name.as_deref())
                .unwrap_or(tool_name);
            let plan = self.process_plan_streaming(
                session_id,
                tool_call_id,
                effective_tool_name,
                delta,
                agent,
            );
            (normalized, plan)
        };

        let streaming_plan = if is_terminal {
            self.finalize_tool(session_id, tool_call_id);
            self.finalize_plan_streaming_for_tool(session_id, tool_call_id)
                .or(plan)
        } else {
            plan
        };

        ToolStreamingDeltaResult {
            normalized,
            streaming_plan,
        }
    }

    /// Remove all streaming state families for a session.
    pub fn remove_session(&self, session_id: &str) {
        self.session_tool_states.remove(session_id);
        self.plan_streaming_states.remove(session_id);
        self.codex_plan_states.remove(session_id);
    }
}

/// Process-scoped streaming state registry (single LazyLock fallback per plan 012 U2).
static STREAMING_STATE_REGISTRY: LazyLock<StreamingStateRegistry> =
    LazyLock::new(StreamingStateRegistry::new);

/// Access the process-scoped streaming state registry.
pub fn streaming_state_registry() -> &'static StreamingStateRegistry {
    &STREAMING_STATE_REGISTRY
}

/// Serializes streaming tests against each other: the registry above is a single
/// process-global singleton, and `reset_for_test()` clears ALL sessions, so two
/// streaming tests running concurrently would wipe each other's seeded state.
#[cfg(test)]
static STREAMING_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Reset the process-scoped registry and return a guard that holds the
/// streaming-test serialization lock for the rest of the calling test. Bind it
/// (`let _guard = reset_streaming_state_for_test();`) so the lock is held until
/// the test's assertions complete. Poison-tolerant so one failing streaming test
/// does not cascade-fail the rest.
#[cfg(test)]
#[must_use = "bind the returned guard so the streaming-test lock is held for the test's duration"]
pub fn reset_streaming_state_for_test() -> std::sync::MutexGuard<'static, ()> {
    let guard = STREAMING_TEST_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    streaming_state_registry().reset_for_test();
    guard
}

/// Cache tool name from initial tool_call event for use during streaming deltas.
/// Call this when the initial tool_call arrives; read by subsequent accumulate_delta calls.
pub fn seed_tool_name(session_id: &str, tool_call_id: &str, tool_name: &str, agent: AgentType) {
    streaming_state_registry().seed_tool_name(session_id, tool_call_id, tool_name, agent);
}

#[cfg(test)]
pub fn is_plan_file_path(path: &str) -> bool {
    let agent = crate::acp::agent_context::current_agent()
        .expect("Missing agent context for plan file path detection");
    plan_streaming::is_plan_file_path_for_agent(path, agent)
}

/// Accumulate plan content from a streaming delta.
///
/// Returns Some(PlanData) if:
/// - This is the first content (to open sidebar immediately)
/// - OR throttle interval has passed
///
/// The returned PlanData has streaming=true.
pub fn accumulate_plan_content(
    session_id: &str,
    tool_call_id: &str,
    file_path: &str,
    content_delta: &str,
    agent: AgentType,
) -> Option<PlanData> {
    streaming_state_registry().accumulate_plan_content(
        session_id,
        tool_call_id,
        file_path,
        content_delta,
        agent,
    )
}

/// Finalize plan streaming for a session.
///
/// Returns the final PlanData with streaming=false, and removes the streaming state.
pub fn finalize_plan_streaming(session_id: &str) -> Option<PlanData> {
    streaming_state_registry().finalize_plan_streaming(session_id)
}

/// Check if a session has active plan streaming.
pub fn has_plan_streaming(session_id: &str) -> bool {
    streaming_state_registry().has_plan_streaming(session_id)
}

/// Get the tool call ID for active plan streaming.
pub fn get_plan_streaming_tool_id(session_id: &str) -> Option<String> {
    streaming_state_registry().get_plan_streaming_tool_id(session_id)
}

/// Process streaming delta for plan file detection.
///
/// Parses the delta as partial JSON, checks if it's an Edit/Write tool writing
/// to a plan file, and accumulates the content.
///
/// Returns `Some(PlanData)` if a plan event should be emitted.
pub fn process_plan_streaming(
    session_id: &str,
    tool_call_id: &str,
    tool_name: &str,
    streaming_delta: &str,
    agent: AgentType,
) -> Option<PlanData> {
    streaming_state_registry().process_plan_streaming(
        session_id,
        tool_call_id,
        tool_name,
        streaming_delta,
        agent,
    )
}

/// Finalize plan streaming when a tool call completes.
///
/// Should be called when Edit/Write tool status becomes Completed/Failed.
pub fn finalize_plan_streaming_for_tool(session_id: &str, tool_call_id: &str) -> Option<PlanData> {
    streaming_state_registry().finalize_plan_streaming_for_tool(session_id, tool_call_id)
}

/// Process Codex assistant text chunk for `<proposed_plan>` wrapper blocks.
///
/// Returns `Some(PlanData)` when a plan should be emitted:
/// - Start of capture (open tag detected): streaming=true
/// - Throttled updates while capturing: streaming=true
/// - Close tag detected: streaming=false
pub fn process_codex_plan_chunk(session_id: &str, text_delta: &str) -> Option<PlanData> {
    streaming_state_registry().process_codex_plan_chunk(session_id, text_delta)
}

/// Finalize a Codex wrapper-captured plan at turn end.
///
/// If the stream ended without a close tag, this emits the captured partial plan
/// with `streaming=false` and keeps `has_plan=true`.
pub fn finalize_codex_plan_streaming(session_id: &str) -> Option<PlanData> {
    streaming_state_registry().finalize_codex_plan_streaming(session_id)
}

/// Finalize and clear Codex wrapper parser state at turn end.
pub fn finalize_codex_plan_turn(session_id: &str) -> Option<PlanData> {
    streaming_state_registry().finalize_codex_plan_turn(session_id)
}

/// Remove Codex wrapper parser state for a session.
pub fn cleanup_codex_plan_streaming(session_id: &str) {
    streaming_state_registry().cleanup_codex_plan_streaming(session_id);
}

#[cfg(test)]
pub fn has_tool_state(session_id: &str, tool_call_id: &str) -> bool {
    streaming_state_registry().has_tool_state(session_id, tool_call_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::session_update::{PlanConfidence, PlanSource, ToolArguments};

    fn assert_is_lazy_lock<T>(_: &std::sync::LazyLock<T>) {}

    #[test]
    fn process_scoped_registry_uses_single_lazy_lock() {
        assert_is_lazy_lock(&STREAMING_STATE_REGISTRY);
    }

    #[test]
    fn test_accumulate_basic() {
        let state = SessionStreamingState::new();

        // First delta - empty string does not parse
        let result = state.accumulate_delta("tool1", "TodoWrite", "", AgentType::ClaudeCode);
        assert!(result.is_none());

        // Wait and add full valid todo JSON
        std::thread::sleep(std::time::Duration::from_millis(160));
        let result = state.accumulate_delta(
            "tool1",
            "TodoWrite",
            r#"{"todos": [{"content": "test", "status": "pending", "activeForm": "Testing"}]}"#,
            AgentType::ClaudeCode,
        );
        // Should have result with valid normalized todos and streaming_arguments
        assert!(result.is_some());
        let normalized = result.unwrap();
        assert!(normalized.todos.is_some());
        let todos = normalized.todos.unwrap();
        assert_eq!(todos.len(), 1);
        assert_eq!(todos[0].content, "test");
        assert!(normalized.streaming_arguments.is_some());
    }

    #[test]
    fn test_memory_limit() {
        let state = SessionStreamingState::new();

        // Try to exceed memory limit
        let large_delta = "x".repeat(MAX_ACCUMULATED_SIZE + 1);
        let result =
            state.accumulate_delta("tool1", "TodoWrite", &large_delta, AgentType::ClaudeCode);

        // Should not crash, returns None (no cached value yet)
        assert!(result.is_none());
    }

    #[test]
    fn test_clear_tool() {
        let state = SessionStreamingState::new();

        state.accumulate_delta(
            "tool1",
            "TodoWrite",
            r#"{"todos": []}"#,
            AgentType::ClaudeCode,
        );
        assert!(state.tool_states.contains_key("tool1"));

        state.clear_tool("tool1");
        assert!(!state.tool_states.contains_key("tool1"));
    }

    // Tool name caching tests (for streaming delta fix)

    #[test]
    fn test_cache_resolves_missing_tool_names() {
        let state = SessionStreamingState::new();

        // Seed the tool name explicitly (simulating what happens when initial tool_call arrives)
        state.seed_tool_name("tool-edit-1", "Edit", AgentType::ClaudeCode);

        // Wait for throttle
        std::thread::sleep(std::time::Duration::from_millis(160));

        // Accumulate delta with empty tool name - should look up cached name
        let result = state.accumulate_delta(
            "tool-edit-1",
            "", // No tool name provided
            r#"{"file_path": "/test.rs", "old_string": "old", "new_string": "new"}"#,
            AgentType::ClaudeCode,
        );

        // Should produce Edit-typed arguments by looking up cached name
        assert!(result.is_some());
        let normalized = result.unwrap();
        assert!(normalized.streaming_arguments.is_some());
        let args = normalized.streaming_arguments.unwrap();
        // Verify it's Edit variant, not Other
        match args {
            ToolArguments::Edit { .. } => {} // Expected
            _ => panic!("Expected Edit variant, got {:?}", args),
        }
    }

    #[test]
    fn test_without_cache_falls_back_to_other() {
        let state = SessionStreamingState::new();

        // No seed_tool_name call -- infer the best tool kind directly from payload.
        std::thread::sleep(std::time::Duration::from_millis(160));

        let result = state.accumulate_delta(
            "tool-1",
            "",
            r#"{"file_path": "/test.rs"}"#,
            AgentType::ClaudeCode,
        );

        assert!(result.is_some());
        let normalized = result.unwrap();
        assert!(normalized.streaming_arguments.is_some());
        // Without caching, file-path payloads still normalize as Read.
        match normalized.streaming_arguments.unwrap() {
            ToolArguments::Read { file_path, .. } => {
                assert_eq!(file_path.as_deref(), Some("/test.rs"));
            }
            other => panic!("Expected Read variant, got {:?}", other),
        }
    }

    #[test]
    fn test_seed_upgrades_previously_unknown_tool_kind() {
        let state = SessionStreamingState::new();

        // First delta arrives before tool name is known.
        std::thread::sleep(std::time::Duration::from_millis(160));
        let first = state
            .accumulate_delta(
                "tool-late-seed",
                "",
                r#"{"file_path": "/tmp/test.rs"}"#,
                AgentType::ClaudeCode,
            )
            .expect("first delta should parse");

        match first.streaming_arguments.expect("streaming args expected") {
            ToolArguments::Read { file_path, .. } => {
                assert_eq!(file_path.as_deref(), Some("/tmp/test.rs"));
            }
            other => panic!("Expected Read before seed, got {:?}", other),
        }

        // Later, initial tool_call arrives and seeds the real name.
        state.seed_tool_name("tool-late-seed", "Edit", AgentType::ClaudeCode);

        // Next emission should upgrade from Other -> Edit.
        std::thread::sleep(std::time::Duration::from_millis(160));
        let second = state
            .accumulate_delta("tool-late-seed", "", "", AgentType::ClaudeCode)
            .expect("second delta should emit");

        match second.streaming_arguments.expect("streaming args expected") {
            ToolArguments::Edit { edits } => {
                let e = edits.first().expect("edit entry");
                assert_eq!(e.file_path.as_deref(), Some("/tmp/test.rs"));
            }
            other => panic!("Expected Edit after seed, got {:?}", other),
        }
    }

    #[test]
    fn streams_sql_arguments_as_sql() {
        // Use a query that touches a non-todo table so it is not promoted to Todo kind.
        let state = SessionStreamingState::new();

        std::thread::sleep(std::time::Duration::from_millis(160));
        let normalized = state
            .accumulate_delta(
                "tool-sql-1",
                "unknown",
                r#"{"description":"Fetch active sessions","query":"SELECT id, created_at FROM sessions WHERE active = true"}"#,
                AgentType::Copilot,
            )
            .expect("sql delta should parse");

        match normalized
            .streaming_arguments
            .expect("streaming args expected")
        {
            ToolArguments::Sql { query, description } => {
                assert_eq!(
                    query.as_deref(),
                    Some("SELECT id, created_at FROM sessions WHERE active = true")
                );
                assert_eq!(description.as_deref(), Some("Fetch active sessions"));
            }
            other => panic!("Expected Sql variant, got {:?}", other),
        }
    }

    #[test]
    fn uses_canonical_todo_name_when_streaming_name_is_unknown() {
        let state = SessionStreamingState::new();

        std::thread::sleep(std::time::Duration::from_millis(160));
        let normalized = state
            .accumulate_delta(
                "tool-todo-1",
                "unknown",
                r#"{"todos":[{"content":"Ship reconciler","status":"in_progress","activeForm":"Shipping reconciler"}]}"#,
                AgentType::ClaudeCode,
            )
            .expect("todo delta should parse");

        let todos = normalized.todos.expect("todos expected");
        assert_eq!(todos.len(), 1);
        assert_eq!(normalized.effective_tool_name.as_deref(), Some("TodoWrite"));
    }

    #[test]
    fn test_multi_tool_isolation() {
        let state = SessionStreamingState::new();

        // Two tool calls in same session - seed the names
        state.seed_tool_name("tool-write", "Write", AgentType::ClaudeCode);
        state.seed_tool_name("tool-read", "Read", AgentType::ClaudeCode);

        std::thread::sleep(std::time::Duration::from_millis(160));

        // Write tool with empty tool_name (uses seeded name)
        let write_result = state.accumulate_delta(
            "tool-write",
            "",
            r#"{"file_path": "/file.rs", "content": "data"}"#,
            AgentType::ClaudeCode,
        );

        // Read tool with empty tool_name (uses seeded name)
        let read_result = state.accumulate_delta(
            "tool-read",
            "",
            r#"{"file_path": "/file.rs"}"#,
            AgentType::ClaudeCode,
        );

        // Each should resolve to correct type based on seeded name
        assert!(write_result.is_some());
        match write_result.unwrap().streaming_arguments.unwrap() {
            ToolArguments::Edit { .. } => {} // Write produces Edit
            other => panic!("Write tool should be Edit, got {:?}", other),
        }

        assert!(read_result.is_some());
        match read_result.unwrap().streaming_arguments.unwrap() {
            ToolArguments::Read { .. } => {} // Read produces Read
            other => panic!("Read tool should be Read, got {:?}", other),
        }
    }

    #[test]
    fn test_cleanup_removes_cached_name() {
        let state = SessionStreamingState::new();

        state.seed_tool_name("tool-1", "Edit", AgentType::ClaudeCode);
        assert!(state.tool_states.contains_key("tool-1"));

        state.clear_tool("tool-1");
        assert!(!state.tool_states.contains_key("tool-1"));
    }

    // Plan streaming tests

    #[test]
    fn test_is_plan_file_path() {
        // Claude Code patterns
        assert!(plan_streaming::is_plan_file_path_for_agent(
            "/home/user/.claude/plans/my-plan.md",
            AgentType::ClaudeCode
        ));
        assert!(plan_streaming::is_plan_file_path_for_agent(
            "/Users/example/.claude/plans/test.md",
            AgentType::ClaudeCode
        ));

        // Cursor patterns
        assert!(plan_streaming::is_plan_file_path_for_agent(
            "/home/user/.cursor/plans/my-plan_123.plan.md",
            AgentType::Cursor
        ));
        assert!(plan_streaming::is_plan_file_path_for_agent(
            "/Users/example/.cursor/plans/test_abc.plan.md",
            AgentType::Cursor
        ));

        // Non-plan files
        assert!(!plan_streaming::is_plan_file_path_for_agent(
            "/home/user/code/README.md",
            AgentType::ClaudeCode
        ));
        assert!(!plan_streaming::is_plan_file_path_for_agent(
            "/home/user/.claude/projects/file.md",
            AgentType::ClaudeCode
        ));
        assert!(!plan_streaming::is_plan_file_path_for_agent(
            "/home/user/.claude/plans/file.txt",
            AgentType::ClaudeCode
        ));
        assert!(!plan_streaming::is_plan_file_path_for_agent(
            "/home/user/.cursor/plans/file.md",
            AgentType::Cursor
        ));
        assert!(!plan_streaming::is_plan_file_path_for_agent(
            "/home/user/.cursor/plans/file.plan.txt",
            AgentType::Cursor
        ));
    }

    #[test]
    fn test_is_plan_file_path_respects_agent_context() {
        use crate::acp::agent_context::with_agent;

        with_agent(AgentType::ClaudeCode, || {
            assert!(is_plan_file_path("/home/user/.claude/plans/a.md"));
            assert!(!is_plan_file_path("/home/user/.cursor/plans/a.plan.md"));
        });

        with_agent(AgentType::Cursor, || {
            assert!(is_plan_file_path("/home/user/.cursor/plans/a.plan.md"));
            assert!(!is_plan_file_path("/home/user/.claude/plans/a.md"));
        });
    }

    #[test]
    fn test_accumulate_plan_content() {
        // Use unique session ID to avoid interference from other tests
        let session_id = format!(
            "test-plan-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );

        let result = accumulate_plan_content(
            &session_id,
            "tool-1",
            "/home/user/.claude/plans/test.md",
            "# My Plan\n\nStep 1",
            AgentType::ClaudeCode,
        );

        // First call should emit (no throttle yet, Instant::now() elapsed > 0)
        assert!(result.is_some());
        let plan = result.unwrap();
        assert!(plan.streaming);
        assert_eq!(plan.content, Some("# My Plan\n\nStep 1".to_string()));
        assert_eq!(plan.title, Some("My Plan".to_string()));
        assert_eq!(
            plan.file_path,
            Some("/home/user/.claude/plans/test.md".to_string())
        );

        // Clean up
        finalize_plan_streaming(&session_id);
    }

    #[test]
    fn test_finalize_plan_streaming() {
        let session_id = format!(
            "test-finalize-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );

        // Start streaming
        accumulate_plan_content(
            &session_id,
            "tool-2",
            "/path/plan.md",
            "# Test\n\ncontent",
            AgentType::ClaudeCode,
        );

        assert!(has_plan_streaming(&session_id));

        // Finalize
        let result = finalize_plan_streaming(&session_id);
        assert!(result.is_some());
        let plan = result.unwrap();
        assert!(!plan.streaming); // streaming = false after finalize
        assert_eq!(plan.content, Some("# Test\n\ncontent".to_string()));

        // State should be cleaned up
        assert!(!has_plan_streaming(&session_id));
    }

    #[test]
    fn codex_plan_parser_single_chunk_open_and_close() {
        let session_id = "codex-single";
        let input = "before <proposed_plan># Plan\n\n- one\n</proposed_plan> after";
        let plan = process_codex_plan_chunk(session_id, input).expect("plan should be emitted");

        assert!(!plan.streaming);
        assert_eq!(plan.source, Some(PlanSource::Heuristic));
        assert_eq!(plan.confidence, Some(PlanConfidence::Medium));
        assert_eq!(plan.agent_id.as_deref(), Some("codex"));
        assert_eq!(plan.content.as_deref(), Some("# Plan\n\n- one\n"));

        cleanup_codex_plan_streaming(session_id);
    }

    #[test]
    fn codex_plan_parser_handles_split_tags_across_chunks() {
        let session_id = "codex-split";

        let first = process_codex_plan_chunk(session_id, "x <proposed_");
        assert!(first.is_none());

        let second = process_codex_plan_chunk(session_id, "plan># P");
        assert!(second.is_some());
        assert!(second.expect("plan").streaming);

        let third = process_codex_plan_chunk(session_id, "lan\n</proposed");
        assert!(third.is_none());

        let fourth = process_codex_plan_chunk(session_id, "_plan>");
        let final_plan = fourth.expect("final plan should be emitted");
        assert!(!final_plan.streaming);
        assert_eq!(final_plan.content.as_deref(), Some("# Plan\n"));

        cleanup_codex_plan_streaming(session_id);
    }

    #[test]
    fn codex_plan_parser_missing_close_finalizes_on_turn_end() {
        let session_id = "codex-missing-close";
        let emitted = process_codex_plan_chunk(session_id, "<proposed_plan># Partial");
        assert!(emitted.is_some());
        assert!(emitted.expect("streaming plan").streaming);

        let finalized = finalize_codex_plan_streaming(session_id).expect("finalized plan");
        assert!(!finalized.streaming);
        assert_eq!(finalized.content.as_deref(), Some("# Partial"));

        cleanup_codex_plan_streaming(session_id);
    }

    #[test]
    fn codex_plan_parser_keeps_latest_block_when_multiple_blocks_present() {
        let session_id = "codex-multiple";
        let emitted = process_codex_plan_chunk(
            session_id,
            "<proposed_plan># First</proposed_plan><proposed_plan># Second</proposed_plan>",
        )
        .expect("plan emitted");

        assert!(!emitted.streaming);
        assert_eq!(emitted.content.as_deref(), Some("# Second"));

        cleanup_codex_plan_streaming(session_id);
    }

    #[test]
    fn codex_plan_parser_handles_non_ascii_suffix_without_panicking() {
        let session_id = "codex-non-ascii";
        let text =
            "keep clarity.You’re asking the right question with a non-breaking hyphen ‑ here.";

        let first = process_codex_plan_chunk(session_id, text);
        assert!(first.is_none());

        let second = process_codex_plan_chunk(session_id, "<proposed_plan># Plan</proposed_plan>");
        let plan = second.expect("plan should be emitted");
        assert!(!plan.streaming);
        assert_eq!(plan.content.as_deref(), Some("# Plan"));

        cleanup_codex_plan_streaming(session_id);
    }

    #[test]
    fn codex_plan_turn_end_cleanup_resets_state_for_next_turn() {
        let session_id = "codex-turn-end-cleanup";
        let emitted = process_codex_plan_chunk(session_id, "<proposed_plan># Partial");
        assert!(emitted.is_some());

        let finalized = finalize_codex_plan_turn(session_id).expect("finalized plan");
        assert!(!finalized.streaming);
        assert_eq!(finalized.content.as_deref(), Some("# Partial"));

        let next_turn =
            process_codex_plan_chunk(session_id, "<proposed_plan># Fresh</proposed_plan>")
                .expect("next turn plan");
        assert!(!next_turn.streaming);
        assert_eq!(next_turn.content.as_deref(), Some("# Fresh"));

        cleanup_codex_plan_streaming(session_id);
    }

    #[test]
    fn test_extract_title_from_content() {
        assert_eq!(
            plan_streaming::extract_title_from_content("# My Plan\n\nSome content"),
            Some("My Plan".to_string())
        );
        assert_eq!(
            plan_streaming::extract_title_from_content("Some content\n# Title\nMore"),
            Some("Title".to_string())
        );
        assert_eq!(
            plan_streaming::extract_title_from_content("No heading here"),
            None
        );
    }
}
