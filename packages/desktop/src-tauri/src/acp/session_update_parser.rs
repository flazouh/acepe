//! Session Update Parser
//!
//! Handles normalization and parsing of session update JSON from ACP protocol.
//! Supports two formats:
//! - Format 1: `{ sessionId, update: { sessionUpdate, ... } }` (nested)
//! - Format 2: `{ sessionUpdate, sessionId, ... }` (flat)

use serde_json::Value;

#[cfg(test)]
use crate::acp::agent_context::current_agent;
use crate::acp::domain_events::{SessionDomainEventKind, SessionDomainEventPayload};
use crate::acp::parsers::AgentType;
use crate::acp::projections::{build_plan_approval_interaction_id, InteractionKind};
use crate::acp::provider::AgentProvider;
use crate::acp::session_update::{
    parse_session_update_with_agent, ContentChunk, SessionUpdate, ToolCallStatus, ToolKind,
    TurnErrorData,
};

pub fn parse_session_update_notification_with_agent(agent: AgentType, json: &Value) -> ParseResult {
    parse_session_update_notification_for_context(agent, None, json)
}

pub fn parse_session_update_notification_with_provider(
    agent: AgentType,
    provider: Option<&dyn AgentProvider>,
    json: &Value,
) -> ParseResult {
    parse_session_update_notification_for_context(agent, provider, json)
}

/// Result of parsing a session update notification.
#[derive(Debug)]
pub enum ParseResult {
    /// Successfully parsed typed session update
    Typed(Box<SessionUpdate>),
    /// Failed to parse, contains raw params for fallback emission
    Raw {
        params: Value,
        error: String,
        session_id: Option<String>,
        update_type: Option<String>,
    },
    /// Not a session update notification
    NotSessionUpdate,
}

/// Normalize session update params to canonical flat format.
///
/// Handles both:
/// - Format 1: `{ sessionId, update: { sessionUpdate, ... } }` → merges sessionId into update
/// - Format 2: `{ sessionUpdate, sessionId, ... }` → returns as-is
///
/// Returns `None` if params is not an object.
pub fn normalize_session_update_params(params: &Value) -> Option<Value> {
    // Must be an object
    if !params.is_object() {
        return None;
    }

    // Check for nested format: { sessionId?, update: { ... } }
    if let Some(update) = params.get("update") {
        let mut data = update.clone();
        // Merge sessionId from parent if present
        if let Some(session_id) = params.get("sessionId") {
            if let Some(obj) = data.as_object_mut() {
                obj.insert("sessionId".to_string(), session_id.clone());
            }
        }
        Some(data)
    } else {
        // Flat format: return as-is
        Some(params.clone())
    }
}

/// Extract session ID from params, checking multiple field names.
pub fn extract_session_id(params: &Value) -> Option<String> {
    params
        .get("sessionId")
        .or_else(|| params.get("session_id"))
        .and_then(|v| v.as_str())
        .filter(|session_id| !session_id.is_empty())
        .map(str::to_string)
}

/// Check if this is a session update notification by method name.
fn is_session_update_method(method: &str) -> bool {
    method == "session/update"
}

#[cfg(test)]
pub fn parse_session_update_notification(json: &Value) -> ParseResult {
    let method = match json.get("method").and_then(|v| v.as_str()) {
        Some(method) => method,
        None => return ParseResult::NotSessionUpdate,
    };

    if !is_session_update_method(method) {
        return ParseResult::NotSessionUpdate;
    }

    let agent = current_agent().expect(
        "Missing agent context for session update notification parsing",
    );
    parse_session_update_notification_for_context(agent, None, json)
}

