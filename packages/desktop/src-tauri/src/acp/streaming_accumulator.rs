//! Streaming accumulator for tool input deltas.
//!
//! Accumulates streaming_input_delta chunks per tool call, parses partial JSON,
//! and provides normalized data (todos, questions) for progressive UI display.
//!
//! Follows the TaskReconciler pattern: per-session state with DashMap for
//! concurrent access.

use dashmap::DashMap;
use std::sync::LazyLock;
use std::time::Instant;

use super::partial_json::parse_partial_json;
use super::session_update::{
    parse_normalized_questions, parse_normalized_todos, PlanConfidence, PlanData, PlanSource,
    QuestionItem, TodoItem, ToolArguments, ToolKind,
};
use super::tool_classification::{classify_raw_tool_call, ToolClassificationHints};
use crate::acp::parsers::{get_parser, AgentType};

/// Maximum accumulated size per tool call (1MB) to prevent DoS.
const MAX_ACCUMULATED_SIZE: usize = 1_048_576;

/// Throttle interval for emissions (150ms matches frontend batching).
const THROTTLE_MS: u64 = 150;

/// Per-tool-call streaming state.
struct ToolCallStreamState {
    /// Accumulated delta string.
    accumulated: String,
    /// Last successfully parsed JSON value.
    last_parsed: Option<serde_json::Value>,
    /// Last time we emitted an update.
    last_emission: Instant,
    /// Cached tool kind from first delta (agent-agnostic).
    tool_kind: Option<ToolKind>,
    /// Cached tool name from initial tool_call event (for use when deltas have "unknown").
    tool_name: Option<String>,
}

impl Default for ToolCallStreamState {
    fn default() -> Self {
        Self {
            accumulated: String::with_capacity(10_240), // Pre-allocate 10KB
            last_parsed: None,
            // Start in the past to allow immediate first emission
            last_emission: Instant::now() - std::time::Duration::from_millis(THROTTLE_MS + 1),
            tool_kind: None,
            tool_name: None,
        }
    }
}

/// Result of accumulating a delta.
#[derive(Debug, Clone, Default)]
pub struct StreamingNormalized {
    /// Normalized todos if this is a TodoWrite tool.
    pub todos: Option<Vec<TodoItem>>,
    /// Normalized questions if this is an AskUserQuestion tool.
    pub questions: Option<Vec<QuestionItem>>,
    /// Typed tool arguments for progressive UI (all tool kinds).
    pub streaming_arguments: Option<ToolArguments>,
    /// Resolved tool name (cached name when incoming is "unknown").
    pub effective_tool_name: Option<String>,
}

/// Per-session streaming state, following TaskReconciler pattern.
#[derive(Default)]
pub struct SessionStreamingState {
    /// Tool call ID → streaming state.
    tool_states: DashMap<String, ToolCallStreamState>,
}

impl SessionStreamingState {
    /// Create a new session streaming state.
    pub fn new() -> Self {
        Self::default()
    }

    /// Cache tool name from initial tool_call event for use during streaming deltas.
    /// Called once when the tool_call arrives; read by subsequent accumulate_delta calls.
    pub fn seed_tool_name(&self, tool_call_id: &str, tool_name: &str, agent: AgentType) {
        if tool_name == "unknown" || tool_name.is_empty() {
            return;
        }
        let mut state = self
            .tool_states
            .entry(tool_call_id.to_string())
            .or_default();
        if state.tool_name.is_none() || state.tool_name.as_deref() == Some("other") {
            state.tool_name = Some(tool_name.to_string());
        }

        // Also pre-cache tool_kind for consistency.
        // If we've already guessed `Other`, allow upgrading to a specific kind once known.
        let detected_kind = get_parser(agent).detect_tool_kind(tool_name);
        if state.tool_kind.is_none()
            || matches!(state.tool_kind, Some(ToolKind::Other))
                && !matches!(detected_kind, ToolKind::Other)
        {
            state.tool_kind = Some(detected_kind);
        }
    }

