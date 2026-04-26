use crate::acp::client_loop::BatcherWithGuard;
use crate::acp::client_message_ids::normalize_message_id;
use crate::acp::non_streaming_batcher::NonStreamingEventBatcher;
use crate::acp::parsers::AgentType;
use crate::acp::provider::{prepare_session_updates_for_dispatch, AgentProvider};
use crate::acp::session_update::SessionUpdate;
use crate::acp::session_update_parser::{
    parse_session_update_notification_with_provider, ParseResult,
};
use crate::acp::streaming_log::{log_emitted_event, log_streaming_event};
use crate::acp::task_reconciler::{ReconcilerOutput, TaskReconciler};
use crate::acp::ui_event_dispatcher::{AcpUiEvent, AcpUiEventDispatcher};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc as StdArc;

mod plan;
mod reconciler;

pub(crate) use reconciler::process_through_reconciler;

#[allow(clippy::too_many_arguments)]
pub(crate) async fn handle_session_update_notification(
    dispatcher: &AcpUiEventDispatcher,
    agent_type: AgentType,
    provider: Option<&dyn AgentProvider>,
    message_id_tracker: &StdArc<std::sync::Mutex<HashMap<String, String>>>,
    task_reconciler: &StdArc<std::sync::Mutex<TaskReconciler>>,
    streaming_batcher: &mut BatcherWithGuard,
    non_streaming_batcher: &mut NonStreamingEventBatcher,
    json: &Value,
) {
    match parse_session_update_notification_with_provider(agent_type, provider, json) {
        ParseResult::Typed(update) => {
            let updates_to_emit = prepare_session_updates_for_dispatch(
                provider,
                agent_type,
                *update,
                task_reconciler,
            )
            .await;

            // Log raw streaming data for debugging (dev only)
            if let Some(session_id) = updates_to_emit
                .first()
                .and_then(crate::acp::session_update::SessionUpdate::session_id)
            {
                log_streaming_event(session_id, json);
            }

            for normalized_update in updates_to_emit {
                // Route AvailableCommandsUpdate through non-streaming batcher to prevent
                // JS event loop saturation from large command payloads (~19KB with 80+ commands)
                if matches!(
                    &normalized_update,
                    SessionUpdate::AvailableCommandsUpdate { .. }
                ) {
                    let session_key = normalized_update
                        .session_id()
                        .unwrap_or("unknown")
                        .to_string();
                    for batched_update in
                        non_streaming_batcher.process(&session_key, normalized_update)
                    {
                        log_emitted_event(&session_key, &batched_update);
                        dispatcher.enqueue(AcpUiEvent::session_update(batched_update));
                    }
                    continue;
                }

                // Assign a stable per-turn message id. Provider-specific
                // replay handling (if ever needed) lives at the provider edge,
                // not here — see client_message_ids.rs.
                let normalized_update = match message_id_tracker.lock() {
                    Ok(mut tracker) => normalize_message_id(normalized_update, &mut tracker),
                    Err(_) => normalized_update,
                };

                // Use batcher for streaming deltas
                for batched_update in streaming_batcher.process(normalized_update) {
                    let sid = batched_update.session_id().unwrap_or("unknown").to_string();
                    log_emitted_event(&sid, &batched_update);
                    dispatcher.enqueue(AcpUiEvent::session_update(batched_update));
                }
            }
        }
        ParseResult::Raw {
            params,
            error,
            session_id,
            update_type,
        } => {
            // Log raw streaming data for debugging (dev only)
            log_streaming_event(&session_id, json);

            let keys: Vec<&str> = params
                .as_object()
                .map(|o| o.keys().map(String::as_str).collect())
                .unwrap_or_default();
            tracing::error!(
                agent = ?agent_type,
                session_id = %session_id,
                update_type = %update_type,
                error = %error,
                top_level_keys = ?keys,
                "Failed to parse session update; dropping raw transport payload"
            );
        }
        ParseResult::NotSessionUpdate => {
            // Not a session update - nothing to do
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::domain_events::SessionDomainEventKind;
    use crate::acp::providers::cursor::CursorProvider;
    use crate::acp::providers::cursor_session_update_enrichment;
    use crate::acp::session_update::ToolArguments;
    use crate::acp::ui_event_dispatcher::AcpUiEventPayload;
    use serde_json::json;

    #[test]
    fn shared_update_processing_delegates_session_enrichment_to_provider() {
        let source = include_str!("mod.rs");
        let production_source = source.split("#[cfg(test)]").next().unwrap_or(source);

        assert!(production_source.contains("prepare_session_updates_for_dispatch("));
        assert!(!production_source.contains(".enrich_session_update("));
        assert!(!production_source.contains(".uses_task_reconciler("));
        assert!(!production_source.contains("None => process_through_reconciler("));
    }

    #[tokio::test]
    async fn malformed_session_update_does_not_emit_raw_transport_payload() {
        let (dispatcher, captured_events) = AcpUiEventDispatcher::test_sink();
        let message_id_tracker = StdArc::new(std::sync::Mutex::new(HashMap::new()));
        let task_reconciler = StdArc::new(std::sync::Mutex::new(TaskReconciler::new()));
        let mut streaming_batcher = BatcherWithGuard::new_for_tests(
            dispatcher.clone(),
            StdArc::new(std::sync::atomic::AtomicBool::new(false)),
        );
        let mut non_streaming_batcher = NonStreamingEventBatcher::new();

        let notification = json!({
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {
                "sessionId": "session-raw",
                "update": {
                    "sessionUpdate": "toolCall",
                    "toolCallId": 42
                }
            }
        });

        handle_session_update_notification(
            &dispatcher,
            AgentType::ClaudeCode,
            None,
            &message_id_tracker,
            &task_reconciler,
            &mut streaming_batcher,
            &mut non_streaming_batcher,
            &notification,
        )
        .await;

        let captured = captured_events.lock().expect("captured events lock");
        assert!(captured.is_empty());
    }

    #[tokio::test]
    async fn turn_complete_notification_emits_canonical_domain_event() {
        let session_id = "turn-complete-session";
        let (dispatcher, captured_events) = AcpUiEventDispatcher::test_sink();
        let message_id_tracker = StdArc::new(std::sync::Mutex::new(HashMap::new()));
        let task_reconciler = StdArc::new(std::sync::Mutex::new(TaskReconciler::new()));
        let mut streaming_batcher = BatcherWithGuard::new_for_tests(
            dispatcher.clone(),
            StdArc::new(std::sync::atomic::AtomicBool::new(false)),
        );
        let mut non_streaming_batcher = NonStreamingEventBatcher::new();

        let notification = json!({
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {
                "sessionId": session_id,
                "update": {
                    "sessionUpdate": "turnComplete"
                }
            }
        });

        handle_session_update_notification(
            &dispatcher,
            AgentType::ClaudeCode,
            None,
            &message_id_tracker,
            &task_reconciler,
            &mut streaming_batcher,
            &mut non_streaming_batcher,
            &notification,
        )
        .await;

        let captured = captured_events.lock().expect("captured events lock");
        assert_eq!(captured.len(), 2);

        match &captured[0].payload {
            AcpUiEventPayload::SessionUpdate(update) => match update.as_ref() {
                SessionUpdate::TurnComplete {
                    session_id: emitted,
                    turn_id,
                } => {
                    assert_eq!(emitted.as_deref(), Some(session_id));
                    assert_eq!(turn_id, &None);
                }
                other => panic!("Expected turn complete update, got {:?}", other),
            },
            other => panic!("Expected session update payload, got {:?}", other),
        }

        match &captured[1].payload {
            AcpUiEventPayload::SessionDomainEvent(event) => {
                assert_eq!(event.session_id, session_id);
                assert!(matches!(event.kind, SessionDomainEventKind::TurnCompleted));
                assert_eq!(event.seq, 1);
                assert!(!event.event_id.is_empty());
                assert!(event.occurred_at_ms > 0);
                assert_eq!(event.provider_session_id, None);
                assert_eq!(event.causation_id, None);
            }
            other => panic!("Expected session domain event payload, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn turn_error_notification_emits_canonical_domain_event() {
        let session_id = "turn-error-session";
        let (dispatcher, captured_events) = AcpUiEventDispatcher::test_sink();
        let message_id_tracker = StdArc::new(std::sync::Mutex::new(HashMap::new()));
        let task_reconciler = StdArc::new(std::sync::Mutex::new(TaskReconciler::new()));
        let mut streaming_batcher = BatcherWithGuard::new_for_tests(
            dispatcher.clone(),
            StdArc::new(std::sync::atomic::AtomicBool::new(false)),
        );
        let mut non_streaming_batcher = NonStreamingEventBatcher::new();

        let notification = json!({
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {
                "sessionId": session_id,
                "update": {
                    "sessionUpdate": "turnError",
                    "turnId": "turn-7",
                    "error": {
                        "message": "boom",
                        "kind": "fatal",
                        "source": "process"
                    }
                }
            }
        });

        handle_session_update_notification(
            &dispatcher,
            AgentType::ClaudeCode,
            None,
            &message_id_tracker,
            &task_reconciler,
            &mut streaming_batcher,
            &mut non_streaming_batcher,
            &notification,
        )
        .await;

        let captured = captured_events.lock().expect("captured events lock");
        assert_eq!(captured.len(), 2);

        match &captured[0].payload {
            AcpUiEventPayload::SessionUpdate(update) => match update.as_ref() {
                SessionUpdate::TurnError {
                    session_id: emitted,
                    turn_id,
                    ..
                } => {
                    assert_eq!(emitted.as_deref(), Some(session_id));
                    assert_eq!(turn_id.as_deref(), Some("turn-7"));
                }
                other => panic!("Expected turn error update, got {:?}", other),
            },
            other => panic!("Expected session update payload, got {:?}", other),
        }

        match &captured[1].payload {
            AcpUiEventPayload::SessionDomainEvent(event) => {
                assert_eq!(event.session_id, session_id);
                assert!(matches!(event.kind, SessionDomainEventKind::TurnFailed));
                assert_eq!(event.seq, 1);
                assert!(!event.event_id.is_empty());
            }
            other => panic!("Expected session domain event payload, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn live_cursor_tool_call_update_is_enriched_before_dispatch() {
        let expected_session_id = "cursor-live-session";
        let tool_call_id = "tool-edit-1";

        cursor_session_update_enrichment::seed_test_tool_use_cache(
            expected_session_id,
            tool_call_id,
            "Edit",
            json!({
                "file_path": "/tmp/live.rs",
                "old_string": "const value = 1;",
                "new_string": "const value = 2;"
            }),
        );

        let (dispatcher, captured_events) = AcpUiEventDispatcher::test_sink();
        let provider = CursorProvider;
        let message_id_tracker = StdArc::new(std::sync::Mutex::new(HashMap::new()));
        let task_reconciler = StdArc::new(std::sync::Mutex::new(TaskReconciler::new()));
        let mut streaming_batcher = BatcherWithGuard::new_for_tests(
            dispatcher.clone(),
            StdArc::new(std::sync::atomic::AtomicBool::new(false)),
        );
        let mut non_streaming_batcher = NonStreamingEventBatcher::new();

        let notification = json!({
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {
                "sessionId": expected_session_id,
                "update": {
                    "sessionUpdate": "tool_call_update",
                    "toolCallId": tool_call_id,
                    "status": "completed",
                    "title": "Edit File",
                    "rawInput": {},
                    "rawOutput": { "applied": true }
                }
            }
        });

        handle_session_update_notification(
            &dispatcher,
            AgentType::Cursor,
            Some(&provider),
            &message_id_tracker,
            &task_reconciler,
            &mut streaming_batcher,
            &mut non_streaming_batcher,
            &notification,
        )
        .await;

        let captured = captured_events.lock().expect("captured events lock");
        let session_updates: Vec<_> = captured
            .iter()
            .filter(|e| matches!(e.payload, AcpUiEventPayload::SessionUpdate(_)))
            .collect();
        assert_eq!(session_updates.len(), 1);

        match &session_updates[0].payload {
            AcpUiEventPayload::SessionUpdate(update) => match update.as_ref() {
                SessionUpdate::ToolCallUpdate { update, session_id } => {
                    assert_eq!(session_id.as_deref(), Some(expected_session_id));
                    assert_eq!(update.tool_call_id, tool_call_id);
                    assert_eq!(update.title.as_deref(), Some("Edit /tmp/live.rs"));
                    assert_eq!(update.locations.as_ref().map(Vec::len), Some(1));

                    match update.arguments.as_ref() {
                        Some(ToolArguments::Edit { edits }) => {
                            let e = edits.first().expect("edit entry");
                            assert_eq!(e.file_path.as_deref(), Some("/tmp/live.rs"));
                            assert_eq!(e.old_string.as_deref(), Some("const value = 1;"));
                            assert_eq!(e.new_string.as_deref(), Some("const value = 2;"));
                        }
                        other => panic!("Expected edit arguments, got {:?}", other),
                    }
                }
                other => panic!("Expected tool call update, got {:?}", other),
            },
            other => panic!("Expected session update payload, got {:?}", other),
        }

        drop(captured);
        cursor_session_update_enrichment::clear_test_tool_use_cache(expected_session_id);
    }

    #[tokio::test]
    async fn live_cursor_rename_tool_call_update_is_enriched_before_dispatch() {
        let expected_session_id = "cursor-live-rename-session";
        let tool_call_id = "tool-rename-1";

        cursor_session_update_enrichment::seed_test_tool_use_cache(
            expected_session_id,
            tool_call_id,
            "Edit",
            json!({
                "file_path": "/tmp/new.rs",
                "move_from": "/tmp/old.rs"
            }),
        );

        let (dispatcher, captured_events) = AcpUiEventDispatcher::test_sink();
        let provider = CursorProvider;
        let message_id_tracker = StdArc::new(std::sync::Mutex::new(HashMap::new()));
        let task_reconciler = StdArc::new(std::sync::Mutex::new(TaskReconciler::new()));
        let mut streaming_batcher = BatcherWithGuard::new_for_tests(
            dispatcher.clone(),
            StdArc::new(std::sync::atomic::AtomicBool::new(false)),
        );
        let mut non_streaming_batcher = NonStreamingEventBatcher::new();

        let notification = json!({
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {
                "sessionId": expected_session_id,
                "update": {
                    "sessionUpdate": "tool_call_update",
                    "toolCallId": tool_call_id,
                    "status": "completed",
                    "title": "Edit File",
                    "rawInput": {},
                    "rawOutput": { "applied": true }
                }
            }
        });

        handle_session_update_notification(
            &dispatcher,
            AgentType::Cursor,
            Some(&provider),
            &message_id_tracker,
            &task_reconciler,
            &mut streaming_batcher,
            &mut non_streaming_batcher,
            &notification,
        )
        .await;

        let captured = captured_events.lock().expect("captured events lock");
        let session_updates: Vec<_> = captured
            .iter()
            .filter(|e| matches!(e.payload, AcpUiEventPayload::SessionUpdate(_)))
            .collect();
        assert_eq!(session_updates.len(), 1);

        match &session_updates[0].payload {
            AcpUiEventPayload::SessionUpdate(update) => match update.as_ref() {
                SessionUpdate::ToolCallUpdate { update, session_id } => {
                    assert_eq!(session_id.as_deref(), Some(expected_session_id));
                    assert_eq!(update.tool_call_id, tool_call_id);
                    assert_eq!(
                        update.title.as_deref(),
                        Some("Rename /tmp/old.rs -> /tmp/new.rs")
                    );
                    assert_eq!(update.locations.as_ref().map(Vec::len), Some(1));

                    match update.arguments.as_ref() {
                        Some(ToolArguments::Edit { edits }) => {
                            let edit = edits.first().expect("edit entry");
                            assert_eq!(edit.file_path.as_deref(), Some("/tmp/new.rs"));
                            assert_eq!(edit.move_from.as_deref(), Some("/tmp/old.rs"));
                        }
                        other => panic!("Expected edit arguments, got {:?}", other),
                    }
                }
                other => panic!("Expected tool call update, got {:?}", other),
            },
            other => panic!("Expected session update payload, got {:?}", other),
        }

        drop(captured);
        cursor_session_update_enrichment::clear_test_tool_use_cache(expected_session_id);
    }

    #[tokio::test]
    async fn live_cursor_tool_call_sequence_is_enriched_before_dispatch() {
        let expected_session_id = "cursor-live-sequence";
        let tool_call_id = "tool-edit-sequence";

        cursor_session_update_enrichment::seed_test_tool_use_cache(
            expected_session_id,
            tool_call_id,
            "Edit",
            json!({
                "file_path": "/tmp/sequence.rs",
                "old_string": "let count = 1;",
                "new_string": "let count = 2;"
            }),
        );

        let (dispatcher, captured_events) = AcpUiEventDispatcher::test_sink();
        let provider = CursorProvider;
        let message_id_tracker = StdArc::new(std::sync::Mutex::new(HashMap::new()));
        let task_reconciler = StdArc::new(std::sync::Mutex::new(TaskReconciler::new()));
        let mut streaming_batcher = BatcherWithGuard::new_for_tests(
            dispatcher.clone(),
            StdArc::new(std::sync::atomic::AtomicBool::new(false)),
        );
        let mut non_streaming_batcher = NonStreamingEventBatcher::new();

        let tool_call_notification = json!({
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {
                "sessionId": expected_session_id,
                "update": {
                    "sessionUpdate": "tool_call",
                    "toolCallId": tool_call_id,
                    "kind": "edit",
                    "status": "pending",
                    "title": "Edit File",
                    "rawInput": {}
                }
            }
        });

        let tool_call_update_notification = json!({
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {
                "sessionId": expected_session_id,
                "update": {
                    "sessionUpdate": "tool_call_update",
                    "toolCallId": tool_call_id,
                    "status": "completed",
                    "title": "Edit File",
                    "rawInput": {},
                    "rawOutput": { "applied": true }
                }
            }
        });

        handle_session_update_notification(
            &dispatcher,
            AgentType::Cursor,
            Some(&provider),
            &message_id_tracker,
            &task_reconciler,
            &mut streaming_batcher,
            &mut non_streaming_batcher,
            &tool_call_notification,
        )
        .await;

        handle_session_update_notification(
            &dispatcher,
            AgentType::Cursor,
            Some(&provider),
            &message_id_tracker,
            &task_reconciler,
            &mut streaming_batcher,
            &mut non_streaming_batcher,
            &tool_call_update_notification,
        )
        .await;

        let captured = captured_events.lock().expect("captured events lock");
        let session_updates: Vec<_> = captured
            .iter()
            .filter(|e| matches!(e.payload, AcpUiEventPayload::SessionUpdate(_)))
            .collect();
        assert_eq!(session_updates.len(), 2);

        match &session_updates[0].payload {
            AcpUiEventPayload::SessionUpdate(update) => match update.as_ref() {
                SessionUpdate::ToolCall {
                    tool_call,
                    session_id,
                } => {
                    assert_eq!(session_id.as_deref(), Some(expected_session_id));
                    assert_eq!(tool_call.id, tool_call_id);
                    assert_eq!(tool_call.title.as_deref(), Some("Edit /tmp/sequence.rs"));
                    assert_eq!(tool_call.locations.as_ref().map(Vec::len), Some(1));

                    match &tool_call.arguments {
                        ToolArguments::Edit { edits } => {
                            let e = edits.first().expect("edit entry");
                            assert_eq!(e.file_path.as_deref(), Some("/tmp/sequence.rs"));
                            assert_eq!(e.old_string.as_deref(), Some("let count = 1;"));
                            assert_eq!(e.new_string.as_deref(), Some("let count = 2;"));
                        }
                        other => panic!("Expected edit tool call arguments, got {:?}", other),
                    }
                }
                other => panic!("Expected tool call, got {:?}", other),
            },
            other => panic!("Expected session update payload, got {:?}", other),
        }

        match &session_updates[1].payload {
            AcpUiEventPayload::SessionUpdate(update) => match update.as_ref() {
                SessionUpdate::ToolCallUpdate { update, session_id } => {
                    assert_eq!(session_id.as_deref(), Some(expected_session_id));
                    assert_eq!(update.tool_call_id, tool_call_id);
                    assert_eq!(update.title.as_deref(), Some("Edit /tmp/sequence.rs"));
                    assert_eq!(update.locations.as_ref().map(Vec::len), Some(1));
                    assert!(matches!(
                        update.status,
                        Some(crate::acp::session_update::ToolCallStatus::Completed)
                    ));

                    match update.arguments.as_ref() {
                        Some(ToolArguments::Edit { edits }) => {
                            let e = edits.first().expect("edit entry");
                            assert_eq!(e.file_path.as_deref(), Some("/tmp/sequence.rs"));
                            assert_eq!(e.old_string.as_deref(), Some("let count = 1;"));
                            assert_eq!(e.new_string.as_deref(), Some("let count = 2;"));
                        }
                        other => panic!("Expected edit tool update arguments, got {:?}", other),
                    }
                }
                other => panic!("Expected tool call update, got {:?}", other),
            },
            other => panic!("Expected session update payload, got {:?}", other),
        }

        drop(captured);
        cursor_session_update_enrichment::clear_test_tool_use_cache(expected_session_id);
    }

    #[tokio::test]
    async fn live_cursor_read_tool_call_sequence_is_enriched_before_dispatch() {
        let expected_session_id = "cursor-live-read-sequence";
        let tool_call_id = "tool-read-sequence";

        cursor_session_update_enrichment::seed_test_tool_use_cache(
            expected_session_id,
            tool_call_id,
            "Read",
            json!({
                "file_path": "/tmp/read-sequence.rs"
            }),
        );

        let (dispatcher, captured_events) = AcpUiEventDispatcher::test_sink();
        let provider = CursorProvider;
        let message_id_tracker = StdArc::new(std::sync::Mutex::new(HashMap::new()));
        let task_reconciler = StdArc::new(std::sync::Mutex::new(TaskReconciler::new()));
        let mut streaming_batcher = BatcherWithGuard::new_for_tests(
            dispatcher.clone(),
            StdArc::new(std::sync::atomic::AtomicBool::new(false)),
        );
        let mut non_streaming_batcher = NonStreamingEventBatcher::new();

        let tool_call_notification = json!({
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {
                "sessionId": expected_session_id,
                "update": {
                    "sessionUpdate": "tool_call",
                    "toolCallId": tool_call_id,
                    "kind": "read",
                    "status": "pending",
                    "title": "Read File",
                    "rawInput": {}
                }
            }
        });

        let tool_call_update_notification = json!({
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {
                "sessionId": expected_session_id,
                "update": {
                    "sessionUpdate": "tool_call_update",
                    "toolCallId": tool_call_id,
                    "status": "completed",
                    "title": "Read File",
                    "rawInput": {},
                    "rawOutput": {
                        "content": "fn main() {}"
                    }
                }
            }
        });

        handle_session_update_notification(
            &dispatcher,
            AgentType::Cursor,
            Some(&provider),
            &message_id_tracker,
            &task_reconciler,
            &mut streaming_batcher,
            &mut non_streaming_batcher,
            &tool_call_notification,
        )
        .await;

        handle_session_update_notification(
            &dispatcher,
            AgentType::Cursor,
            Some(&provider),
            &message_id_tracker,
            &task_reconciler,
            &mut streaming_batcher,
            &mut non_streaming_batcher,
            &tool_call_update_notification,
        )
        .await;

        let captured = captured_events.lock().expect("captured events lock");
        let session_updates: Vec<_> = captured
            .iter()
            .filter(|e| matches!(e.payload, AcpUiEventPayload::SessionUpdate(_)))
            .collect();
        assert_eq!(session_updates.len(), 2);

        match &session_updates[0].payload {
            AcpUiEventPayload::SessionUpdate(update) => match update.as_ref() {
                SessionUpdate::ToolCall {
                    tool_call,
                    session_id,
                } => {
                    assert_eq!(session_id.as_deref(), Some(expected_session_id));
                    assert_eq!(tool_call.id, tool_call_id);
                    assert_eq!(
                        tool_call.title.as_deref(),
                        Some("Read /tmp/read-sequence.rs")
                    );
                    assert_eq!(tool_call.locations.as_ref().map(Vec::len), Some(1));

                    match &tool_call.arguments {
                        ToolArguments::Read { file_path, .. } => {
                            assert_eq!(file_path.as_deref(), Some("/tmp/read-sequence.rs"));
                        }
                        other => panic!("Expected read tool call arguments, got {:?}", other),
                    }
                }
                other => panic!("Expected tool call, got {:?}", other),
            },
            other => panic!("Expected session update payload, got {:?}", other),
        }

        match &session_updates[1].payload {
            AcpUiEventPayload::SessionUpdate(update) => match update.as_ref() {
                SessionUpdate::ToolCallUpdate { update, session_id } => {
                    assert_eq!(session_id.as_deref(), Some(expected_session_id));
                    assert_eq!(update.tool_call_id, tool_call_id);
                    assert_eq!(update.title.as_deref(), Some("Read /tmp/read-sequence.rs"));
                    assert_eq!(update.locations.as_ref().map(Vec::len), Some(1));
                    assert!(matches!(
                        update.status,
                        Some(crate::acp::session_update::ToolCallStatus::Completed)
                    ));

                    match update.arguments.as_ref() {
                        Some(ToolArguments::Read { file_path, .. }) => {
                            assert_eq!(file_path.as_deref(), Some("/tmp/read-sequence.rs"));
                        }
                        other => panic!("Expected read tool update arguments, got {:?}", other),
                    }
                }
                other => panic!("Expected tool call update, got {:?}", other),
            },
            other => panic!("Expected session update payload, got {:?}", other),
        }

        drop(captured);
        cursor_session_update_enrichment::clear_test_tool_use_cache(expected_session_id);
    }

    /// Regression: when the assistant emits the **same text** in two
    /// consecutive turns, both chunks must be dispatched. The previous
    /// implementation deduped on text equality inside shared id
    /// normalization, which silently dropped legitimate replies for
    /// Cursor and Copilot whenever the assistant repeated itself
    /// (e.g. answering "ok" twice). Provider-specific replay handling, if
    /// ever needed, must live at the provider edge — never in shared core.
    ///
    /// This test mirrors the production flow used by subprocess-backed
    /// providers: `session/update` notifications carry the chunks, and the
    /// turn boundary is signalled by a JSON-RPC response that drives
    /// `streaming_batcher.process_turn_complete` directly (see
    /// `client_loop.rs`).
    async fn assert_repeated_assistant_text_passes_through(agent_type: AgentType) {
        let session_id = "repeat-text-session";
        let (dispatcher, captured_events) = AcpUiEventDispatcher::test_sink();
        let message_id_tracker = StdArc::new(std::sync::Mutex::new(HashMap::new()));
        let task_reconciler = StdArc::new(std::sync::Mutex::new(TaskReconciler::new()));
        let mut streaming_batcher = BatcherWithGuard::new_for_tests(
            dispatcher.clone(),
            StdArc::new(std::sync::atomic::AtomicBool::new(false)),
        );
        let mut non_streaming_batcher = NonStreamingEventBatcher::new();

        let agent_message_chunk = |text: &str| {
            json!({
                "jsonrpc": "2.0",
                "method": "session/update",
                "params": {
                    "sessionId": session_id,
                    "update": {
                        "sessionUpdate": "agentMessageChunk",
                        "content": { "type": "text", "text": text }
                    }
                }
            })
        };

        let dispatch_turn_complete =
            |dispatcher: &AcpUiEventDispatcher, batcher: &mut BatcherWithGuard| {
                let updates = batcher.process_turn_complete(session_id, None);
                for update in updates {
                    dispatcher.enqueue(AcpUiEvent::session_update(update));
                }
            };

        // Turn 1: assistant says "ok"
        handle_session_update_notification(
            &dispatcher,
            agent_type,
            None,
            &message_id_tracker,
            &task_reconciler,
            &mut streaming_batcher,
            &mut non_streaming_batcher,
            &agent_message_chunk("ok"),
        )
        .await;
        dispatch_turn_complete(&dispatcher, &mut streaming_batcher);

        // Turn 2: assistant says "ok" again — must NOT be dropped.
        handle_session_update_notification(
            &dispatcher,
            agent_type,
            None,
            &message_id_tracker,
            &task_reconciler,
            &mut streaming_batcher,
            &mut non_streaming_batcher,
            &agent_message_chunk("ok"),
        )
        .await;
        dispatch_turn_complete(&dispatcher, &mut streaming_batcher);

        let captured = captured_events.lock().expect("captured events lock");
        let assistant_chunks = captured
            .iter()
            .filter_map(|event| match &event.payload {
                AcpUiEventPayload::SessionUpdate(update) => match update.as_ref() {
                    SessionUpdate::AgentMessageChunk { chunk, .. } => match &chunk.content {
                        crate::acp::types::ContentBlock::Text { text } => Some(text.clone()),
                        _ => None,
                    },
                    _ => None,
                },
                _ => None,
            })
            .collect::<Vec<_>>();

        assert_eq!(
            assistant_chunks,
            vec!["ok".to_string(), "ok".to_string()],
            "{:?}: shared id normalization must not drop repeated assistant text across turns",
            agent_type
        );
    }

    #[tokio::test]
    async fn claude_code_repeated_assistant_text_across_turns_is_not_dropped() {
        assert_repeated_assistant_text_passes_through(AgentType::ClaudeCode).await;
    }

    #[tokio::test]
    async fn cursor_repeated_assistant_text_across_turns_is_not_dropped() {
        assert_repeated_assistant_text_passes_through(AgentType::Cursor).await;
    }

    #[tokio::test]
    async fn copilot_repeated_assistant_text_across_turns_is_not_dropped() {
        assert_repeated_assistant_text_passes_through(AgentType::Copilot).await;
    }
}