fn parse_session_update_notification_for_context(
    agent: AgentType,
    provider: Option<&dyn AgentProvider>,
    json: &Value,
) -> ParseResult {
    // Check for method field - notifications have method but no id
    let method = match json.get("method").and_then(|v| v.as_str()) {
        Some(m) => m,
        None => return ParseResult::NotSessionUpdate,
    };

    // Only handle session update methods
    if !is_session_update_method(method) {
        return ParseResult::NotSessionUpdate;
    }

    if provider.is_some_and(|provider| provider.should_filter_session_update_notification(json)) {
        return ParseResult::NotSessionUpdate;
    }

    // Extract params
    let params = match json.get("params") {
        Some(p) => p,
        None => return ParseResult::NotSessionUpdate,
    };

    // Log the session update type for debugging
    let session_update_type = params
        .get("update")
        .and_then(|u| u.get("sessionUpdate"))
        .or_else(|| params.get("sessionUpdate"))
        .and_then(|v| v.as_str())
        .map(str::to_string);

    tracing::debug!(
        session_update_type = ?session_update_type,
        "Processing session update notification"
    );

    // Normalize to canonical format
    let normalized = match normalize_session_update_params(params) {
        Some(n) => n,
        None => {
            return ParseResult::Raw {
                params: params.clone(),
                error: "params is not an object".to_string(),
                session_id: extract_session_id(params),
                update_type: session_update_type.clone(),
            }
        }
    };

    // Parse into typed SessionUpdate
    match parse_session_update_with_agent::<serde_json::Error>(&normalized, agent) {
        Ok(update) => {
            // Log successful parsing of tool calls specifically
            if session_update_type.as_deref() == Some("tool_call")
                || session_update_type.as_deref() == Some("toolCall")
            {
                tracing::debug!(
                    session_update_type = ?session_update_type,
                    "Successfully parsed tool_call session update"
                );
            }
            ParseResult::Typed(Box::new(update))
        }
        Err(e) => {
            tracing::warn!(
                session_update_type = ?session_update_type,
                error = %e,
                normalized_data = %normalized,
                "Failed to parse session update"
            );
            ParseResult::Raw {
                params: params.clone(),
                error: e.to_string(),
                session_id: extract_session_id(params),
                update_type: session_update_type,
            }
        }
    }
}