    /// Accumulate a delta for a tool call.
    ///
    /// Resolves tool name by looking it up from cache when not provided.
    ///
    /// Returns normalized data if:
    /// 1. Throttle interval has passed
    /// 2. JSON was successfully parsed
    /// 3. Tool name matches a normalizable type (TodoWrite, AskUserQuestion)
    pub fn accumulate_delta(
        &self,
        tool_call_id: &str,
        tool_name: &str,
        delta: &str,
        agent: AgentType,
    ) -> Option<StreamingNormalized> {
        let mut state = self
            .tool_states
            .entry(tool_call_id.to_string())
            .or_default();

        // Enforce memory limit
        if state.accumulated.len() + delta.len() > MAX_ACCUMULATED_SIZE {
            // At limit, return last known good value
            return self.normalize_from_cached(&state, tool_call_id, agent);
        }

        state.accumulated.push_str(delta);

        // Throttle emissions to avoid overwhelming the frontend
        if state.last_emission.elapsed().as_millis() < THROTTLE_MS as u128 {
            return None;
        }

        // Parse and cache
        if let Some(parsed) = parse_partial_json(&state.accumulated) {
            state.last_parsed = Some(parsed.clone());
            state.last_emission = Instant::now();

            // Resolve tool name: use provided or fall back to cached
            let resolved_name_owned = if !tool_name.is_empty() {
                tool_name.to_string()
            } else {
                state
                    .tool_name
                    .clone()
                    .unwrap_or_else(|| "other".to_string())
            };
            let resolved_name = resolved_name_owned.as_str();

            // Cache tool kind from the resolved name.
            // If we previously cached `Other`, allow upgrade when resolved_name becomes specific.
            let detected_kind = get_parser(agent).detect_tool_kind(resolved_name);
            if state.tool_kind.is_none()
                || matches!(state.tool_kind, Some(ToolKind::Other))
                    && !matches!(detected_kind, ToolKind::Other)
            {
                state.tool_kind = Some(detected_kind);
            }
            return self.normalize_value(
                tool_call_id,
                &parsed,
                state.tool_kind,
                resolved_name,
                agent,
            );
        }

        None
    }

    /// Clear state for a completed tool call.
    pub fn clear_tool(&self, tool_call_id: &str) {
        self.tool_states.remove(tool_call_id);
    }

    /// Normalize from cached parsed value.
    fn normalize_from_cached(
        &self,
        state: &dashmap::mapref::one::RefMut<String, ToolCallStreamState>,
        tool_call_id: &str,
        agent: AgentType,
    ) -> Option<StreamingNormalized> {
        // Use cached tool name if available, otherwise fall back to "other"
        let resolved_name = state.tool_name.as_deref().unwrap_or("other");
        let tool_kind = state
            .tool_kind
            .or_else(|| Some(get_parser(agent).detect_tool_kind(resolved_name)));
        state.last_parsed.as_ref().and_then(|value| {
            self.normalize_value(tool_call_id, value, tool_kind, resolved_name, agent)
        })
    }

    /// Normalize a parsed JSON value. Produces streaming_arguments for all tool kinds.
    fn normalize_value(
        &self,
        tool_call_id: &str,
        value: &serde_json::Value,
        tool_kind: Option<ToolKind>,
        tool_name: &str,
        agent: AgentType,
    ) -> Option<StreamingNormalized> {
        let parser = get_parser(agent);
        let classified = classify_raw_tool_call(
            parser,
            tool_call_id,
            value,
            ToolClassificationHints {
                name: Some(tool_name),
                title: Some(tool_name),
                kind: tool_kind,
                kind_hint: tool_kind.map(|kind| kind.as_str()),
                locations: None,
            },
        );

        // Optional todos/questions for TodoWrite/AskUserQuestion
        let todos = parse_normalized_todos(&classified.name, value, agent);
        let questions = parse_normalized_questions(&classified.name, value, agent);

        Some(StreamingNormalized {
            todos,
            questions,
            streaming_arguments: Some(classified.arguments),
            effective_tool_name: Some(classified.name),
        })
    }
}

/// Global session streaming states, keyed by session ID.
static SESSION_STREAMING_STATES: LazyLock<DashMap<String, SessionStreamingState>> =
    LazyLock::new(DashMap::new);

/// Get or create streaming state for a session.
pub fn get_session_streaming_state(
    session_id: &str,
) -> dashmap::mapref::one::Ref<'_, String, SessionStreamingState> {
    SESSION_STREAMING_STATES
        .entry(session_id.to_string())
        .or_default()
        .downgrade()
}

