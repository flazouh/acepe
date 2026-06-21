//! Plan content streaming from Edit/Write tools and Codex wrapper tags.

use std::time::Instant;

use super::{StreamingStateRegistry, MAX_ACCUMULATED_SIZE, THROTTLE_MS};
use crate::acp::parsers::AgentType;
use crate::acp::partial_json::parse_partial_json;
use crate::acp::session_update::{PlanConfidence, PlanData, PlanSource};

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

/// Codex Plan Mode wrapper tags.
const CODEX_PLAN_OPEN_TAG: &str = "<proposed_plan>";
const CODEX_PLAN_CLOSE_TAG: &str = "</proposed_plan>";

/// Per-session Codex wrapper parsing state.
#[derive(Debug)]
pub(crate) struct CodexPlanTagState {
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

pub(crate) fn floor_char_boundary(s: &str, idx: usize) -> usize {
    if idx >= s.len() {
        return s.len();
    }

    let mut boundary = idx;
    while boundary > 0 && !s.is_char_boundary(boundary) {
        boundary -= 1;
    }
    boundary
}

/// Check if a file path is a plan file for a specific agent.
pub(crate) fn is_plan_file_path_for_agent(path: &str, agent: AgentType) -> bool {
    match agent.plan_file_patterns() {
        Some((dir_pattern, ext_pattern)) => {
            path.contains(dir_pattern) && path.ends_with(ext_pattern)
        }
        None => false,
    }
}

/// Build PlanData from streaming state reference.
pub(crate) fn build_plan_data(
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
pub(crate) fn build_plan_data_from_owned(state: PlanStreamingState, streaming: bool) -> PlanData {
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
pub(crate) fn extract_title_from_content(content: &str) -> Option<String> {
    content
        .lines()
        .find(|line| line.starts_with("# "))
        .map(|line| line.trim_start_matches("# ").to_string())
}

pub(crate) fn build_codex_plan_data(
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

impl StreamingStateRegistry {
    pub fn accumulate_plan_content(
        &self,
        session_id: &str,
        tool_call_id: &str,
        file_path: &str,
        content_delta: &str,
        agent: AgentType,
    ) -> Option<PlanData> {
        let is_first = !self.plan_streaming_states.contains_key(session_id);

        let mut state = self
            .plan_streaming_states
            .entry(session_id.to_string())
            .or_insert_with(|| PlanStreamingState {
                tool_call_id: tool_call_id.to_string(),
                file_path: file_path.to_string(),
                accumulated_content: String::with_capacity(10_240),
                agent_type: agent,
                last_emission: Instant::now(),
            });

        if state.accumulated_content.len() + content_delta.len() > MAX_ACCUMULATED_SIZE {
            return Some(build_plan_data(&state, true));
        }

        state.accumulated_content.push_str(content_delta);

        if is_first {
            state.last_emission = Instant::now();
            return Some(build_plan_data(&state, true));
        }

        if state.last_emission.elapsed().as_millis() < THROTTLE_MS as u128 {
            return None;
        }

        state.last_emission = Instant::now();
        Some(build_plan_data(&state, true))
    }

    pub fn finalize_plan_streaming(&self, session_id: &str) -> Option<PlanData> {
        self.plan_streaming_states
            .remove(session_id)
            .map(|(_, state)| build_plan_data_from_owned(state, false))
    }

    pub fn has_plan_streaming(&self, session_id: &str) -> bool {
        self.plan_streaming_states.contains_key(session_id)
    }

    pub fn get_plan_streaming_tool_id(&self, session_id: &str) -> Option<String> {
        self.plan_streaming_states
            .get(session_id)
            .map(|state| state.tool_call_id.clone())
    }

    pub fn process_plan_streaming(
        &self,
        session_id: &str,
        tool_call_id: &str,
        tool_name: &str,
        streaming_delta: &str,
        agent: AgentType,
    ) -> Option<PlanData> {
        if !(tool_name.eq_ignore_ascii_case("write") || tool_name.eq_ignore_ascii_case("edit")) {
            return None;
        }

        let parsed = parse_partial_json(streaming_delta)?;

        let file_path = parsed
            .get("file_path")
            .or_else(|| parsed.get("filePath"))
            .and_then(|v| v.as_str())?;

        if !is_plan_file_path_for_agent(file_path, agent) {
            return None;
        }

        let content = parsed
            .get("new_string")
            .or_else(|| parsed.get("newString"))
            .or_else(|| parsed.get("content"))
            .and_then(|v| v.as_str())
            .unwrap_or("");

        self.accumulate_plan_content(session_id, tool_call_id, file_path, content, agent)
    }

    pub fn finalize_plan_streaming_for_tool(
        &self,
        session_id: &str,
        tool_call_id: &str,
    ) -> Option<PlanData> {
        if let Some(current_tool_id) = self.get_plan_streaming_tool_id(session_id) {
            if current_tool_id == tool_call_id {
                return self.finalize_plan_streaming(session_id);
            }
        }
        None
    }

    pub fn process_codex_plan_chunk(&self, session_id: &str, text_delta: &str) -> Option<PlanData> {
        if text_delta.is_empty() {
            return None;
        }

        let mut state = self
            .codex_plan_states
            .entry(session_id.to_string())
            .or_default();

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

    pub fn finalize_codex_plan_streaming(&self, session_id: &str) -> Option<PlanData> {
        let mut state = self.codex_plan_states.get_mut(session_id)?;

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

    pub fn finalize_codex_plan_turn(&self, session_id: &str) -> Option<PlanData> {
        let plan = self.finalize_codex_plan_streaming(session_id);
        self.cleanup_codex_plan_streaming(session_id);
        plan
    }

    pub fn cleanup_codex_plan_streaming(&self, session_id: &str) {
        self.codex_plan_states.remove(session_id);
    }
}