/// Map a parsed [`SessionUpdate`] to its canonical `(kind, payload)` pair.
///
/// Returns `None` when the update has no canonical domain-event representation
/// (e.g. config updates handled separately, or unrecognised variants).
///
/// Callers that already know the correct kind (e.g. interaction resolution in
/// `client_transport`) should build the `SessionDomainEventPayload` directly
/// rather than routing through this function.
pub fn session_update_to_domain_event(
    update: &SessionUpdate,
) -> Option<(SessionDomainEventKind, Option<SessionDomainEventPayload>)> {
    match update {
        // ── transcript ─────────────────────────────────────────────────────
        SessionUpdate::UserMessageChunk { chunk, .. } => {
            let text = extract_chunk_text(chunk);
            Some((
                SessionDomainEventKind::UserMessageSegmentAppended,
                Some(SessionDomainEventPayload::UserMessageSegmentAppended {
                    message_id: None,
                    part_id: None,
                    text,
                }),
            ))
        }
        SessionUpdate::AgentMessageChunk {
            chunk,
            message_id,
            part_id,
            ..
        } => {
            let text = extract_chunk_text(chunk);
            Some((
                SessionDomainEventKind::AssistantMessageSegmentAppended,
                Some(SessionDomainEventPayload::AssistantMessageSegmentAppended {
                    message_id: message_id.clone(),
                    part_id: part_id.clone(),
                    text,
                }),
            ))
        }
        SessionUpdate::AgentThoughtChunk {
            chunk,
            message_id,
            part_id,
            ..
        } => {
            let text = extract_chunk_text(chunk);
            Some((
                SessionDomainEventKind::AssistantThoughtSegmentAppended,
                Some(SessionDomainEventPayload::AssistantThoughtSegmentAppended {
                    message_id: message_id.clone(),
                    part_id: part_id.clone(),
                    text,
                }),
            ))
        }

        // ── tool execution ─────────────────────────────────────────────────
        SessionUpdate::ToolCall {
            tool_call,
            session_id,
        } if tool_call.awaiting_plan_approval => {
            let interaction_id = if let (Some(sid), Some(rid)) = (
                session_id.as_deref().filter(|s| !s.is_empty()),
                tool_call.plan_approval_request_id,
            ) {
                build_plan_approval_interaction_id(sid, &tool_call.id, rid)
            } else {
                tool_call.id.clone()
            };
            Some((
                SessionDomainEventKind::InteractionUpserted,
                Some(SessionDomainEventPayload::InteractionUpserted {
                    interaction_id,
                    interaction_kind: InteractionKind::PlanApproval,
                }),
            ))
        }
        SessionUpdate::ToolCall { tool_call, .. } => {
            let status = tool_call.status.clone();
            Some((
                SessionDomainEventKind::OperationUpserted,
                Some(SessionDomainEventPayload::OperationUpserted {
                    operation_id: tool_call.id.clone(),
                    tool_call_id: tool_call.id.clone(),
                    tool_name: tool_call.name.clone(),
                    tool_kind: tool_call.kind.unwrap_or(ToolKind::Unclassified),
                    status,
                    parent_operation_id: tool_call.parent_tool_use_id.clone(),
                }),
            ))
        }
        SessionUpdate::ToolCallUpdate { update, .. } => {
            let status = update.status.clone().unwrap_or(ToolCallStatus::InProgress);
            Some((
                SessionDomainEventKind::OperationStatusUpdated,
                Some(SessionDomainEventPayload::OperationStatusUpdated {
                    operation_id: update.tool_call_id.clone(),
                    tool_call_id: update.tool_call_id.clone(),
                    status,
                }),
            ))
        }

        // ── interactions ───────────────────────────────────────────────────
        SessionUpdate::PermissionRequest { permission, .. } => Some((
            SessionDomainEventKind::InteractionUpserted,
            Some(SessionDomainEventPayload::InteractionUpserted {
                interaction_id: permission.id.clone(),
                interaction_kind: InteractionKind::Permission,
            }),
        )),
        SessionUpdate::QuestionRequest { question, .. } => Some((
            SessionDomainEventKind::InteractionUpserted,
            Some(SessionDomainEventPayload::InteractionUpserted {
                interaction_id: question.id.clone(),
                interaction_kind: InteractionKind::Question,
            }),
        )),

        // ── turn lifecycle ─────────────────────────────────────────────────
        SessionUpdate::TurnComplete { turn_id, .. } => Some((
            SessionDomainEventKind::TurnCompleted,
            Some(SessionDomainEventPayload::TurnCompleted {
                turn_id: turn_id.clone(),
            }),
        )),
        SessionUpdate::TurnError { error, turn_id, .. } => {
            let error_message = match error {
                TurnErrorData::Legacy(msg) => msg.clone(),
                TurnErrorData::Structured(info) => info.message.clone(),
            };
            Some((
                SessionDomainEventKind::TurnFailed,
                Some(SessionDomainEventPayload::TurnFailed {
                    turn_id: turn_id.clone(),
                    error_message,
                }),
            ))
        }
        SessionUpdate::TurnCancelled { turn_id, .. } => Some((
            SessionDomainEventKind::TurnCancelled,
            Some(SessionDomainEventPayload::TurnCancelled {
                turn_id: turn_id.clone(),
            }),
        )),

        // ── usage / telemetry ──────────────────────────────────────────────
        SessionUpdate::UsageTelemetryUpdate { data } => Some((
            SessionDomainEventKind::UsageTelemetryUpdated,
            Some(SessionDomainEventPayload::UsageTelemetryUpdated { data: data.clone() }),
        )),

        // ── connection lifecycle (handled via enqueue_session_domain_event) ─
        SessionUpdate::ConnectionComplete { .. }
        | SessionUpdate::ConnectionFailed { .. }
        | SessionUpdate::SessionDetached { .. } => None,

        // ── config / mode / commands — no domain event ─────────────────────
        SessionUpdate::Plan { .. }
        | SessionUpdate::AvailableCommandsUpdate { .. }
        | SessionUpdate::CurrentModeUpdate { .. }
        | SessionUpdate::ConfigOptionUpdate { .. } => None,
    }
}

