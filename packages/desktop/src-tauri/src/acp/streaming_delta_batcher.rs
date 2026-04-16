//! Streaming batcher for Tauri event coalescing.
//!
//! Batches rapid streaming updates (arriving every 1-50ms) into larger batches
//! emitted every ~16ms to reduce Tauri IPC overhead and prevent frontend freezes.
//!
//! Batched event types:
//! - ToolCallUpdate with streaming_input_delta (tool input streaming)
//! - AgentMessageChunk with text content (assistant text streaming)
//! - AgentThoughtChunk with text content (thinking streaming)

use std::collections::HashMap;
use std::time::{Duration, Instant};

use crate::acp::session_update::{
    PlanData, QuestionItem, SessionUpdate, TodoItem, ToolArguments, ToolCallData,
    ToolCallUpdateData, TurnErrorData,
};
use crate::acp::types::ContentBlock;

/// Batch interval matching browser frame timing (60fps).
const BATCH_INTERVAL: Duration = Duration::from_millis(16);

/// Maximum buffer size per item (10MB) - force flush when exceeded.
/// This prevents unbounded memory growth from malicious or extremely long outputs.
const MAX_BUFFER_SIZE: usize = 10 * 1024 * 1024;

/// Maximum number of concurrent buffers.
/// Prevents unbounded HashMap growth from many simultaneous streams.
const MAX_BUFFERS: usize = 1000;

/// Initial string capacity for delta buffers (~10-20 typical deltas).
/// Pre-allocating avoids repeated reallocations during accumulation.
const INITIAL_BUFFER_CAPACITY: usize = 512;

/// Parameters for buffering a tool call streaming delta.
struct ToolDeltaParams {
    tool_call_id: String,
    session_id: Option<String>,
    delta: String,
    normalized_todos: Option<Vec<TodoItem>>,
    normalized_questions: Option<Vec<QuestionItem>>,
    streaming_plan: Option<PlanData>,
    streaming_arguments: Option<ToolArguments>,
}

/// Accumulated delta for a single tool call.
struct DeltaBuffer {
    session_id: String,
    accumulated: String,
    first_received: Instant,
    last_accessed: Instant,
    /// Latest normalized todos from streaming accumulator
    normalized_todos: Option<Vec<TodoItem>>,
    /// Latest normalized questions from streaming accumulator
    normalized_questions: Option<Vec<QuestionItem>>,
    /// Latest streaming plan data
    streaming_plan: Option<PlanData>,
    /// Latest pre-parsed streaming arguments from Rust accumulator
    streaming_arguments: Option<ToolArguments>,
}

/// Accumulated text for a message chunk stream.
struct MessageChunkBuffer {
    session_id: String,
    message_id: Option<String>,
    part_id: Option<String>,
    is_thought: bool,
    accumulated_text: String,
    first_received: Instant,
    last_accessed: Instant,
}

/// Key for message chunk buffers.
/// Combines session_id, message_id, part_id, and is_thought for uniqueness.
///
/// `part_id` must be part of the key because Claude Code can interleave
/// chunks from different parts under the same message_id. Merging those
/// streams causes garbled text (words from different parts concatenated).
#[derive(Hash, Eq, PartialEq, Clone)]
struct MessageChunkKey {
    session_id: String,
    message_id: Option<String>,
    part_id: Option<String>,
    is_thought: bool,
}

/// Batches streaming updates to reduce Tauri event frequency.
///
/// Instead of emitting every update immediately (100+ events/sec), this batcher
/// accumulates updates and emits them in batches every 16ms.
pub struct StreamingDeltaBatcher {
    /// Map of tool_call_id -> accumulated delta data
    delta_buffers: HashMap<String, DeltaBuffer>,
    /// Map of message key -> accumulated text chunk data
    message_buffers: HashMap<MessageChunkKey, MessageChunkBuffer>,
}

impl StreamingDeltaBatcher {
    pub fn new() -> Self {
        Self {
            delta_buffers: HashMap::new(),
            message_buffers: HashMap::new(),
        }
    }

    /// Process a session update, potentially batching streaming updates.
    ///
    /// Returns a Vec of updates to emit. May be empty (buffered), one (normal),
    /// or multiple (flushed buffer + current update).
    #[must_use = "updates must be emitted to the frontend"]
    pub fn process(&mut self, update: SessionUpdate) -> Vec<SessionUpdate> {
        match &update {
            // Tool call boundaries must not overtake buffered message chunks.
            // Flush pending session text first to preserve stream order in UI.
            SessionUpdate::ToolCall {
                tool_call,
                session_id: Some(session_id),
                ..
            } => {
                let mut results = self.flush_message_buffers_for_session(session_id);
                results.extend(self.flush_tool_deltas_for_call(tool_call));
                results.push(update);
                results
            }
            SessionUpdate::ToolCall { .. } => vec![update],

            // Handle tool call streaming deltas
            SessionUpdate::ToolCallUpdate {
                update: data,
                session_id,
            } => {
                if let Some(delta) = &data.streaming_input_delta {
                    let params = ToolDeltaParams {
                        tool_call_id: data.tool_call_id.clone(),
                        session_id: session_id.clone(),
                        delta: delta.clone(),
                        normalized_todos: data.normalized_todos.clone(),
                        normalized_questions: data.normalized_questions.clone(),
                        streaming_plan: data.streaming_plan.clone(),
                        streaming_arguments: data.streaming_arguments.clone(),
                    };
                    return self.buffer_tool_delta(params);
                }
                // Non-delta tool call update - flush any buffered delta first
                let mut results = Vec::new();
                if let Some(session_id) = session_id.as_deref() {
                    results.extend(self.flush_message_buffers_for_session(session_id));
                }
                if let Some(flushed) = self.flush_one_delta(&data.tool_call_id) {
                    results.push(flushed);
                }
                results.push(update);
                results
            }

            // Handle agent message chunks (text streaming)
            SessionUpdate::AgentMessageChunk {
                chunk,
                part_id,
                message_id,
                session_id,
            } => {
                if let ContentBlock::Text { text } = &chunk.content {
                    return self.buffer_message_chunk(
                        session_id.clone().unwrap_or_default(),
                        message_id.clone(),
                        part_id.clone(),
                        false, // not a thought
                        text.clone(),
                    );
                }
                // Non-text content (tool_use, etc.) - emit immediately
                vec![update]
            }

            // Handle agent thought chunks (thinking streaming)
            SessionUpdate::AgentThoughtChunk {
                chunk,
                part_id,
                message_id,
                session_id,
            } => {
                if let ContentBlock::Text { text } = &chunk.content {
                    return self.buffer_message_chunk(
                        session_id.clone().unwrap_or_default(),
                        message_id.clone(),
                        part_id.clone(),
                        true, // is a thought
                        text.clone(),
                    );
                }
                // Non-text content - emit immediately
                vec![update]
            }

            // All other updates - emit immediately
            _ => vec![update],
        }
    }

