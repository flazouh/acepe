use anyhow::Result;
use serde_json::Value;

use crate::acp::streaming_log::log_streaming_event;
use crate::acp::ui_event_dispatcher::{AcpUiEvent, AcpUiEventDispatcher, AcpUiEventPriority};

use super::conversion::{
    cache_message_role_from_update, convert_message_part_delta_to_session_update,
    convert_message_part_to_session_update, convert_permission_asked_to_session_update,
    convert_question_asked_to_session_update, convert_session_error_to_session_update,
    convert_session_idle_to_session_update, convert_session_status_to_session_update,
    EventEnvelope, MultiplexedEventEnvelope, PartConversionResult,
};

pub(super) fn handle_sse_event(raw: &str, dispatcher: &AcpUiEventDispatcher) -> Result<()> {
    // Try to parse as multiplexed event first
    if let Ok(multiplexed) = serde_json::from_str::<MultiplexedEventEnvelope>(raw) {
        // Log raw SSE data for debugging (dev only)
        if let Some(session_id) = extract_session_id_from_envelope(&multiplexed.payload) {
            if let Ok(json_value) = serde_json::from_str::<Value>(raw) {
                log_streaming_event(&session_id, &json_value);
            }
        }
        return handle_event_envelope(multiplexed.payload, dispatcher);
    }

    // Fall back to regular event envelope
    if let Ok(envelope) = serde_json::from_str::<EventEnvelope>(raw) {
        // Log raw SSE data for debugging (dev only)
        if let Some(session_id) = extract_session_id_from_envelope(&envelope) {
            if let Ok(json_value) = serde_json::from_str::<Value>(raw) {
                log_streaming_event(&session_id, &json_value);
            }
        }
        return handle_event_envelope(envelope, dispatcher);
    }

    tracing::error!(
        raw_preview = %&raw[..raw.len().min(500)],
        "Failed to parse SSE event as MultiplexedEventEnvelope or EventEnvelope"
    );
    Ok(())
}

/// Extract session ID from event envelope properties
pub(super) fn extract_session_id_from_envelope(envelope: &EventEnvelope) -> Option<String> {
    // Try sessionID field
    if let Some(session_id) = envelope
        .properties
        .get("sessionID")
        .and_then(|v| v.as_str())
    {
        return Some(session_id.to_string());
    }
    // Try part.sessionID for message.part.updated events
    if let Some(part) = envelope.properties.get("part") {
        if let Some(session_id) = part.get("sessionID").and_then(|v| v.as_str()) {
            return Some(session_id.to_string());
        }
    }
    None
}