/// Extract plain text from a `ContentChunk` for canonical event payloads.
fn extract_chunk_text(chunk: &ContentChunk) -> String {
    use crate::acp::types::ContentBlock;
    match &chunk.content {
        ContentBlock::Text { text } => text.clone(),
        ContentBlock::Image { .. }
        | ContentBlock::Audio { .. }
        | ContentBlock::Resource { .. }
        | ContentBlock::ResourceLink { .. } => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::types::ContentBlock;
    use serde_json::json;

    #[test]
    fn assistant_message_domain_event_preserves_missing_message_id() {
        let update = SessionUpdate::AgentMessageChunk {
            chunk: ContentChunk {
                content: ContentBlock::Text {
                    text: "hello".to_string(),
                },
                aggregation_hint: None,
            },
            part_id: None,
            message_id: None,
            session_id: Some("session-1".to_string()),
            produced_at_monotonic_ms: None,
        };

        let Some((_, Some(payload))) = session_update_to_domain_event(&update) else {
            panic!("expected assistant message domain event payload");
        };

        match payload {
            SessionDomainEventPayload::AssistantMessageSegmentAppended { message_id, .. } => {
                assert_eq!(message_id, None);
            }
            other => panic!(
                "expected assistant message segment payload, got {:?}",
                other
            ),
        }
    }

    #[test]
    fn assistant_thought_domain_event_preserves_missing_message_id() {
        let update = SessionUpdate::AgentThoughtChunk {
            chunk: ContentChunk {
                content: ContentBlock::Text {
                    text: "thinking".to_string(),
                },
                aggregation_hint: None,
            },
            part_id: None,
            message_id: None,
            session_id: Some("session-1".to_string()),
        };

        let Some((_, Some(payload))) = session_update_to_domain_event(&update) else {
            panic!("expected assistant thought domain event payload");
        };

        match payload {
            SessionDomainEventPayload::AssistantThoughtSegmentAppended { message_id, .. } => {
                assert_eq!(message_id, None);
            }
            other => panic!(
                "expected assistant thought segment payload, got {:?}",
                other
            ),
        }
    }

    #[test]
    fn tool_call_update_domain_event_does_not_fabricate_tool_identity() {
        let update = SessionUpdate::ToolCallUpdate {
            update: crate::acp::session_update::ToolCallUpdateData {
                tool_call_id: "tool-search-1".to_string(),
                status: Some(ToolCallStatus::Completed),
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

        let Some((kind, Some(payload))) = session_update_to_domain_event(&update) else {
            panic!("expected operation status domain event payload");
        };

        assert!(matches!(
            kind,
            SessionDomainEventKind::OperationStatusUpdated
        ));
        match payload {
            SessionDomainEventPayload::OperationStatusUpdated {
                operation_id,
                tool_call_id,
                status,
            } => {
                assert_eq!(operation_id, "tool-search-1");
                assert_eq!(tool_call_id, "tool-search-1");
                assert!(matches!(status, ToolCallStatus::Completed));
            }
            other => panic!("expected operation status payload, got {:?}", other),
        }
    }

    mod normalize_session_update_params {
        use super::*;

        #[test]
        fn normalizes_nested_format_with_session_id() {
            // Format 1: { sessionId, update: { sessionUpdate, ... } }
            let params = json!({
                "sessionId": "sess-123",
                "update": {
                    "sessionUpdate": "tool_call",
                    "toolCallId": "tool-456"
                }
            });

            let result = normalize_session_update_params(&params);

            assert!(result.is_some());
            let normalized = result.unwrap();
            // Should merge sessionId into the update object
            assert_eq!(normalized.get("sessionId").unwrap(), "sess-123");
            assert_eq!(normalized.get("sessionUpdate").unwrap(), "tool_call");
            assert_eq!(normalized.get("toolCallId").unwrap(), "tool-456");
        }

        #[test]
        fn preserves_flat_format() {
            // Format 2: { sessionUpdate, sessionId, ... }
            let params = json!({
                "sessionId": "sess-123",
                "sessionUpdate": "agent_message_chunk",
                "content": { "type": "text", "text": "Hello" }
            });

            let result = normalize_session_update_params(&params);

            assert!(result.is_some());
            let normalized = result.unwrap();
            // Should return as-is
            assert_eq!(normalized.get("sessionId").unwrap(), "sess-123");
            assert_eq!(
                normalized.get("sessionUpdate").unwrap(),
                "agent_message_chunk"
            );
        }

        #[test]
        fn only_treats_session_update_as_session_update_method() {
            assert!(is_session_update_method("session/update"));
            assert!(!is_session_update_method("session/request_permission"));
        }

        #[test]
        fn handles_nested_format_without_session_id() {
            // Edge case: update field exists but no sessionId at top level
            let params = json!({
                "update": {
                    "sessionUpdate": "available_commands_update",
                    "availableCommands": []
                }
            });

            let result = normalize_session_update_params(&params);

            assert!(result.is_some());
            let normalized = result.unwrap();
            assert_eq!(
                normalized.get("sessionUpdate").unwrap(),
                "available_commands_update"
            );
            // sessionId should not be present
            assert!(normalized.get("sessionId").is_none());
        }

        #[test]
        fn returns_none_for_non_object() {
            let params = json!("not an object");
            assert!(normalize_session_update_params(&params).is_none());

            let params = json!(123);
            assert!(normalize_session_update_params(&params).is_none());

            let params = json!(null);
            assert!(normalize_session_update_params(&params).is_none());
        }
    }

    mod extract_session_id {
        use super::*;

        #[test]
        fn extracts_camel_case_session_id() {
            let params = json!({ "sessionId": "sess-123" });
            assert_eq!(extract_session_id(&params).as_deref(), Some("sess-123"));
        }

        #[test]
        fn extracts_snake_case_session_id() {
            let params = json!({ "session_id": "sess-456" });
            assert_eq!(extract_session_id(&params).as_deref(), Some("sess-456"));
        }

        #[test]
        fn prefers_camel_case_over_snake_case() {
            let params = json!({
                "sessionId": "camel",
                "session_id": "snake"
            });
            assert_eq!(extract_session_id(&params).as_deref(), Some("camel"));
        }

        #[test]
        fn returns_none_when_missing() {
            let params = json!({ "other": "value" });
            assert_eq!(extract_session_id(&params), None);
        }

        #[test]
        fn returns_none_when_empty() {
            let params = json!({ "sessionId": "" });
            assert_eq!(extract_session_id(&params), None);
        }
    }

    mod parse_session_update_notification {
        use super::*;
        use crate::acp::agent_context::{current_agent, with_agent};

        fn parse_notification(json: &serde_json::Value) -> ParseResult {
            with_agent(AgentType::ClaudeCode, || parse_session_update_notification(json))
        }

        #[test]
        fn returns_not_session_update_for_non_session_method() {
            let json = json!({
                "jsonrpc": "2.0",
                "method": "other/method",
                "params": {}
            });

            let result = parse_session_update_notification(&json);
            assert!(matches!(result, ParseResult::NotSessionUpdate));
        }

        #[test]
        fn returns_not_session_update_when_no_method() {
            // Response (has id, no method) - not a notification
            let json = json!({
                "jsonrpc": "2.0",
                "id": 1,
                "result": {}
            });

            let result = parse_session_update_notification(&json);
            assert!(matches!(result, ParseResult::NotSessionUpdate));
        }

        #[test]
        fn parses_nested_format_available_commands() {
            // availableCommands field must contain an object with availableCommands array
            let json = json!({
                "jsonrpc": "2.0",
                "method": "session/update",
                "params": {
                    "sessionId": "sess-123",
                    "update": {
                        "sessionUpdate": "available_commands_update",
                        "availableCommands": {
                            "availableCommands": [
                                { "name": "test", "description": "Test command", "input": null }
                            ]
                        }
                    }
                }
            });

            let result = parse_notification(&json);
            assert!(
                matches!(result, ParseResult::Typed(_)),
                "Expected Typed, got {:?}",
                result
            );
        }

        #[test]
        fn parses_nested_format_config_option_update() {
            let json = json!({
                "jsonrpc": "2.0",
                "method": "session/update",
                "params": {
                    "sessionId": "sess-config",
                    "update": {
                        "sessionUpdate": "config_option_update",
                        "configOptions": [
                            {
                                "id": "model",
                                "name": "Model",
                                "category": "model",
                                "type": "select",
                                "currentValue": "gpt-5.3-codex",
                                "options": [
                                    { "name": "gpt-5.3-codex", "value": "gpt-5.3-codex" }
                                ]
                            }
                        ]
                    }
                }
            });

            let result = parse_notification(&json);
            assert!(
                matches!(result, ParseResult::Typed(_)),
                "Expected Typed, got {:?}",
                result
            );
        }

        #[test]
        fn parses_nested_format_tool_call() {
            // ACP format uses toolCallId (not id) and _meta.claudeCode.toolName
            let json = json!({
                "jsonrpc": "2.0",
                "method": "session/update",
                "params": {
                    "sessionId": "sess-123",
                    "update": {
                        "sessionUpdate": "tool_call",
                        "toolCallId": "tool-456",
                        "_meta": {
                            "claudeCode": {
                                "toolName": "Read"
                            }
                        },
                        "rawInput": {},
                        "status": "pending",
                        "kind": "read",
                        "title": "Reading file"
                    }
                }
            });

            let result = parse_notification(&json);
            assert!(
                matches!(result, ParseResult::Typed(_)),
                "Expected Typed, got {:?}",
                result
            );
        }

        #[test]
        fn parses_nested_format_agent_message_chunk() {
            let json = json!({
                "jsonrpc": "2.0",
                "method": "session/update",
                "params": {
                    "sessionId": "sess-123",
                    "update": {
                        "sessionUpdate": "agent_message_chunk",
                        "content": { "type": "text", "text": "Hello" },
                        "messageId": "msg-789"
                    }
                }
            });

            let result = parse_notification(&json);
            assert!(
                matches!(result, ParseResult::Typed(_)),
                "Expected Typed, got {:?}",
                result
            );
        }

        #[test]
        fn returns_raw_for_unparseable_update() {
            let json = json!({
                "jsonrpc": "2.0",
                "method": "session/update",
                "params": {
                    "sessionId": "sess-123",
                    "update": {
                        "sessionUpdate": "unknown_type_that_doesnt_exist",
                        "randomField": true
                    }
                }
            });

            let result = parse_notification(&json);
            match result {
                ParseResult::Raw {
                    session_id, error, ..
                } => {
                    assert_eq!(session_id.as_deref(), Some("sess-123"));
                    assert!(!error.is_empty());
                }
                _ => panic!("Expected Raw, got {:?}", result),
            }
        }

        #[test]
        fn raw_parse_result_preserves_absent_update_type() {
            let json = json!({
                "jsonrpc": "2.0",
                "method": "session/update",
                "params": {
                    "sessionId": "sess-123",
                    "update": {
                        "randomField": true
                    }
                }
            });

            let result = parse_notification(&json);
            match result {
                ParseResult::Raw {
                    update_type,
                    session_id,
                    ..
                } => {
                    assert_eq!(session_id.as_deref(), Some("sess-123"));
                    assert_eq!(update_type, None);
                }
                _ => panic!("Expected Raw, got {:?}", result),
            }
        }

        #[test]
        fn parse_session_update_notification_scopes_context() {
            let agent = AgentType::Codex;
            let json = json!({
                "jsonrpc": "2.0",
                "method": "session/update",
                "params": {
                    "sessionId": "sess-1",
                    "sessionUpdate": "tool_call",
                    "toolCallId": "tool-1",
                    "rawInput": {},
                    "_meta": { "claudeCode": { "toolName": "Read" } }
                }
            });

            assert_eq!(current_agent(), None);
            let result = parse_session_update_notification_with_agent(agent, &json);
            assert!(matches!(
                result,
                ParseResult::Typed(update) if matches!(*update, SessionUpdate::ToolCall { .. })
            ));
            assert_eq!(current_agent(), None);
        }

        #[test]
        fn codex_running_tool_call_without_raw_input_parses_as_tool_call() {
            let json = json!({
                "jsonrpc": "2.0",
                "method": "session/update",
                "params": {
                    "sessionId": "sess-codex",
                    "update": {
                        "sessionUpdate": "tool_call",
                        "toolCallId": "tool-search-1",
                        "title": "Search branch:main|branch: in desktop",
                        "kind": "search",
                        "status": "running"
                    }
                }
            });

            let result = parse_session_update_notification_with_agent(AgentType::Codex, &json);

            match result {
                ParseResult::Typed(update) => match *update {
                    SessionUpdate::ToolCall { tool_call, .. } => {
                        assert_eq!(tool_call.id, "tool-search-1");
                        assert_eq!(tool_call.name, "Search");
                        assert!(matches!(
                            tool_call.status,
                            crate::acp::session_update::ToolCallStatus::InProgress
                        ));
                        assert_eq!(
                            tool_call.kind,
                            Some(crate::acp::session_update::ToolKind::Search)
                        );
                    }
                    other => panic!("Expected ToolCall, got {:?}", other),
                },
                other => panic!("Expected Typed result, got {:?}", other),
            }
        }

        #[test]
        fn codex_tool_call_update_infers_failed_status_from_raw_output() {
            let json = json!({
                "jsonrpc": "2.0",
                "method": "session/update",
                "params": {
                    "sessionId": "sess-codex",
                    "update": {
                        "sessionUpdate": "tool_call_update",
                        "toolCallId": "tool-search-1",
                        "rawOutput": "Process exited with code 127"
                    }
                }
            });

            let result = parse_session_update_notification_with_agent(AgentType::Codex, &json);

            match result {
                ParseResult::Typed(update) => match *update {
                    SessionUpdate::ToolCallUpdate { update, .. } => {
                        assert_eq!(update.tool_call_id, "tool-search-1");
                        assert!(matches!(
                            update.status,
                            Some(crate::acp::session_update::ToolCallStatus::Failed)
                        ));
                    }
                    other => panic!("Expected ToolCallUpdate, got {:?}", other),
                },
                other => panic!("Expected Typed result, got {:?}", other),
            }
        }

        #[test]
        fn codex_usage_update_parses_as_typed_usage_telemetry() {
            let json = json!({
                "jsonrpc": "2.0",
                "method": "session/update",
                "params": {
                    "sessionId": "sess-codex-usage",
                    "update": {
                        "sessionUpdate": "usage_update",
                        "size": 258400,
                        "used": 32451
                    }
                }
            });

            let result = parse_session_update_notification_with_agent(AgentType::Codex, &json);

            match result {
                ParseResult::Typed(update) => match *update {
                    SessionUpdate::UsageTelemetryUpdate { data } => {
                        assert_eq!(data.session_id, "sess-codex-usage");
                        assert_eq!(data.tokens.total, Some(32451));
                        assert_eq!(data.context_window_size, Some(258400));
                    }
                    other => panic!("Expected UsageTelemetryUpdate, got {:?}", other),
                },
                other => panic!("Expected Typed result, got {:?}", other),
            }
        }
    }
}