    /// Buffer a tool call streaming delta with normalized data.
    fn buffer_tool_delta(&mut self, params: ToolDeltaParams) -> Vec<SessionUpdate> {
        let now = Instant::now();
        let mut evicted = Vec::new();

        // Check if we need to evict old buffers
        if !self.delta_buffers.contains_key(&params.tool_call_id)
            && self.total_buffer_count() >= MAX_BUFFERS
        {
            evicted = self.evict_oldest_buffer();
        }

        let buffer = self
            .delta_buffers
            .entry(params.tool_call_id.clone())
            .or_insert_with(|| DeltaBuffer {
                session_id: params.session_id.clone().unwrap_or_default(),
                accumulated: String::with_capacity(INITIAL_BUFFER_CAPACITY),
                first_received: now,
                last_accessed: now,
                normalized_todos: None,
                normalized_questions: None,
                streaming_plan: None,
                streaming_arguments: None,
            });
        buffer.accumulated.push_str(&params.delta);
        buffer.last_accessed = now;

        // Update normalized data if provided (always use latest)
        if params.normalized_todos.is_some() {
            buffer.normalized_todos = params.normalized_todos;
        }
        if params.normalized_questions.is_some() {
            buffer.normalized_questions = params.normalized_questions;
        }
        if params.streaming_plan.is_some() {
            buffer.streaming_plan = params.streaming_plan;
        }
        if params.streaming_arguments.is_some() {
            buffer.streaming_arguments = params.streaming_arguments;
        }

        // Force flush if buffer too large
        if buffer.accumulated.len() >= MAX_BUFFER_SIZE {
            let mut results = evicted;
            results.extend(self.emit_tool_delta(&params.tool_call_id));
            return results;
        }

        // Emit if enough time has passed
        if now.duration_since(buffer.first_received) >= BATCH_INTERVAL {
            let mut results = evicted;
            results.extend(self.emit_tool_delta(&params.tool_call_id));
            return results;
        }

        evicted
    }

    /// Buffer a message/thought chunk.
    fn buffer_message_chunk(
        &mut self,
        session_id: String,
        message_id: Option<String>,
        part_id: Option<String>,
        is_thought: bool,
        text: String,
    ) -> Vec<SessionUpdate> {
        let now = Instant::now();
        let mut evicted = Vec::new();
        let key = MessageChunkKey {
            session_id: session_id.clone(),
            message_id: message_id.clone(),
            part_id: part_id.clone(),
            is_thought,
        };

        // Check if we need to evict old buffers
        if !self.message_buffers.contains_key(&key) && self.total_buffer_count() >= MAX_BUFFERS {
            evicted = self.evict_oldest_buffer();
        }

        let buffer =
            self.message_buffers
                .entry(key.clone())
                .or_insert_with(|| MessageChunkBuffer {
                    session_id,
                    message_id,
                    part_id: part_id.clone(),
                    is_thought,
                    accumulated_text: String::with_capacity(INITIAL_BUFFER_CAPACITY),
                    first_received: now,
                    last_accessed: now,
                });
        buffer.accumulated_text.push_str(&text);
        buffer.last_accessed = now;
        // Keep the most recent non-empty part_id for this buffer.
        // (Different part_ids now map to different buffers via MessageChunkKey.)
        if part_id.is_some() {
            buffer.part_id = part_id;
        }

        // Force flush if buffer too large
        if buffer.accumulated_text.len() >= MAX_BUFFER_SIZE {
            let mut results = evicted;
            results.extend(self.emit_message_chunk(&key));
            return results;
        }

        // Emit if enough time has passed
        if now.duration_since(buffer.first_received) >= BATCH_INTERVAL {
            let mut results = evicted;
            results.extend(self.emit_message_chunk(&key));
            return results;
        }

        evicted
    }

    /// Emit a buffered tool delta with normalized data.
    fn emit_tool_delta(&mut self, tool_call_id: &str) -> Vec<SessionUpdate> {
        if let Some(buffer) = self.delta_buffers.remove(tool_call_id) {
            if !buffer.accumulated.is_empty()
                || buffer.normalized_todos.is_some()
                || buffer.normalized_questions.is_some()
                || buffer.streaming_plan.is_some()
                || buffer.streaming_arguments.is_some()
            {
                return vec![SessionUpdate::ToolCallUpdate {
                    update: ToolCallUpdateData {
                        tool_call_id: tool_call_id.to_string(),
                        status: None,
                        result: None,
                        content: None,
                        raw_output: None,
                        title: None,
                        locations: None,
                        streaming_input_delta: if buffer.accumulated.is_empty() {
                            None
                        } else {
                            Some(buffer.accumulated)
                        },
                        normalized_todos: buffer.normalized_todos,
                        normalized_questions: buffer.normalized_questions,
                        streaming_arguments: buffer.streaming_arguments,
                        streaming_plan: buffer.streaming_plan,
                        arguments: None,
                        failure_reason: None,
                    },
                    session_id: Some(buffer.session_id),
                }];
            }
        }
        vec![]
    }

    /// Emit a buffered message chunk.
    fn emit_message_chunk(&mut self, key: &MessageChunkKey) -> Vec<SessionUpdate> {
        if let Some(buffer) = self.message_buffers.remove(key) {
            if !buffer.accumulated_text.is_empty() {
                let chunk = crate::acp::session_update::ContentChunk {
                    content: ContentBlock::Text {
                        text: buffer.accumulated_text,
                    },
                    aggregation_hint: None,
                };

                if buffer.is_thought {
                    return vec![SessionUpdate::AgentThoughtChunk {
                        chunk,
                        part_id: buffer.part_id,
                        message_id: buffer.message_id,
                        session_id: Some(buffer.session_id),
                    }];
                } else {
                    return vec![SessionUpdate::AgentMessageChunk {
                        chunk,
                        part_id: buffer.part_id,
                        message_id: buffer.message_id,
                        session_id: Some(buffer.session_id),
                    }];
                }
            }
        }
        vec![]
    }