/// Handle an event envelope by routing to appropriate Tauri event
pub(super) fn handle_event_envelope(
    envelope: EventEnvelope,
    dispatcher: &AcpUiEventDispatcher,
) -> Result<()> {
    let session_id = extract_session_id_from_envelope(&envelope);
    match envelope.event_type.as_str() {
        // Session events - these need conversion to SessionUpdate
        "message.part.updated" => {
            // Log all incoming message.part.updated events at trace level
            tracing::trace!(
                event_type = %envelope.event_type,
                raw_properties = %envelope.properties,
                "INCOMING MESSAGE PART UPDATED"
            );

            match convert_message_part_to_session_update(&envelope.properties) {
                PartConversionResult::Converted(update) => {
                    dispatcher.enqueue(AcpUiEvent::session_update(*update));
                }
                PartConversionResult::Filtered(reason) => {
                    tracing::trace!(
                        event_type = %envelope.event_type,
                        ?reason,
                        "Filtered message part (intentional)"
                    );
                }
                PartConversionResult::Failed(error) => {
                    tracing::warn!(
                        event_type = %envelope.event_type,
                        properties = %envelope.properties,
                        error = %error,
                        "Failed to convert message.part.updated to SessionUpdate"
                    );
                }
            }
        }

        "message.part.delta" => {
            match convert_message_part_delta_to_session_update(&envelope.properties) {
                PartConversionResult::Converted(update) => {
                    dispatcher.enqueue(AcpUiEvent::session_update(*update));
                }
                PartConversionResult::Filtered(reason) => {
                    tracing::trace!(
                        event_type = %envelope.event_type,
                        ?reason,
                        "Filtered message part delta (intentional)"
                    );
                }
                PartConversionResult::Failed(error) => {
                    tracing::warn!(
                        event_type = %envelope.event_type,
                        properties = %envelope.properties,
                        error = %error,
                        "Failed to convert message.part.delta to SessionUpdate"
                    );
                }
            }
        }

        "session.status" => {
            if let Some(update) = convert_session_status_to_session_update(&envelope.properties) {
                dispatcher.enqueue(AcpUiEvent::session_update(update));
            }
        }

        "message.updated" => {
            if cache_message_role_from_update(&envelope.properties).is_none() {
                tracing::debug!(
                    event_type = %envelope.event_type,
                    properties = %envelope.properties,
                    "Failed to cache message role from message.updated"
                );
            }
            tracing::trace!(event_type = %envelope.event_type, "Handled message.updated for role caching");
        }

        "session.updated" => {
            tracing::trace!(event_type = %envelope.event_type, "Skipping - redundant with session.status");
        }

        "session.idle" => {
            if let Some(update) = convert_session_idle_to_session_update(&envelope.properties) {
                dispatcher.enqueue(AcpUiEvent::session_update(update));
            }
        }

        // Session lifecycle events
        "session.created" => {
            dispatcher.enqueue(AcpUiEvent::json_event(
                "acp-session-created",
                envelope.properties,
                session_id,
                AcpUiEventPriority::Normal,
                false,
            ));
        }
        "session.deleted" => {
            dispatcher.enqueue(AcpUiEvent::json_event(
                "acp-session-lifecycle",
                envelope.properties,
                session_id,
                AcpUiEventPriority::Normal,
                false,
            ));
        }
        "session.error" => {
            if let Some(update) = convert_session_error_to_session_update(&envelope.properties) {
                dispatcher.enqueue(AcpUiEvent::session_update(update));
            } else {
                tracing::warn!(
                    event_type = %envelope.event_type,
                    properties = %envelope.properties,
                    "Failed to convert session.error to SessionUpdate"
                );
            }
        }

        // Message lifecycle events
        "message.removed" | "message.part.removed" => {
            dispatcher.enqueue(AcpUiEvent::json_event(
                "acp-message-removed",
                envelope.properties,
                session_id,
                AcpUiEventPriority::Normal,
                false,
            ));
        }

        // Permission events - convert to SessionUpdate
        "permission.asked" => {
            if let Some(update) = convert_permission_asked_to_session_update(&envelope.properties) {
                dispatcher.enqueue(AcpUiEvent::session_update(update));
            } else {
                tracing::warn!(
                    event_type = %envelope.event_type,
                    "Failed to convert permission.asked to SessionUpdate"
                );
            }
        }
        "permission.replied" => {
            dispatcher.enqueue(AcpUiEvent::json_event(
                "acp-permission-replied",
                envelope.properties,
                session_id,
                AcpUiEventPriority::High,
                false,
            ));
        }

        // Question events - convert to SessionUpdate
        "question.asked" => {
            if let Some(update) = convert_question_asked_to_session_update(&envelope.properties) {
                dispatcher.enqueue(AcpUiEvent::session_update(update));
            } else {
                tracing::warn!(
                    event_type = %envelope.event_type,
                    "Failed to convert question.asked to SessionUpdate"
                );
            }
        }
        "question.replied" | "question.rejected" => {
            dispatcher.enqueue(AcpUiEvent::json_event(
                "acp-question-replied",
                envelope.properties,
                session_id,
                AcpUiEventPriority::High,
                false,
            ));
        }

        // Todo events
        "todo.updated" => {
            dispatcher.enqueue(AcpUiEvent::json_event(
                "acp-todo-update",
                envelope.properties,
                session_id,
                AcpUiEventPriority::Normal,
                false,
            ));
        }

        // Informational events (no frontend action required)
        "server.connected" | "server.heartbeat" | "file.watcher.updated" => {
            tracing::trace!(event_type = %envelope.event_type, "Informational SSE event");
        }

        _ => {
            tracing::debug!(event_type = %envelope.event_type, "Unhandled SSE event type");
        }
    }

    Ok(())
}