/// Get mutable streaming state for a session.
pub fn get_session_streaming_state_mut(
    session_id: &str,
) -> dashmap::mapref::one::RefMut<'_, String, SessionStreamingState> {
    SESSION_STREAMING_STATES
        .entry(session_id.to_string())
        .or_default()
}

/// Clean up streaming state for a session.
///
/// Call this when a session ends to prevent memory leaks.
pub fn cleanup_session_streaming(session_id: &str) {
    SESSION_STREAMING_STATES.remove(session_id);
    PLAN_STREAMING_STATES.remove(session_id);
    CODEX_PLAN_STATES.remove(session_id);
}

/// Clean up streaming state for a specific tool call.
///
/// Call this when a tool call completes.
pub fn cleanup_tool_streaming(session_id: &str, tool_call_id: &str) {
    if let Some(state) = SESSION_STREAMING_STATES.get(session_id) {
        state.clear_tool(tool_call_id);
    }
}

/// Cache tool name from initial tool_call event for use during streaming deltas.
/// Call this when the initial tool_call arrives; read by subsequent accumulate_delta calls.
pub fn seed_tool_name(session_id: &str, tool_call_id: &str, tool_name: &str, agent: AgentType) {
    get_session_streaming_state_mut(session_id).seed_tool_name(tool_call_id, tool_name, agent);
}

// ============================================================================
// Plan Streaming
// ============================================================================
//
// Streams plan content from Edit/Write tool calls to plan files.
// Detection is agent-specific (Claude/Cursor/etc.) while this accumulator remains generic.

/// Per-session plan streaming state.
#[derive(Debug)]
pub struct PlanStreamingState {
    /// The tool call ID that's writing the plan.
    pub tool_call_id: String,
    /// The file path being written to.
    pub file_path: String,
    /// Accumulated plan content.
    pub accumulated_content: String,
    /// Agent that owns this streaming plan.
    pub agent_type: AgentType,
    /// Last time we emitted a plan event.
    pub last_emission: Instant,
}

/// Global plan streaming states, keyed by session ID.
static PLAN_STREAMING_STATES: LazyLock<DashMap<String, PlanStreamingState>> =
    LazyLock::new(DashMap::new);

/// Codex Plan Mode wrapper tags.
const CODEX_PLAN_OPEN_TAG: &str = "<proposed_plan>";
const CODEX_PLAN_CLOSE_TAG: &str = "</proposed_plan>";

/// Per-session Codex wrapper parsing state.
#[derive(Debug)]
struct CodexPlanTagState {
    /// Rolling suffix retained across chunks for split tag matching.
    pending: String,
    /// Whether we're currently inside a <proposed_plan> block.
    capturing: bool,
    /// Captured markdown for the active/latest plan block.
    captured_content: String,
    /// Last emission instant for throttling.
    last_emission: Instant,
}

impl Default for CodexPlanTagState {
    fn default() -> Self {
        Self {
            pending: String::new(),
            capturing: false,
            captured_content: String::new(),
            last_emission: Instant::now() - std::time::Duration::from_millis(THROTTLE_MS + 1),
        }
    }
}

/// Global Codex wrapper parsing states, keyed by session ID.
static CODEX_PLAN_STATES: LazyLock<DashMap<String, CodexPlanTagState>> =
    LazyLock::new(DashMap::new);

fn floor_char_boundary(s: &str, idx: usize) -> usize {
    if idx >= s.len() {
        return s.len();
    }

    let mut boundary = idx;
    while boundary > 0 && !s.is_char_boundary(boundary) {
        boundary -= 1;
    }
    boundary
}

#[cfg(test)]
pub fn is_plan_file_path(path: &str) -> bool {
    is_plan_file_path_for_agent(
        path,
        crate::acp::agent_context::current_agent().unwrap_or(AgentType::ClaudeCode),
    )
}