    /// Flush a specific tool's buffer if it exists.
    fn flush_one_delta(&mut self, tool_call_id: &str) -> Option<SessionUpdate> {
        self.emit_tool_delta(tool_call_id).into_iter().next()
    }

    fn collect_tool_call_ids(tool_call: &ToolCallData, tool_call_ids: &mut Vec<String>) {
        tool_call_ids.push(tool_call.id.clone());

        if let Some(children) = &tool_call.task_children {
            for child in children {
                Self::collect_tool_call_ids(child, tool_call_ids);
            }
        }
    }

    fn flush_tool_deltas_for_call(&mut self, tool_call: &ToolCallData) -> Vec<SessionUpdate> {
        let mut tool_call_ids = Vec::new();
        Self::collect_tool_call_ids(tool_call, &mut tool_call_ids);

        let mut buffered_ids: Vec<_> = tool_call_ids
            .into_iter()
            .filter_map(|tool_call_id| {
                self.delta_buffers
                    .get(&tool_call_id)
                    .map(|buffer| (tool_call_id, buffer.first_received))
            })
            .collect();
        buffered_ids.sort_by_key(|(_, first_received)| *first_received);

        let mut results = Vec::new();
        for (tool_call_id, _) in buffered_ids {
            if let Some(flushed) = self.flush_one_delta(&tool_call_id) {
                results.push(flushed);
            }
        }

        results
    }

    /// Total number of active buffers.
    fn total_buffer_count(&self) -> usize {
        self.delta_buffers.len() + self.message_buffers.len()
    }

    /// Evict the oldest buffer (LRU eviction) when MAX_BUFFERS is reached.
    /// Returns any accumulated data so it can be emitted before the buffer is lost.
    fn evict_oldest_buffer(&mut self) -> Vec<SessionUpdate> {
        // Find oldest delta buffer
        let oldest_delta = self
            .delta_buffers
            .iter()
            .min_by_key(|(_, buf)| buf.last_accessed)
            .map(|(key, buf)| (key.clone(), buf.last_accessed));

        // Find oldest message buffer
        let oldest_message = self
            .message_buffers
            .iter()
            .min_by_key(|(_, buf)| buf.last_accessed)
            .map(|(key, buf)| (key.clone(), buf.last_accessed));

        // Evict whichever is older, emitting its data first to prevent data loss
        match (oldest_delta, oldest_message) {
            (Some((delta_key, delta_time)), Some((msg_key, msg_time))) => {
                if delta_time < msg_time {
                    tracing::warn!(tool_call_id = %delta_key, "Evicting oldest delta buffer (emitting first)");
                    self.emit_tool_delta(&delta_key)
                } else {
                    tracing::warn!("Evicting oldest message buffer (emitting first)");
                    self.emit_message_chunk(&msg_key)
                }
            }
            (Some((delta_key, _)), None) => {
                tracing::warn!(tool_call_id = %delta_key, "Evicting oldest delta buffer (emitting first)");
                self.emit_tool_delta(&delta_key)
            }
            (None, Some((msg_key, _))) => {
                tracing::warn!("Evicting oldest message buffer (emitting first)");
                self.emit_message_chunk(&msg_key)
            }
            (None, None) => vec![],
        }
    }

    /// Flush all buffered updates. Call this when you need to ensure all
    /// buffered data is emitted (e.g., before a turn_complete).
    ///
    /// Buffers are sorted by first_received timestamp to maintain consistent ordering.
    #[must_use = "flushed updates must be emitted to the frontend"]
    pub fn flush_all(&mut self) -> Vec<SessionUpdate> {
        let mut results = Vec::new();

        // Flush all delta buffers, sorted by first_received for consistent ordering
        let mut delta_buffers: Vec<_> = self.delta_buffers.drain().collect();
        delta_buffers.sort_by_key(|(_, buf)| buf.first_received);

        for (tool_call_id, buffer) in delta_buffers {
            if !buffer.accumulated.is_empty()
                || buffer.normalized_todos.is_some()
                || buffer.normalized_questions.is_some()
                || buffer.streaming_plan.is_some()
                || buffer.streaming_arguments.is_some()
            {
                results.push(SessionUpdate::ToolCallUpdate {
                    update: ToolCallUpdateData {
                        tool_call_id,
                        status: None,
                        result: None,
                        content: None,
                        raw_output: None,
                        title: None,
                        locations: None,
                        streaming_input_delta: if buffer.accumulated.is_empty() {
                            None
                        } else {
                            Some(buffer.accumulated)
                        },
                        normalized_todos: buffer.normalized_todos,
                        normalized_questions: buffer.normalized_questions,
                        streaming_arguments: buffer.streaming_arguments,
                        streaming_plan: buffer.streaming_plan,
                        arguments: None,
                        failure_reason: None,
                    },
                    session_id: Some(buffer.session_id),
                });
            }
        }

        // Flush all message buffers, sorted by first_received for consistent ordering
        let mut message_buffers: Vec<_> = self.message_buffers.drain().collect();
        message_buffers.sort_by_key(|(_, buf)| buf.first_received);

        for (_, buffer) in message_buffers {
            if !buffer.accumulated_text.is_empty() {
                let chunk = crate::acp::session_update::ContentChunk {
                    content: ContentBlock::Text {
                        text: buffer.accumulated_text,
                    },
                    aggregation_hint: None,
                };

                if buffer.is_thought {
                    results.push(SessionUpdate::AgentThoughtChunk {
                        chunk,
                        part_id: buffer.part_id,
                        message_id: buffer.message_id,
                        session_id: Some(buffer.session_id),
                    });
                } else {
                    results.push(SessionUpdate::AgentMessageChunk {
                        chunk,
                        part_id: buffer.part_id,
                        message_id: buffer.message_id,
                        session_id: Some(buffer.session_id),
                    });
                }
            }
        }

        results
    }

    /// Check if there are any buffered updates.
    pub fn has_pending(&self) -> bool {
        !self.delta_buffers.is_empty() || !self.message_buffers.is_empty()
    }

    /// Get the number of currently buffered items.
    pub fn buffer_count(&self) -> usize {
        self.total_buffer_count()
    }

