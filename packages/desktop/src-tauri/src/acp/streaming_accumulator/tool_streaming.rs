//! Tool-call streaming delta accumulation and normalization.

use dashmap::DashMap;
use std::time::Instant;

use super::{StreamingStateRegistry, MAX_ACCUMULATED_SIZE, THROTTLE_MS};
use crate::acp::parsers::AgentType;
use crate::acp::partial_json::parse_partial_json;
use crate::acp::session_update::{QuestionItem, TodoItem, ToolArguments, ToolKind};
use crate::acp::tool_identity::{
    canonical_name_for_kind, semantic_transition, RawClassificationInput,
};

/// Per-tool-call streaming state.
pub(crate) struct ToolCallStreamState {
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

/// Resolve tool kind from wire name via the tool identity authority (streaming-transition entry).
///
/// Matches the former `providers::detect_tool_kind` input profile so cached-kind upgrades stay
/// behavior-identical while routing through [`semantic_transition`].
fn streaming_authority_kind(agent: AgentType, tool_name: &str) -> ToolKind {
    semantic_transition(
        agent,
        &RawClassificationInput {
            id: "",
            name: Some(tool_name),
            title: None,
            kind_hint: None,
            arguments: &serde_json::Value::Null,
        },
    )
    .record
    .kind
}

fn effective_streaming_tool_name(tool_name: &str, kind: ToolKind) -> String {
    let trimmed_name = tool_name.trim();
    if !trimmed_name.is_empty() && !trimmed_name.eq_ignore_ascii_case("unknown") {
        return trimmed_name.to_string();
    }

    match kind {
        ToolKind::Todo => "TodoWrite".to_string(),
        ToolKind::Question => "AskUserQuestion".to_string(),
        _ if kind != ToolKind::Unclassified => canonical_name_for_kind(kind).to_string(),
        _ => trimmed_name.to_string(),
    }
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
    pub(crate) tool_states: DashMap<String, ToolCallStreamState>,
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
        let detected_kind = streaming_authority_kind(agent, tool_name);
        if state.tool_kind.is_none()
            || matches!(
                state.tool_kind,
                Some(ToolKind::Other) | Some(ToolKind::Unclassified)
            ) && !matches!(detected_kind, ToolKind::Other | ToolKind::Unclassified)
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
            let detected_kind = streaming_authority_kind(agent, resolved_name);
            if state.tool_kind.is_none()
                || matches!(
                    state.tool_kind,
                    Some(ToolKind::Other) | Some(ToolKind::Unclassified)
                ) && !matches!(detected_kind, ToolKind::Other | ToolKind::Unclassified)
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
            .or_else(|| Some(streaming_authority_kind(agent, resolved_name)));
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
        let transition = semantic_transition(
            agent,
            &RawClassificationInput {
                id: tool_call_id,
                name: Some(tool_name),
                title: Some(tool_name),
                kind_hint: tool_kind.map(|kind| kind.as_str()),
                arguments: value,
            },
        );

        let effective_name = effective_streaming_tool_name(tool_name, transition.record.kind);

        Some(StreamingNormalized {
            todos: transition.record.normalized_todos,
            questions: transition.record.normalized_questions,
            streaming_arguments: Some(transition.projected_arguments),
            effective_tool_name: Some(effective_name),
        })
    }
}

/// Result of applying a tool streaming delta through the registry lifecycle.
#[derive(Debug, Clone, Default)]
pub struct ToolStreamingDeltaResult {
    pub normalized: Option<StreamingNormalized>,
    pub streaming_plan: Option<crate::acp::session_update::PlanData>,
}

impl StreamingStateRegistry {
    pub fn seed_tool_name(
        &self,
        session_id: &str,
        tool_call_id: &str,
        tool_name: &str,
        agent: AgentType,
    ) {
        self.session_tool_states
            .entry(session_id.to_string())
            .or_default()
            .seed_tool_name(tool_call_id, tool_name, agent);
    }

    pub fn accumulate_tool_delta(
        &self,
        session_id: &str,
        tool_call_id: &str,
        tool_name: &str,
        delta: &str,
        agent: AgentType,
    ) -> Option<StreamingNormalized> {
        self.session_tool_states
            .entry(session_id.to_string())
            .or_default()
            .accumulate_delta(tool_call_id, tool_name, delta, agent)
    }

    /// Clear per-tool streaming state. Safe under concurrent access — never holds a
    /// `RefMut` across the internal `get` that would deadlock on the same DashMap shard.
    pub fn finalize_tool(&self, session_id: &str, tool_call_id: &str) {
        if let Some(state) = self.session_tool_states.get(session_id) {
            state.clear_tool(tool_call_id);
        }
    }

    pub fn has_tool_state(&self, session_id: &str, tool_call_id: &str) -> bool {
        self.session_tool_states
            .get(session_id)
            .map(|state| state.tool_states.contains_key(tool_call_id))
            .unwrap_or(false)
    }
}
