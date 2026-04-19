use crate::acp::client_loop::BatcherWithGuard;
use crate::acp::client_message_ids::normalize_message_id;
use crate::acp::non_streaming_batcher::NonStreamingEventBatcher;
use crate::acp::parsers::AgentType;
use crate::acp::provider::AgentProvider;
use crate::acp::session_update::{PlanConfidence, PlanData, PlanSource, SessionUpdate};
use crate::acp::session_update_parser::{
    parse_session_update_notification_with_agent, ParseResult,
};
use crate::acp::streaming_log::{log_emitted_event, log_streaming_event};
use crate::acp::task_reconciler::{ReconcilerOutput, TaskReconciler};
use crate::acp::ui_event_dispatcher::{AcpUiEvent, AcpUiEventDispatcher, AcpUiEventPriority};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc as StdArc;

mod plan;
mod reconciler;

use plan::{enrich_plan_data, enrich_plan_update, extract_streaming_plan};
pub(crate) use reconciler::process_through_reconciler;

#[allow(clippy::too_many_arguments)]
pub(crate) async fn handle_session_update_notification(
    dispatcher: &AcpUiEventDispatcher,
    agent_type: AgentType,
    provider: Option<&dyn AgentProvider>,
    message_id_tracker: &StdArc<std::sync::Mutex<HashMap<String, String>>>,
    assistant_text_tracker: &StdArc<std::sync::Mutex<HashMap<String, String>>>,
    task_reconciler: &StdArc<std::sync::Mutex<TaskReconciler>>,
    streaming_batcher: &mut BatcherWithGuard,
    non_streaming_batcher: &mut NonStreamingEventBatcher,
    json: &Value,
) {
    match parse_session_update_notification_with_agent(agent_type, json) {
        ParseResult::Typed(update) => {
            let update = match provider {
                Some(provider) => provider.enrich_session_update(*update).await,
                None => *update,
            };
            // Log raw streaming data for debugging (dev only)
            if let Some(session_id) = update.session_id() {
                log_streaming_event(session_id, json);
            }

            // Route AvailableCommandsUpdate through non-streaming batcher to prevent
            // JS event loop saturation from large command payloads (~19KB with 80+ commands)
            if matches!(&update, SessionUpdate::AvailableCommandsUpdate { .. }) {
                let session_key = update.session_id().unwrap_or("unknown").to_string();
                for batched_update in non_streaming_batcher.process(&session_key, update) {
                    log_emitted_event(&session_key, &batched_update);
                    dispatcher.enqueue(AcpUiEvent::session_update(batched_update));
                }
                return;
            }

            // Route through TaskReconciler when provider requires tool-call graph assembly.
            if provider.is_some_and(|provider| provider.uses_task_reconciler()) {
                let updates_to_emit =
                    process_through_reconciler(&update, task_reconciler, agent_type, provider);
                for reconciled_update in updates_to_emit {
                    let sid = reconciled_update
                        .session_id()
                        .unwrap_or("unknown")
                        .to_string();
                    // Use batcher for streaming deltas to coalesce rapid updates
                    for batched_update in streaming_batcher.process(reconciled_update) {
                        log_emitted_event(&sid, &batched_update);
                        dispatcher.enqueue(AcpUiEvent::session_update(batched_update));
                    }
                }
                return;
            }

            // Normalize message IDs and dedup replayed assistant messages
            let normalized_update = match (message_id_tracker.lock(), assistant_text_tracker.lock())
            {
                (Ok(mut tracker), Ok(mut assistant_tracker)) => {
                    match normalize_message_id(
                        agent_type,
                        update,
                        &mut tracker,
                        &mut assistant_tracker,
                    ) {
                        Some(u) => u,
                        None => return, // Replayed chunk — drop it
                    }
                }
                _ => update,
            };

            let normalized_update = enrich_plan_update(normalized_update, agent_type, provider);

            // Extract streaming plan before batching (it won't survive serialization)
            let streaming_plan = extract_streaming_plan(&normalized_update, agent_type, provider);

            // Use batcher for streaming deltas
            for batched_update in streaming_batcher.process(normalized_update) {
                let sid = batched_update.session_id().unwrap_or("unknown").to_string();
                log_emitted_event(&sid, &batched_update);
                dispatcher.enqueue(AcpUiEvent::session_update(batched_update));
            }

            // Emit Plan event if streaming plan data was present
            if let Some((plan, session_id)) = streaming_plan {
                let update = SessionUpdate::Plan { plan, session_id };
                let sid = update.session_id().unwrap_or("unknown").to_string();
                log_emitted_event(&sid, &update);
                dispatcher.enqueue(AcpUiEvent::session_update(update));
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
                "Failed to parse session update, falling back to raw emission"
            );
            dispatcher.enqueue(AcpUiEvent::json_event(
                "acp-session-update",
                params,
                Some(session_id),
                AcpUiEventPriority::Normal,
                true, // droppable: prevents event loop saturation on parse-failure cascades
            ));
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

        assert!(production_source.contains(".enrich_session_update("));
        assert!(!production_source.contains("cursor_tool_enrichment"));
    }

    #[tokio::test]
    async fn turn_complete_notification_emits_canonical_domain_event() {
        let session_id = "turn-complete-session";
        let (dispatcher, captured_events) = AcpUiEventDispatcher::test_sink();
        let message_id_tracker = StdArc::new(std::sync::Mutex::new(HashMap::new()));
        let assistant_text_tracker = StdArc::new(std::sync::Mutex::new(HashMap::new()));
        let task_reconciler = StdArc::new(std::sync::Mutex::new(TaskReconciler::new()));
        let mut streaming_batcher = BatcherWithGuard::new_for_tests(dispatcher.clone());
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
            &assistant_text_tracker,
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
        let assistant_text_tracker = StdArc::new(std::sync::Mutex::new(HashMap::new()));
        let task_reconciler = StdArc::new(std::sync::Mutex::new(TaskReconciler::new()));
        let mut streaming_batcher = BatcherWithGuard::new_for_tests(dispatcher.clone());
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
            &assistant_text_tracker,
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
        let assistant_text_tracker = StdArc::new(std::sync::Mutex::new(HashMap::new()));
        let task_reconciler = StdArc::new(std::sync::Mutex::new(TaskReconciler::new()));
        let mut streaming_batcher = BatcherWithGuard::new_for_tests(dispatcher.clone());
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
            &assistant_text_tracker,
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
        let assistant_text_tracker = StdArc::new(std::sync::Mutex::new(HashMap::new()));
        let task_reconciler = StdArc::new(std::sync::Mutex::new(TaskReconciler::new()));
        let mut streaming_batcher = BatcherWithGuard::new_for_tests(dispatcher.clone());
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
            &assistant_text_tracker,
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
        let assistant_text_tracker = StdArc::new(std::sync::Mutex::new(HashMap::new()));
        let task_reconciler = StdArc::new(std::sync::Mutex::new(TaskReconciler::new()));
        let mut streaming_batcher = BatcherWithGuard::new_for_tests(dispatcher.clone());
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
            &assistant_text_tracker,
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
            &assistant_text_tracker,
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
        let assistant_text_tracker = StdArc::new(std::sync::Mutex::new(HashMap::new()));
        let task_reconciler = StdArc::new(std::sync::Mutex::new(TaskReconciler::new()));
        let mut streaming_batcher = BatcherWithGuard::new_for_tests(dispatcher.clone());
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
            &assistant_text_tracker,
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
            &assistant_text_tracker,
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
}