    /// Flush all buffers for a specific session.
    ///
    /// Returns buffered updates for that session, sorted by first_received timestamp.
    /// Buffers for other sessions are left untouched.
    fn flush_session(&mut self, session_id: &str) -> Vec<SessionUpdate> {
        let mut results = Vec::new();

        // Collect and remove delta buffers for this session
        let delta_keys: Vec<_> = self
            .delta_buffers
            .iter()
            .filter(|(_, buf)| buf.session_id == session_id)
            .map(|(k, _)| k.clone())
            .collect();

        let mut delta_buffers: Vec<_> = delta_keys
            .into_iter()
            .filter_map(|k| self.delta_buffers.remove(&k).map(|buf| (k, buf)))
            .collect();
        delta_buffers.sort_by_key(|(_, buf)| buf.first_received);

        for (tool_call_id, buffer) in delta_buffers {
            if !buffer.accumulated.is_empty()
                || buffer.normalized_todos.is_some()
                || buffer.normalized_questions.is_some()
                || buffer.streaming_plan.is_some()
                || buffer.streaming_arguments.is_some()
            {
                results.push(SessionUpdate::ToolCallUpdate {
                    update: ToolCallUpdateData {
                        tool_call_id,
                        status: None,
                        result: None,
                        content: None,
                        raw_output: None,
                        title: None,
                        locations: None,
                        streaming_input_delta: if buffer.accumulated.is_empty() {
                            None
                        } else {
                            Some(buffer.accumulated)
                        },
                        normalized_todos: buffer.normalized_todos,
                        normalized_questions: buffer.normalized_questions,
                        streaming_arguments: buffer.streaming_arguments,
                        streaming_plan: buffer.streaming_plan,
                        arguments: None,
                        failure_reason: None,
                    },
                    session_id: Some(buffer.session_id),
                });
            }
        }

        // Collect and remove message buffers for this session
        let message_keys: Vec<_> = self
            .message_buffers
            .iter()
            .filter(|(_, buf)| buf.session_id == session_id)
            .map(|(k, _)| k.clone())
            .collect();

        let mut message_buffers: Vec<_> = message_keys
            .into_iter()
            .filter_map(|k| self.message_buffers.remove(&k).map(|buf| (k, buf)))
            .collect();
        message_buffers.sort_by_key(|(_, buf)| buf.first_received);

        for (_, buffer) in message_buffers {
            if !buffer.accumulated_text.is_empty() {
                let chunk = crate::acp::session_update::ContentChunk {
                    content: ContentBlock::Text {
                        text: buffer.accumulated_text,
                    },
                    aggregation_hint: None,
                };

                if buffer.is_thought {
                    results.push(SessionUpdate::AgentThoughtChunk {
                        chunk,
                        part_id: buffer.part_id,
                        message_id: buffer.message_id,
                        session_id: Some(buffer.session_id),
                    });
                } else {
                    results.push(SessionUpdate::AgentMessageChunk {
                        chunk,
                        part_id: buffer.part_id,
                        message_id: buffer.message_id,
                        session_id: Some(buffer.session_id),
                    });
                }
            }
        }

        results
    }

    /// Flush only message/thought buffers for a specific session.
    ///
    /// Used at tool boundaries so pre-tool narration is emitted before tool cards.
    fn flush_message_buffers_for_session(&mut self, session_id: &str) -> Vec<SessionUpdate> {
        let mut results = Vec::new();

        let message_keys: Vec<_> = self
            .message_buffers
            .iter()
            .filter(|(_, buf)| buf.session_id == session_id)
            .map(|(k, _)| k.clone())
            .collect();

        let mut message_buffers: Vec<_> = message_keys
            .into_iter()
            .filter_map(|k| self.message_buffers.remove(&k).map(|buf| (k, buf)))
            .collect();
        message_buffers.sort_by_key(|(_, buf)| buf.first_received);

        for (_, buffer) in message_buffers {
            if !buffer.accumulated_text.is_empty() {
                let chunk = crate::acp::session_update::ContentChunk {
                    content: ContentBlock::Text {
                        text: buffer.accumulated_text,
                    },
                    aggregation_hint: None,
                };

                if buffer.is_thought {
                    results.push(SessionUpdate::AgentThoughtChunk {
                        chunk,
                        part_id: buffer.part_id,
                        message_id: buffer.message_id,
                        session_id: Some(buffer.session_id),
                    });
                } else {
                    results.push(SessionUpdate::AgentMessageChunk {
                        chunk,
                        part_id: buffer.part_id,
                        message_id: buffer.message_id,
                        session_id: Some(buffer.session_id),
                    });
                }
            }
        }

        results
    }

    /// Process a turn completion for a session.
    ///
    /// Flushes all buffered updates for the session, then appends TurnComplete.
    /// This guarantees correct ordering: all streaming chunks come before TurnComplete.
    #[must_use = "updates must be emitted to the frontend"]
    pub fn process_turn_complete(
        &mut self,
        session_id: &str,
        turn_id: Option<String>,
    ) -> Vec<SessionUpdate> {
        let mut results = self.flush_session(session_id);
        results.push(SessionUpdate::TurnComplete {
            session_id: Some(session_id.to_string()),
            turn_id,
        });
        results
    }

    /// Process a turn error for a session.
    ///
    /// Flushes all buffered updates for the session, then appends TurnError.
    /// This guarantees correct ordering: all streaming chunks come before TurnError.
    #[must_use = "updates must be emitted to the frontend"]
    pub fn process_turn_error(
        &mut self,
        session_id: &str,
        turn_id: Option<String>,
        error: TurnErrorData,
    ) -> Vec<SessionUpdate> {
        let mut results = self.flush_session(session_id);
        results.push(SessionUpdate::TurnError {
            error,
            session_id: Some(session_id.to_string()),
            turn_id,
        });
        results
    }
}

impl Default for StreamingDeltaBatcher {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::session_update::ContentChunk;

    fn make_delta_update(tool_call_id: &str, delta: &str) -> SessionUpdate {
        SessionUpdate::ToolCallUpdate {
            update: ToolCallUpdateData {
                tool_call_id: tool_call_id.to_string(),
                status: None,
                result: None,
                content: None,
                raw_output: None,
                title: None,
                locations: None,
                streaming_input_delta: Some(delta.to_string()),
                normalized_todos: None,
                normalized_questions: None,
                streaming_arguments: None,
                streaming_plan: None,
                arguments: None,
                failure_reason: None,
            },
            session_id: Some("session-1".to_string()),
        }
    }