/// Check if a file path is a plan file for a specific agent.
fn is_plan_file_path_for_agent(path: &str, agent: AgentType) -> bool {
    match agent.plan_file_patterns() {
        Some((dir_pattern, ext_pattern)) => {
            path.contains(dir_pattern) && path.ends_with(ext_pattern)
        }
        None => false,
    }
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
    let is_first = !PLAN_STREAMING_STATES.contains_key(session_id);

    let mut state = PLAN_STREAMING_STATES
        .entry(session_id.to_string())
        .or_insert_with(|| PlanStreamingState {
            tool_call_id: tool_call_id.to_string(),
            file_path: file_path.to_string(),
            accumulated_content: String::with_capacity(10_240),
            agent_type: agent,
            last_emission: Instant::now(),
        });

    // Enforce memory limit (1MB)
    if state.accumulated_content.len() + content_delta.len() > MAX_ACCUMULATED_SIZE {
        // At limit, emit current content
        return Some(build_plan_data(&state, true));
    }

    state.accumulated_content.push_str(content_delta);

    // Always emit on first call (to open sidebar immediately)
    if is_first {
        state.last_emission = Instant::now();
        return Some(build_plan_data(&state, true));
    }

    // Throttle subsequent emissions
    if state.last_emission.elapsed().as_millis() < THROTTLE_MS as u128 {
        return None;
    }

    state.last_emission = Instant::now();
    Some(build_plan_data(&state, true))
}

/// Finalize plan streaming for a session.
///
/// Returns the final PlanData with streaming=false, and removes the streaming state.
pub fn finalize_plan_streaming(session_id: &str) -> Option<PlanData> {
    PLAN_STREAMING_STATES
        .remove(session_id)
        .map(|(_, state)| build_plan_data_from_owned(state, false))
}

/// Check if a session has active plan streaming.
pub fn has_plan_streaming(session_id: &str) -> bool {
    PLAN_STREAMING_STATES.contains_key(session_id)
}

/// Get the tool call ID for active plan streaming.
pub fn get_plan_streaming_tool_id(session_id: &str) -> Option<String> {
    PLAN_STREAMING_STATES
        .get(session_id)
        .map(|state| state.tool_call_id.clone())
}

/// Build PlanData from streaming state reference.
fn build_plan_data(
    state: &dashmap::mapref::one::RefMut<String, PlanStreamingState>,
    streaming: bool,
) -> PlanData {
    let content = state.accumulated_content.clone();
    let title = extract_title_from_content(&content);
    PlanData {
        steps: vec![],
        current_step: None,
        has_plan: true,
        streaming,
        content: Some(content.clone()),
        content_markdown: Some(content),
        file_path: Some(state.file_path.clone()),
        title,
        source: Some(PlanSource::Deterministic),
        confidence: Some(PlanConfidence::High),
        agent_id: Some(state.agent_type.as_str().to_string()),
        updated_at: Some(chrono::Utc::now().timestamp_millis()),
    }
}

/// Build PlanData from owned streaming state.
fn build_plan_data_from_owned(state: PlanStreamingState, streaming: bool) -> PlanData {
    let title = extract_title_from_content(&state.accumulated_content);
    PlanData {
        steps: vec![],
        current_step: None,
        has_plan: true,
        streaming,
        content: Some(state.accumulated_content.clone()),
        content_markdown: Some(state.accumulated_content),
        file_path: Some(state.file_path),
        title,
        source: Some(PlanSource::Deterministic),
        confidence: Some(PlanConfidence::High),
        agent_id: Some(state.agent_type.as_str().to_string()),
        updated_at: Some(chrono::Utc::now().timestamp_millis()),
    }
}