    fn make_message_chunk(text: &str) -> SessionUpdate {
        SessionUpdate::AgentMessageChunk {
            chunk: ContentChunk {
                content: ContentBlock::Text {
                    text: text.to_string(),
                },
                aggregation_hint: None,
            },
            part_id: None,
            message_id: Some("msg-1".to_string()),
            session_id: Some("session-1".to_string()),
        }
    }

    fn make_message_chunk_with_ids(
        text: &str,
        message_id: &str,
        part_id: Option<&str>,
    ) -> SessionUpdate {
        SessionUpdate::AgentMessageChunk {
            chunk: ContentChunk {
                content: ContentBlock::Text {
                    text: text.to_string(),
                },
                aggregation_hint: None,
            },
            part_id: part_id.map(std::string::ToString::to_string),
            message_id: Some(message_id.to_string()),
            session_id: Some("session-1".to_string()),
        }
    }

    fn make_thought_chunk(text: &str) -> SessionUpdate {
        SessionUpdate::AgentThoughtChunk {
            chunk: ContentChunk {
                content: ContentBlock::Text {
                    text: text.to_string(),
                },
                aggregation_hint: None,
            },
            part_id: None,
            message_id: Some("msg-1".to_string()),
            session_id: Some("session-1".to_string()),
        }
    }

    fn make_tool_call(tool_call_id: &str) -> SessionUpdate {
        SessionUpdate::ToolCall {
            tool_call: crate::acp::session_update::ToolCallData {
                id: tool_call_id.to_string(),
                name: "Execute".to_string(),
                arguments: ToolArguments::Execute {
                    command: Some("echo ok".to_string()),
                },
                raw_input: None,
                status: crate::acp::session_update::ToolCallStatus::Pending,
                result: None,
                kind: Some(crate::acp::session_update::ToolKind::Execute),
                title: Some("Run command".to_string()),
                locations: None,
                skill_meta: None,
                normalized_questions: None,
                normalized_todos: None,
                parent_tool_use_id: None,
                task_children: None,
                question_answer: None,
                awaiting_plan_approval: false,
                plan_approval_request_id: None,
            },
            session_id: Some("session-1".to_string()),
        }
    }

    fn make_parent_tool_call_with_child(parent_id: &str, child_id: &str) -> SessionUpdate {
        SessionUpdate::ToolCall {
            tool_call: crate::acp::session_update::ToolCallData {
                id: parent_id.to_string(),
                name: "Task".to_string(),
                arguments: ToolArguments::Think {
                    description: Some("Parent task".to_string()),
                    prompt: Some("Run a child tool".to_string()),
                    subagent_type: Some("task".to_string()),
                    skill: None,
                    skill_args: None,
                    raw: None,
                },
                raw_input: None,
                status: crate::acp::session_update::ToolCallStatus::InProgress,
                result: None,
                kind: Some(crate::acp::session_update::ToolKind::Task),
                title: Some("Task".to_string()),
                locations: None,
                skill_meta: None,
                normalized_questions: None,
                normalized_todos: None,
                parent_tool_use_id: None,
                task_children: Some(vec![ToolCallData {
                    id: child_id.to_string(),
                    name: "Read".to_string(),
                    arguments: ToolArguments::Read {
                        file_path: Some("/tmp/example.txt".to_string()),
                    },
                    raw_input: None,
                    status: crate::acp::session_update::ToolCallStatus::InProgress,
                    result: None,
                    kind: Some(crate::acp::session_update::ToolKind::Read),
                    title: Some("Read file".to_string()),
                    locations: None,
                    skill_meta: None,
                    normalized_questions: None,
                    normalized_todos: None,
                    parent_tool_use_id: Some(parent_id.to_string()),
                    task_children: None,
                    question_answer: None,
                    awaiting_plan_approval: false,
                    plan_approval_request_id: None,
                }]),
                question_answer: None,
                awaiting_plan_approval: false,
                plan_approval_request_id: None,
            },
            session_id: Some("session-1".to_string()),
        }
    }

    #[test]
    fn buffers_rapid_deltas() {
        let mut batcher = StreamingDeltaBatcher::new();

        let result = batcher.process(make_delta_update("tool-1", "hello"));
        assert!(result.is_empty());
        assert!(batcher.has_pending());

        let result = batcher.process(make_delta_update("tool-1", " world"));
        assert!(result.is_empty());
    }

    #[test]
    fn buffers_rapid_message_chunks() {
        let mut batcher = StreamingDeltaBatcher::new();

        let result = batcher.process(make_message_chunk("Hello"));
        assert!(result.is_empty());
        assert!(batcher.has_pending());

        let result = batcher.process(make_message_chunk(" world"));
        assert!(result.is_empty());
    }

    #[test]
    fn buffers_rapid_thought_chunks() {
        let mut batcher = StreamingDeltaBatcher::new();

        let result = batcher.process(make_thought_chunk("Thinking"));
        assert!(result.is_empty());
        assert!(batcher.has_pending());

        let result = batcher.process(make_thought_chunk(" deeply"));
        assert!(result.is_empty());
    }

    #[test]
    fn flush_all_returns_accumulated() {
        let mut batcher = StreamingDeltaBatcher::new();

        let _ = batcher.process(make_delta_update("tool-1", "hello"));
        let _ = batcher.process(make_delta_update("tool-1", " world"));

        let flushed = batcher.flush_all();
        assert_eq!(flushed.len(), 1);

        if let SessionUpdate::ToolCallUpdate { update, .. } = &flushed[0] {
            assert_eq!(update.streaming_input_delta.as_deref(), Some("hello world"));
        } else {
            panic!("Expected ToolCallUpdate");
        }
    }

    #[test]
    fn flush_all_returns_accumulated_messages() {
        let mut batcher = StreamingDeltaBatcher::new();

        let _ = batcher.process(make_message_chunk("Hello"));
        let _ = batcher.process(make_message_chunk(" world"));

        let flushed = batcher.flush_all();
        assert_eq!(flushed.len(), 1);

        if let SessionUpdate::AgentMessageChunk { chunk, .. } = &flushed[0] {
            if let ContentBlock::Text { text } = &chunk.content {
                assert_eq!(text, "Hello world");
            } else {
                panic!("Expected text content");
            }
        } else {
            panic!("Expected AgentMessageChunk");
        }
    }

    #[test]
    fn does_not_merge_different_part_ids_for_same_message() {
        let mut batcher = StreamingDeltaBatcher::new();

        let _ = batcher.process(make_message_chunk_with_ids(
            "You're right - we\n",
            "msg-1",
            Some("part-a"),
        ));
        let _ = batcher.process(make_message_chunk_with_ids(
            "You should fix this at the source.\n",
            "msg-1",
            Some("part-b"),
        ));

        let flushed = batcher.flush_all();
        assert_eq!(flushed.len(), 2);

        let texts: Vec<String> = flushed
            .iter()
            .map(|update| match update {
                SessionUpdate::AgentMessageChunk { chunk, .. } => match &chunk.content {
                    ContentBlock::Text { text } => text.clone(),
                    _ => panic!("Expected text chunk"),
                },
                _ => panic!("Expected AgentMessageChunk"),
            })
            .collect();

        assert_eq!(
            texts,
            vec![
                "You're right - we\n".to_string(),
                "You should fix this at the source.\n".to_string()
            ]
        );
    }

    #[test]
    fn replay_interleaved_parts_preserves_part_boundaries_from_regression_fixture() {
        let mut batcher = StreamingDeltaBatcher::new();
        let session_id = "session-1";
        let message_id = "msg-1";
        let interleaved_chunks = vec![
            ("part-a", "Now the full"),
            ("part-b", " picture.est centr"),
            ("part-a", " picture."),
            ("part-b", "alized fix"),
            ("part-a", " The clean"),
            ("part-b", " is to add"),
            ("part-a", " Let me update:"),
            ("part-b", " `toolDisplayState`."),
        ];

        let mut emitted_updates = Vec::new();
        for (part_id, text) in &interleaved_chunks {
            emitted_updates.extend(batcher.process(SessionUpdate::AgentMessageChunk {
                chunk: ContentChunk {
                    content: ContentBlock::Text {
                        text: (*text).to_string(),
                    },
                    aggregation_hint: None,
                },
                part_id: Some((*part_id).to_string()),
                message_id: Some(message_id.to_string()),
                session_id: Some(session_id.to_string()),
            }));
        }
        emitted_updates.extend(batcher.process_turn_complete(session_id, None));

        let mut text_by_part: std::collections::BTreeMap<String, String> =
            std::collections::BTreeMap::new();
        let mut turn_complete_count = 0usize;

        for update in emitted_updates {
            match update {
                SessionUpdate::AgentMessageChunk {
                    chunk,
                    part_id,
                    message_id: emitted_message_id,
                    session_id: emitted_session_id,
                } => {
                    assert_eq!(emitted_session_id.as_deref(), Some(session_id));
                    assert_eq!(emitted_message_id.as_deref(), Some(message_id));

                    let key = part_id.expect("part_id must be present for replay chunks");
                    let text = match chunk.content {
                        ContentBlock::Text { text } => text,
                        _ => panic!("expected text content"),
                    };
                    text_by_part.entry(key).or_default().push_str(&text);
                }
                SessionUpdate::TurnComplete {
                    session_id: completed_session_id,
                    ..
                } => {
                    assert_eq!(completed_session_id.as_deref(), Some(session_id));
                    turn_complete_count += 1;
                }
                _ => {}
            }
        }

        let expected_part_a: String = interleaved_chunks
            .iter()
            .filter(|(part_id, _)| *part_id == "part-a")
            .map(|(_, text)| *text)
            .collect();
        let expected_part_b: String = interleaved_chunks
            .iter()
            .filter(|(part_id, _)| *part_id == "part-b")
            .map(|(_, text)| *text)
            .collect();

        assert_eq!(
            turn_complete_count, 1,
            "turn completion should be emitted once"
        );
        assert_eq!(
            text_by_part.get("part-a").map(String::as_str),
            Some(expected_part_a.as_str())
        );
        assert_eq!(
            text_by_part.get("part-b").map(String::as_str),
            Some(expected_part_b.as_str())
        );
        assert_eq!(
            text_by_part.len(),
            2,
            "only the two expected parts should exist"
        );
    }

    #[test]
    fn merges_chunks_for_same_part_id() {
        let mut batcher = StreamingDeltaBatcher::new();

        let _ = batcher.process(make_message_chunk_with_ids(
            "Let me investigate ",
            "msg-1",
            Some("part-a"),
        ));
        let _ = batcher.process(make_message_chunk_with_ids(
            "this further.",
            "msg-1",
            Some("part-a"),
        ));

        let flushed = batcher.flush_all();
        assert_eq!(flushed.len(), 1);

        if let SessionUpdate::AgentMessageChunk { chunk, part_id, .. } = &flushed[0] {
            assert_eq!(part_id.as_deref(), Some("part-a"));
            if let ContentBlock::Text { text } = &chunk.content {
                assert_eq!(text, "Let me investigate this further.");
            } else {
                panic!("Expected text chunk");
            }
        } else {
            panic!("Expected AgentMessageChunk");
        }
    }