/// Extract title from plan content (first # heading).
fn extract_title_from_content(content: &str) -> Option<String> {
    content
        .lines()
        .find(|line| line.starts_with("# "))
        .map(|line| line.trim_start_matches("# ").to_string())
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
    // Only process Edit and Write tools
    if !(tool_name.eq_ignore_ascii_case("write") || tool_name.eq_ignore_ascii_case("edit")) {
        return None;
    }

    // Parse the partial JSON to extract file_path and content
    let parsed = parse_partial_json(streaming_delta)?;

    // Get file_path - required to detect plan files
    let file_path = parsed
        .get("file_path")
        .or_else(|| parsed.get("filePath"))
        .and_then(|v| v.as_str())?;

    // Check if this is a plan file
    if !is_plan_file_path_for_agent(file_path, agent) {
        return None;
    }

    // Extract content - could be in different fields depending on Edit vs Write
    let content = parsed
        .get("new_string")
        .or_else(|| parsed.get("newString"))
        .or_else(|| parsed.get("content"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    // Accumulate and return plan data
    accumulate_plan_content(session_id, tool_call_id, file_path, content, agent)
}

/// Finalize plan streaming when a tool call completes.
///
/// Should be called when Edit/Write tool status becomes Completed/Failed.
pub fn finalize_plan_streaming_for_tool(session_id: &str, tool_call_id: &str) -> Option<PlanData> {
    // Only finalize if the tool call ID matches the one that started streaming
    if let Some(current_tool_id) = get_plan_streaming_tool_id(session_id) {
        if current_tool_id == tool_call_id {
            return finalize_plan_streaming(session_id);
        }
    }
    None
}

/// Process Codex assistant text chunk for `<proposed_plan>` wrapper blocks.
///
/// Returns `Some(PlanData)` when a plan should be emitted:
/// - Start of capture (open tag detected): streaming=true
/// - Throttled updates while capturing: streaming=true
/// - Close tag detected: streaming=false
pub fn process_codex_plan_chunk(session_id: &str, text_delta: &str) -> Option<PlanData> {
    if text_delta.is_empty() {
        return None;
    }

    let mut state = CODEX_PLAN_STATES.entry(session_id.to_string()).or_default();

    let mut buffer = String::with_capacity(state.pending.len() + text_delta.len());
    buffer.push_str(&state.pending);
    buffer.push_str(text_delta);
    state.pending.clear();

    let mut cursor = 0usize;
    let mut saw_open = false;
    let mut saw_close = false;

    while cursor < buffer.len() {
        if !state.capturing {
            if let Some(open_pos_rel) = buffer[cursor..].find(CODEX_PLAN_OPEN_TAG) {
                let open_pos = cursor + open_pos_rel;
                cursor = open_pos + CODEX_PLAN_OPEN_TAG.len();
                state.capturing = true;
                state.captured_content.clear();
                saw_open = true;
                continue;
            }

            // Keep only a split-tag suffix.
            let keep = CODEX_PLAN_OPEN_TAG
                .len()
                .saturating_sub(1)
                .min(buffer.len() - cursor);
            if keep > 0 {
                let pending_start = floor_char_boundary(&buffer, buffer.len() - keep);
                state.pending = buffer[pending_start..].to_string();
            }
            break;
        }

        if let Some(close_pos_rel) = buffer[cursor..].find(CODEX_PLAN_CLOSE_TAG) {
            let close_pos = cursor + close_pos_rel;
            if close_pos > cursor {
                state.captured_content.push_str(&buffer[cursor..close_pos]);
            }
            cursor = close_pos + CODEX_PLAN_CLOSE_TAG.len();
            state.capturing = false;
            saw_close = true;
            continue;
        }

        // No close tag in this chunk. Keep split close-tag suffix in `pending`.
        let keep = CODEX_PLAN_CLOSE_TAG.len().saturating_sub(1);
        let available = buffer.len() - cursor;
        if available > keep {
            let safe_end = floor_char_boundary(&buffer, buffer.len() - keep);
            if safe_end >= cursor {
                state.captured_content.push_str(&buffer[cursor..safe_end]);
                state.pending = buffer[safe_end..].to_string();
            } else {
                state.pending = buffer[cursor..].to_string();
            }
        } else {
            state.pending = buffer[cursor..].to_string();
        }
        break;
    }

    if saw_close {
        state.last_emission = Instant::now();
        return Some(build_codex_plan_data(&state, false));
    }

    if saw_open {
        state.last_emission = Instant::now();
        return Some(build_codex_plan_data(&state, true));
    }

    if state.capturing && state.last_emission.elapsed().as_millis() >= THROTTLE_MS as u128 {
        state.last_emission = Instant::now();
        return Some(build_codex_plan_data(&state, true));
    }

    None
}

/// Finalize a Codex wrapper-captured plan at turn end.
///
/// If the stream ended without a close tag, this emits the captured partial plan
/// with `streaming=false` and keeps `has_plan=true`.
pub fn finalize_codex_plan_streaming(session_id: &str) -> Option<PlanData> {
    let mut state = CODEX_PLAN_STATES.get_mut(session_id)?;

    if state.capturing {
        state.capturing = false;
        if !state.pending.is_empty() {
            let pending = state.pending.clone();
            state.captured_content.push_str(&pending);
        }
        state.pending.clear();
        return Some(build_codex_plan_data(&state, false));
    }

    None
}

/// Finalize and clear Codex wrapper parser state at turn end.
pub fn finalize_codex_plan_turn(session_id: &str) -> Option<PlanData> {
    let plan = finalize_codex_plan_streaming(session_id);
    cleanup_codex_plan_streaming(session_id);
    plan
}

/// Remove Codex wrapper parser state for a session.
pub fn cleanup_codex_plan_streaming(session_id: &str) {
    CODEX_PLAN_STATES.remove(session_id);
}

fn build_codex_plan_data(
    state: &dashmap::mapref::one::RefMut<String, CodexPlanTagState>,
    streaming: bool,
) -> PlanData {
    let content = state.captured_content.clone();
    let title = extract_title_from_content(&content).or_else(|| Some("Plan".to_string()));

    PlanData {
        steps: vec![],
        current_step: None,
        has_plan: true,
        streaming,
        content: Some(content.clone()),
        content_markdown: Some(content),
        file_path: None,
        title,
        source: Some(PlanSource::Heuristic),
        confidence: Some(PlanConfidence::Medium),
        agent_id: Some(AgentType::Codex.as_str().to_string()),
        updated_at: Some(chrono::Utc::now().timestamp_millis()),
    }
}

#[cfg(test)]
pub fn has_tool_state(session_id: &str, tool_call_id: &str) -> bool {
    SESSION_STREAMING_STATES
        .get(session_id)
        .map(|state| state.tool_states.contains_key(tool_call_id))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_is_lazy_lock<T>(_: &std::sync::LazyLock<T>) {}

    #[test]
    fn global_streaming_caches_use_lazy_lock() {
        assert_is_lazy_lock(&SESSION_STREAMING_STATES);
        assert_is_lazy_lock(&PLAN_STREAMING_STATES);
        assert_is_lazy_lock(&CODEX_PLAN_STATES);
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

        // No cache_tool_name call -- no cached name available
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
        // Without caching, it defaults to "other" tool kind
        match normalized.streaming_arguments.unwrap() {
            ToolArguments::Other { .. } => {} // Expected
            other => panic!("Expected Other variant, got {:?}", other),
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
            ToolArguments::Other { .. } => {} // Initial unknown classification
            other => panic!("Expected Other before seed, got {:?}", other),
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
        assert!(is_plan_file_path_for_agent(
            "/home/user/.claude/plans/my-plan.md",
            AgentType::ClaudeCode
        ));
        assert!(is_plan_file_path_for_agent(
            "/Users/example/.claude/plans/test.md",
            AgentType::ClaudeCode
        ));

        // Cursor patterns
        assert!(is_plan_file_path_for_agent(
            "/home/user/.cursor/plans/my-plan_123.plan.md",
            AgentType::Cursor
        ));
        assert!(is_plan_file_path_for_agent(
            "/Users/example/.cursor/plans/test_abc.plan.md",
            AgentType::Cursor
        ));

        // Non-plan files
        assert!(!is_plan_file_path_for_agent(
            "/home/user/code/README.md",
            AgentType::ClaudeCode
        ));
        assert!(!is_plan_file_path_for_agent(
            "/home/user/.claude/projects/file.md",
            AgentType::ClaudeCode
        ));
        assert!(!is_plan_file_path_for_agent(
            "/home/user/.claude/plans/file.txt",
            AgentType::ClaudeCode
        ));
        assert!(!is_plan_file_path_for_agent(
            "/home/user/.cursor/plans/file.md",
            AgentType::Cursor
        ));
        assert!(!is_plan_file_path_for_agent(
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
            extract_title_from_content("# My Plan\n\nSome content"),
            Some("My Plan".to_string())
        );
        assert_eq!(
            extract_title_from_content("Some content\n# Title\nMore"),
            Some("Title".to_string())
        );
        assert_eq!(extract_title_from_content("No heading here"), None);
    }
}