    #[test]
    fn non_delta_updates_pass_through() {
        let mut batcher = StreamingDeltaBatcher::new();

        let status_update = SessionUpdate::ToolCallUpdate {
            update: ToolCallUpdateData {
                tool_call_id: "tool-1".to_string(),
                status: Some(crate::acp::session_update::ToolCallStatus::Completed),
                result: None,
                content: None,
                raw_output: None,
                title: None,
                locations: None,
                streaming_input_delta: None,
                normalized_todos: None,
                normalized_questions: None,
                streaming_arguments: None,
                streaming_plan: None,
                arguments: None,
                failure_reason: None,
            },
            session_id: Some("session-1".to_string()),
        };

        let result = batcher.process(status_update);
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn flushes_pending_before_status_update() {
        let mut batcher = StreamingDeltaBatcher::new();

        let _ = batcher.process(make_delta_update("tool-1", "hello"));
        let _ = batcher.process(make_delta_update("tool-1", " world"));
        assert!(batcher.has_pending());

        let status_update = SessionUpdate::ToolCallUpdate {
            update: ToolCallUpdateData {
                tool_call_id: "tool-1".to_string(),
                status: Some(crate::acp::session_update::ToolCallStatus::Completed),
                result: None,
                content: None,
                raw_output: None,
                title: None,
                locations: None,
                streaming_input_delta: None,
                normalized_todos: None,
                normalized_questions: None,
                streaming_arguments: None,
                streaming_plan: None,
                arguments: None,
                failure_reason: None,
            },
            session_id: Some("session-1".to_string()),
        };

        let result = batcher.process(status_update);
        assert_eq!(result.len(), 2);

        if let SessionUpdate::ToolCallUpdate { update, .. } = &result[0] {
            assert_eq!(update.streaming_input_delta.as_deref(), Some("hello world"));
        } else {
            panic!("Expected ToolCallUpdate with delta");
        }

        if let SessionUpdate::ToolCallUpdate { update, .. } = &result[1] {
            assert!(update.status.is_some());
        } else {
            panic!("Expected ToolCallUpdate with status");
        }
    }

    #[test]
    fn emits_after_batch_interval() {
        let mut batcher = StreamingDeltaBatcher::new();

        let result = batcher.process(make_delta_update("tool-1", "hello"));
        assert!(result.is_empty());

        std::thread::sleep(std::time::Duration::from_millis(20));

        let result = batcher.process(make_delta_update("tool-1", " world"));
        assert_eq!(result.len(), 1);

        if let SessionUpdate::ToolCallUpdate { update, .. } = &result[0] {
            assert_eq!(update.streaming_input_delta.as_deref(), Some("hello world"));
        } else {
            panic!("Expected ToolCallUpdate");
        }
    }

    #[test]
    fn emits_message_chunks_after_batch_interval() {
        let mut batcher = StreamingDeltaBatcher::new();

        let result = batcher.process(make_message_chunk("Hello"));
        assert!(result.is_empty());

        std::thread::sleep(std::time::Duration::from_millis(20));

        let result = batcher.process(make_message_chunk(" world"));
        assert_eq!(result.len(), 1);

        if let SessionUpdate::AgentMessageChunk { chunk, .. } = &result[0] {
            if let ContentBlock::Text { text } = &chunk.content {
                assert_eq!(text, "Hello world");
            } else {
                panic!("Expected text content");
            }
        } else {
            panic!("Expected AgentMessageChunk");
        }
    }

    #[test]
    fn flushes_pending_message_before_tool_call_boundary() {
        let mut batcher = StreamingDeltaBatcher::new();

        let _ = batcher.process(make_message_chunk("I'll run a command and "));
        assert!(batcher.has_pending());

        let result = batcher.process(make_tool_call("tool-1"));
        assert_eq!(result.len(), 2);

        assert!(matches!(result[0], SessionUpdate::AgentMessageChunk { .. }));
        assert!(matches!(result[1], SessionUpdate::ToolCall { .. }));
    }

    #[test]
    fn flushes_pending_child_delta_before_parent_tool_call_boundary() {
        let mut batcher = StreamingDeltaBatcher::new();

        let _ = batcher.process(make_delta_update("child-1", "{\"path\":"));
        let _ = batcher.process(make_delta_update("child-1", "\"/tmp/example.txt\"}"));
        assert!(batcher.has_pending());

        let result = batcher.process(make_parent_tool_call_with_child("parent-1", "child-1"));
        assert_eq!(result.len(), 2);

        if let SessionUpdate::ToolCallUpdate { update, .. } = &result[0] {
            assert_eq!(update.tool_call_id, "child-1");
            assert_eq!(
                update.streaming_input_delta.as_deref(),
                Some("{\"path\":\"/tmp/example.txt\"}")
            );
        } else {
            panic!("Expected flushed child ToolCallUpdate");
        }

        if let SessionUpdate::ToolCall { tool_call, .. } = &result[1] {
            assert_eq!(tool_call.id, "parent-1");
            let children = tool_call
                .task_children
                .as_ref()
                .expect("parent snapshot should include child");
            assert_eq!(children.len(), 1);
            assert_eq!(children[0].id, "child-1");
        } else {
            panic!("Expected parent ToolCall snapshot");
        }
    }

    #[test]
    fn flushes_pending_message_before_non_delta_tool_call_update() {
        let mut batcher = StreamingDeltaBatcher::new();

        let _ = batcher.process(make_message_chunk("I will report the result."));
        assert!(batcher.has_pending());

        let update = SessionUpdate::ToolCallUpdate {
            update: ToolCallUpdateData {
                tool_call_id: "tool-1".to_string(),
                status: Some(crate::acp::session_update::ToolCallStatus::Completed),
                result: Some(serde_json::json!({"stdout": "ok"})),
                content: None,
                raw_output: None,
                title: None,
                locations: None,
                streaming_input_delta: None,
                normalized_todos: None,
                normalized_questions: None,
                streaming_arguments: None,
                streaming_plan: None,
                arguments: None,
                failure_reason: None,
            },
            session_id: Some("session-1".to_string()),
        };

        let result = batcher.process(update);
        assert_eq!(result.len(), 2);

        assert!(matches!(result[0], SessionUpdate::AgentMessageChunk { .. }));
        assert!(matches!(result[1], SessionUpdate::ToolCallUpdate { .. }));
    }

    #[test]
    fn handles_multiple_concurrent_streams() {
        let mut batcher = StreamingDeltaBatcher::new();

        // Interleave deltas and message chunks
        let _ = batcher.process(make_delta_update("tool-1", "a"));
        let _ = batcher.process(make_message_chunk("X"));
        let _ = batcher.process(make_delta_update("tool-1", "b"));
        let _ = batcher.process(make_message_chunk("Y"));

        assert_eq!(batcher.buffer_count(), 2);

        let flushed = batcher.flush_all();
        assert_eq!(flushed.len(), 2);
    }

    #[test]
    fn eviction_emits_data_before_removal() {
        // Test that LRU eviction emits accumulated data instead of dropping it.
        // This is a regression test for the data loss bug where eviction silently
        // discarded buffered content.
        let mut batcher = StreamingDeltaBatcher::new();

        // Fill the batcher with MAX_BUFFERS unique tool calls
        for i in 0..super::MAX_BUFFERS {
            let tool_id = format!("tool-{}", i);
            let _ = batcher.process(make_delta_update(&tool_id, &format!("data-{}", i)));
        }
        assert_eq!(batcher.buffer_count(), super::MAX_BUFFERS);

        // Adding one more should trigger eviction and emit the evicted data
        let result = batcher.process(make_delta_update("tool-new", "new-data"));

        // The result should contain the evicted buffer's data (not empty!)
        // Note: The evicted data is returned, but the new delta is buffered (not emitted yet)
        // So we expect 1 update from eviction
        assert_eq!(
            result.len(),
            1,
            "Eviction should emit the old buffer's data"
        );

        // Verify it's a tool call update with accumulated delta
        if let SessionUpdate::ToolCallUpdate { update, .. } = &result[0] {
            assert!(
                update.streaming_input_delta.is_some(),
                "Evicted buffer should have data"
            );
            let delta = update.streaming_input_delta.as_ref().unwrap();
            assert!(
                delta.starts_with("data-"),
                "Should contain the evicted tool's data"
            );
        } else {
            panic!("Expected ToolCallUpdate from eviction");
        }

        // Buffer count should still be at max (we evicted one and added one)
        assert_eq!(batcher.buffer_count(), super::MAX_BUFFERS);
    }

    #[test]
    fn flush_all_preserves_ordering() {
        // Test that flush_all emits buffers in order of first_received timestamp.
        // This ensures consistent ordering even though HashMap iteration is non-deterministic.
        let mut batcher = StreamingDeltaBatcher::new();

        // Add deltas with small delays to ensure different timestamps
        let _ = batcher.process(make_delta_update("tool-first", "a"));
        std::thread::sleep(std::time::Duration::from_millis(1));
        let _ = batcher.process(make_delta_update("tool-second", "b"));
        std::thread::sleep(std::time::Duration::from_millis(1));
        let _ = batcher.process(make_delta_update("tool-third", "c"));

        assert_eq!(batcher.buffer_count(), 3);

        let flushed = batcher.flush_all();
        assert_eq!(flushed.len(), 3);

        // Verify ordering by first_received - should be first, second, third
        let tool_ids: Vec<&str> = flushed
            .iter()
            .map(|update| {
                if let SessionUpdate::ToolCallUpdate { update, .. } = update {
                    update.tool_call_id.as_str()
                } else {
                    panic!("Expected ToolCallUpdate");
                }
            })
            .collect();

        assert_eq!(tool_ids, vec!["tool-first", "tool-second", "tool-third"]);
    }

    #[test]
    fn process_turn_complete_flushes_session_and_appends_complete() {
        let mut batcher = StreamingDeltaBatcher::new();

        // Buffer some chunks for session-1
        let _ = batcher.process(make_message_chunk("Hello"));
        let _ = batcher.process(make_message_chunk(" world"));

        assert!(batcher.has_pending());

        // Process turn complete
        let result = batcher.process_turn_complete("session-1", Some("turn-1".to_string()));

        // Should have 1 flushed message chunk + 1 TurnComplete
        assert_eq!(result.len(), 2);

        // First should be the accumulated message chunk
        if let SessionUpdate::AgentMessageChunk { chunk, .. } = &result[0] {
            if let ContentBlock::Text { text } = &chunk.content {
                assert_eq!(text, "Hello world");
            } else {
                panic!("Expected text content");
            }
        } else {
            panic!("Expected AgentMessageChunk first");
        }

        // Last should be TurnComplete
        if let SessionUpdate::TurnComplete {
            session_id,
            turn_id,
        } = &result[1]
        {
            assert_eq!(session_id.as_deref(), Some("session-1"));
            assert_eq!(turn_id.as_deref(), Some("turn-1"));
        } else {
            panic!("Expected TurnComplete last");
        }

        // Batcher should be empty now
        assert!(!batcher.has_pending());
    }

    #[test]
    fn process_turn_error_flushes_session_and_appends_error() {
        let mut batcher = StreamingDeltaBatcher::new();

        // Buffer some chunks
        let _ = batcher.process(make_message_chunk("Partial response"));

        // Process turn error
        let result = batcher.process_turn_error(
            "session-1",
            Some("turn-2".to_string()),
            TurnErrorData::Legacy("Rate limit exceeded".to_string()),
        );

        // Should have 1 flushed message chunk + 1 TurnError
        assert_eq!(result.len(), 2);

        // First should be the message chunk
        assert!(matches!(
            &result[0],
            SessionUpdate::AgentMessageChunk { .. }
        ));

        // Last should be TurnError with the legacy error message
        if let SessionUpdate::TurnError {
            error,
            session_id,
            turn_id,
        } = &result[1]
        {
            assert_eq!(
                error,
                &TurnErrorData::Legacy("Rate limit exceeded".to_string())
            );
            assert_eq!(session_id.as_deref(), Some("session-1"));
            assert_eq!(turn_id.as_deref(), Some("turn-2"));
        } else {
            panic!("Expected TurnError last");
        }
    }

    #[test]
    fn process_turn_complete_only_flushes_matching_session() {
        let mut batcher = StreamingDeltaBatcher::new();

        // Buffer chunks for two different sessions
        let _ = batcher.process(SessionUpdate::AgentMessageChunk {
            chunk: ContentChunk {
                content: ContentBlock::Text {
                    text: "Session 1 text".to_string(),
                },
                aggregation_hint: None,
            },
            part_id: None,
            message_id: Some("msg-1".to_string()),
            session_id: Some("session-1".to_string()),
        });

        let _ = batcher.process(SessionUpdate::AgentMessageChunk {
            chunk: ContentChunk {
                content: ContentBlock::Text {
                    text: "Session 2 text".to_string(),
                },
                aggregation_hint: None,
            },
            part_id: None,
            message_id: Some("msg-2".to_string()),
            session_id: Some("session-2".to_string()),
        });

        assert_eq!(batcher.buffer_count(), 2);

        // Complete only session-1
        let result = batcher.process_turn_complete("session-1", None);

        // Should have session-1's chunk + TurnComplete
        assert_eq!(result.len(), 2);

        // Session-2's buffer should still be pending
        assert!(batcher.has_pending());
        assert_eq!(batcher.buffer_count(), 1);

        // Verify session-2 is still buffered
        let remaining = batcher.flush_all();
        assert_eq!(remaining.len(), 1);
        if let SessionUpdate::AgentMessageChunk {
            chunk, session_id, ..
        } = &remaining[0]
        {
            assert_eq!(session_id.as_deref(), Some("session-2"));
            if let ContentBlock::Text { text } = &chunk.content {
                assert_eq!(text, "Session 2 text");
            }
        }
    }

    #[test]
    fn process_turn_complete_with_no_pending_data() {
        let mut batcher = StreamingDeltaBatcher::new();

        // No data buffered - should just return TurnComplete
        let result = batcher.process_turn_complete("session-1", None);

        assert_eq!(result.len(), 1);
        assert!(matches!(&result[0], SessionUpdate::TurnComplete { .. }));
    }
}
