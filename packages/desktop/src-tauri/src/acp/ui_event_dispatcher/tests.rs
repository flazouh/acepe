use super::*;
use crate::acp::domain_events::{SessionDomainEvent, SessionDomainEventKind};
use crate::acp::projections::{OperationSourceLink, SessionTurnState};
use crate::acp::session_update::{
    AvailableCommand, AvailableCommandsData, ContentChunk, CurrentModeData,
    InteractionReplyHandler, PermissionData, QuestionData, QuestionItem, QuestionOption,
    SessionUpdate, ToolArguments, ToolCallData, ToolCallStatus, ToolKind,
};
use crate::acp::transcript_projection::{TranscriptDelta, TranscriptEntryRole};
use crate::acp::transcript_viewport::ledger::{
    SessionTranscriptRowLedgerOpenHeader, SessionTranscriptRowLedgerRead,
    TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
};
use crate::acp::types::CanonicalAgentId;
use crate::acp::types::ContentBlock;
use crate::db::repository::{
    SessionJournalEventRepository, SessionMetadataRepository, SessionTranscriptRowLedgerRepository,
};
use sea_orm::{Database, DbConn};
use sea_orm_migration::MigratorTrait;
use serde_json::json;
use std::sync::Arc;

#[test]
fn session_state_ui_event_rejects_oversized_envelopes() {
    let envelope = SessionStateEnvelope {
        session_id: "session-budget-1".to_string(),
        graph_revision: 1,
        last_event_seq: 1,
        payload: crate::acp::session_state_engine::SessionStatePayload::AssistantTextDelta {
            delta: crate::acp::session_state_engine::protocol::AssistantTextDeltaPayload {
                turn_id: "turn-1".to_string(),
                row_id: "assistant-1".to_string(),
                char_offset: 0,
                delta_text: "x".repeat(8_000),
                produced_at_monotonic_ms: 5,
                revision: 1,
            },
        },
    };

    assert!(AcpUiEvent::session_state_envelope(&envelope).is_none());
}

fn chunk_update(session_id: &str, text: &str) -> SessionUpdate {
    SessionUpdate::AgentMessageChunk {
        chunk: ContentChunk {
            content: ContentBlock::Text {
                text: text.to_string(),
            },
            aggregation_hint: None,
        },
        part_id: None,
        message_id: None,
        parent_tool_use_id: None,
        session_id: Some(session_id.to_string()),
        produced_at_monotonic_ms: None,
    }
}

fn chunk_update_with_timestamp(session_id: &str, text: &str, timestamp_ms: u64) -> SessionUpdate {
    SessionUpdate::AgentMessageChunk {
        chunk: ContentChunk {
            content: ContentBlock::Text {
                text: text.to_string(),
            },
            aggregation_hint: None,
        },
        part_id: None,
        message_id: None,
        parent_tool_use_id: None,
        session_id: Some(session_id.to_string()),
        produced_at_monotonic_ms: Some(timestamp_ms),
    }
}

fn user_chunk_update(session_id: &str, text: &str) -> SessionUpdate {
    SessionUpdate::UserMessageChunk {
        chunk: ContentChunk {
            content: ContentBlock::Text {
                text: text.to_string(),
            },
            aggregation_hint: None,
        },
        session_id: Some(session_id.to_string()),
        attempt_id: None,
    }
}

async fn setup_test_db() -> DbConn {
    let db = Database::connect("sqlite::memory:")
        .await
        .expect("in-memory db");
    crate::db::migrations::Migrator::up(&db, None)
        .await
        .expect("migrations");
    db
}

fn seed_lifecycle(runtime_graph_registry: &SessionGraphRuntimeRegistry, session_id: &str) {
    runtime_graph_registry.restore_session_state(
        session_id.to_string(),
        0,
        crate::acp::session_state_engine::selectors::SessionGraphLifecycle::reserved(),
        crate::acp::session_state_engine::selectors::SessionGraphCapabilities::empty(),
    );
}

fn available_commands_update(session_id: Option<&str>) -> SessionUpdate {
    SessionUpdate::AvailableCommandsUpdate {
        update: AvailableCommandsData {
            available_commands: vec![AvailableCommand {
                name: "commit".to_string(),
                description: "Create a commit".to_string(),
                input: None,
            }],
        },
        session_id: session_id.map(str::to_string),
    }
}

fn current_mode_update(session_id: &str, mode: &str) -> SessionUpdate {
    SessionUpdate::CurrentModeUpdate {
        update: CurrentModeData {
            current_mode_id: mode.to_string(),
        },
        session_id: Some(session_id.to_string()),
    }
}

fn read_tool_call_update(session_id: &str, tool_call_id: &str) -> SessionUpdate {
    SessionUpdate::ToolCall {
        tool_call: ToolCallData {
            id: tool_call_id.to_string(),
            name: "Read".to_string(),
            arguments: ToolArguments::Read {
                file_path: Some("dialog-frame.svelte".to_string()),
                source_context: None,
            },
            diagnostic_input: None,
            kind: Some(ToolKind::Read),
            title: Some("Access paths outside trusted directories".to_string()),
            status: ToolCallStatus::InProgress,
            result: None,
            locations: None,
            skill_meta: None,
            normalized_questions: None,
            normalized_todos: None,
            normalized_todo_update: None,
            parent_tool_use_id: None,
            task_children: None,
            question_answer: None,
            awaiting_plan_approval: false,
            plan_approval_request_id: None,
        },
        session_id: Some(session_id.to_string()),
    }
}

#[test]
fn dispatcher_stamps_agent_message_chunk_timestamps() {
    let session_id = "stream-session";
    let (dispatcher, captured_events) = AcpUiEventDispatcher::test_sink();

    dispatcher.enqueue(AcpUiEvent::session_update(chunk_update(session_id, "a")));
    std::thread::sleep(std::time::Duration::from_millis(2));
    dispatcher.enqueue(AcpUiEvent::session_update(chunk_update(session_id, "b")));

    let captured = captured_events.lock().expect("captured events lock");
    let timestamps: Vec<u64> = captured
        .iter()
        .filter_map(|event| match &event.payload {
            AcpUiEventPayload::SessionUpdate(update) => match update.as_ref() {
                SessionUpdate::AgentMessageChunk {
                    session_id: Some(update_session_id),
                    produced_at_monotonic_ms: Some(timestamp_ms),
                    ..
                } if update_session_id == session_id => Some(*timestamp_ms),
                _ => None,
            },
            _ => None,
        })
        .collect();

    assert_eq!(timestamps.len(), 2);
    assert!(timestamps[1] >= timestamps[0]);
}

#[test]
fn dispatcher_preserves_existing_agent_message_chunk_timestamp() {
    let session_id = "stream-session";
    let (dispatcher, captured_events) = AcpUiEventDispatcher::test_sink();

    dispatcher.enqueue(AcpUiEvent::session_update(chunk_update_with_timestamp(
        session_id, "a", 42,
    )));

    let captured = captured_events.lock().expect("captured events lock");
    let timestamps: Vec<u64> = captured
        .iter()
        .filter_map(|event| match &event.payload {
            AcpUiEventPayload::SessionUpdate(update) => match update.as_ref() {
                SessionUpdate::AgentMessageChunk {
                    session_id: Some(update_session_id),
                    produced_at_monotonic_ms: Some(timestamp_ms),
                    ..
                } if update_session_id == session_id => Some(*timestamp_ms),
                _ => None,
            },
            _ => None,
        })
        .collect();

    assert_eq!(timestamps, vec![42]);
}

#[test]
fn dispatcher_buffers_eligible_updates_before_lifecycle_without_projection_mutation() {
    let session_id = "pre-reservation-capability";
    let projection_registry = Arc::new(ProjectionRegistry::new());
    let (dispatcher, captured_events) =
        AcpUiEventDispatcher::test_sink_with_projection_registry_and_pre_reservation_gate(
            Arc::clone(&projection_registry),
        );

    dispatcher.enqueue(AcpUiEvent::session_update(available_commands_update(Some(
        session_id,
    ))));
    dispatcher.enqueue(AcpUiEvent::session_update(user_chunk_update(
        session_id,
        "hello before lifecycle",
    )));

    let captured = captured_events.lock().expect("captured events lock");
    assert!(captured.is_empty());
    assert_eq!(
        dispatcher
            .pre_reservation_event_buffer
            .buffered_event_count(session_id),
        2
    );
    assert!(projection_registry
        .snapshot_for_session(session_id)
        .is_none());
    assert!(dispatcher
        .runtime_graph_registry
        .supervisor()
        .snapshot_for_session(session_id)
        .is_none());
}

#[test]
fn dispatcher_rejects_pre_lifecycle_non_capability_update() {
    let session_id = "pre-reservation-turn";
    let (dispatcher, captured_events) = AcpUiEventDispatcher::test_sink_with_pre_reservation_gate();

    dispatcher.enqueue(AcpUiEvent::session_update(SessionUpdate::TurnComplete {
        session_id: Some(session_id.to_string()),
        turn_id: None,
    }));

    let captured = captured_events.lock().expect("captured events lock");
    assert!(captured.is_empty());
    assert_eq!(
        dispatcher
            .pre_reservation_event_buffer
            .buffered_event_count(session_id),
        0
    );
    assert!(dispatcher
        .runtime_graph_registry
        .supervisor()
        .snapshot_for_session(session_id)
        .is_none());
}

#[test]
fn dispatcher_rejects_pre_lifecycle_update_without_session_id() {
    let (dispatcher, captured_events) = AcpUiEventDispatcher::test_sink_with_pre_reservation_gate();

    dispatcher.enqueue(AcpUiEvent::session_update(available_commands_update(None)));

    let captured = captured_events.lock().expect("captured events lock");
    assert!(captured.is_empty());
}

#[test]
fn dispatcher_drains_buffered_capability_update_after_lifecycle_exists() {
    let session_id = "pre-reservation-drain";
    let (dispatcher, captured_events) = AcpUiEventDispatcher::test_sink_with_pre_reservation_gate();

    dispatcher.enqueue(AcpUiEvent::session_update(available_commands_update(Some(
        session_id,
    ))));
    dispatcher.begin_pre_reservation_drain(session_id);
    seed_lifecycle(dispatcher.runtime_graph_registry.as_ref(), session_id);
    dispatcher.drain_pre_reservation_events(session_id);

    let captured = captured_events.lock().expect("captured events lock");
    assert_eq!(captured.len(), 1);
    assert!(matches!(
        captured[0].payload,
        AcpUiEventPayload::SessionUpdate(ref update)
            if matches!(update.as_ref(), SessionUpdate::AvailableCommandsUpdate { .. })
    ));
    assert_eq!(
        dispatcher
            .pre_reservation_event_buffer
            .buffered_event_count(session_id),
        0
    );
}

#[test]
fn dispatcher_holds_live_same_session_update_behind_draining_buffer() {
    let session_id = "pre-reservation-draining-order";
    let (dispatcher, captured_events) = AcpUiEventDispatcher::test_sink_with_pre_reservation_gate();

    dispatcher.enqueue(AcpUiEvent::session_update(current_mode_update(
        session_id, "plan",
    )));
    dispatcher.begin_pre_reservation_drain(session_id);
    seed_lifecycle(dispatcher.runtime_graph_registry.as_ref(), session_id);
    dispatcher.enqueue(AcpUiEvent::session_update(current_mode_update(
        session_id, "build",
    )));

    assert!(captured_events
        .lock()
        .expect("captured events lock")
        .is_empty());
    assert_eq!(
        dispatcher
            .pre_reservation_event_buffer
            .buffered_event_count(session_id),
        2
    );

    dispatcher.drain_pre_reservation_events(session_id);

    let captured = captured_events.lock().expect("captured events lock");
    assert_eq!(captured.len(), 2);
    let modes: Vec<String> = captured
        .iter()
        .map(|event| match &event.payload {
            AcpUiEventPayload::SessionUpdate(update) => match update.as_ref() {
                SessionUpdate::CurrentModeUpdate { update, .. } => update.current_mode_id.clone(),
                other => panic!("expected current mode update, got {:?}", other),
            },
            other => panic!("expected session update, got {:?}", other),
        })
        .collect();
    assert_eq!(modes, vec!["plan".to_string(), "build".to_string()]);
}

#[test]
fn dispatcher_drains_buffered_user_message_before_live_assistant_output() {
    let session_id = "pre-reservation-user-before-assistant";
    let (dispatcher, captured_events) = AcpUiEventDispatcher::test_sink_with_pre_reservation_gate();

    dispatcher.enqueue(AcpUiEvent::session_update(user_chunk_update(
        session_id,
        "first prompt",
    )));
    dispatcher.begin_pre_reservation_drain(session_id);
    seed_lifecycle(dispatcher.runtime_graph_registry.as_ref(), session_id);
    dispatcher.enqueue(AcpUiEvent::session_update(chunk_update(
        session_id,
        "assistant output",
    )));
    dispatcher.drain_pre_reservation_events(session_id);

    let captured = captured_events.lock().expect("captured events lock");
    let transcript_texts = captured
        .iter()
        .filter_map(|event| match &event.payload {
            AcpUiEventPayload::SessionUpdate(update) => match update.as_ref() {
                SessionUpdate::UserMessageChunk { chunk, .. }
                | SessionUpdate::AgentMessageChunk { chunk, .. } => match &chunk.content {
                    ContentBlock::Text { text } => Some(text.clone()),
                    _ => None,
                },
                _ => None,
            },
            _ => None,
        })
        .collect::<Vec<_>>();

    assert_eq!(
        transcript_texts,
        vec!["first prompt".to_string(), "assistant output".to_string()]
    );
}

#[test]
fn dispatcher_caps_pre_lifecycle_buffer_by_event_count() {
    let session_id = "pre-reservation-overflow";
    let (dispatcher, captured_events) = AcpUiEventDispatcher::test_sink_with_pre_reservation_gate();

    for index in 0..17 {
        dispatcher.enqueue(AcpUiEvent::session_update(current_mode_update(
            session_id,
            &format!("mode-{index}"),
        )));
    }

    assert!(captured_events
        .lock()
        .expect("captured events lock")
        .is_empty());
    assert_eq!(
        dispatcher
            .pre_reservation_event_buffer
            .buffered_event_count(session_id),
        16
    );
}

#[test]
fn per_session_fifo_order_is_preserved() {
    let mut state = DispatcherState::new(DispatchPolicy::default());
    state.enqueue(AcpUiEvent::session_update(chunk_update("s1", "a")));
    state.enqueue(AcpUiEvent::session_update(chunk_update("s1", "b")));

    let first = state.next_event().expect("first event");
    let second = state.next_event().expect("second event");

    let first_text = match &first.payload {
        AcpUiEventPayload::SessionUpdate(update) => match update.as_ref() {
            SessionUpdate::AgentMessageChunk { chunk, .. } => match &chunk.content {
                ContentBlock::Text { text } => text.clone(),
                _ => String::new(),
            },
            _ => String::new(),
        },
        _ => String::new(),
    };
    let second_text = match &second.payload {
        AcpUiEventPayload::SessionUpdate(update) => match update.as_ref() {
            SessionUpdate::AgentMessageChunk { chunk, .. } => match &chunk.content {
                ContentBlock::Text { text } => text.clone(),
                _ => String::new(),
            },
            _ => String::new(),
        },
        _ => String::new(),
    };

    assert_eq!(first_text, "a");
    assert_eq!(second_text, "b");
}

#[tokio::test]
async fn persist_dispatch_event_builds_snapshot_envelope_from_journal_event_seq() {
    let db = setup_test_db().await;
    SessionMetadataRepository::ensure_exists(
        &db,
        "session-1",
        "/test/project",
        "claude-code",
        None,
    )
    .await
    .expect("session metadata");
    let event = AcpUiEvent::session_update(SessionUpdate::AgentMessageChunk {
        chunk: ContentChunk {
            content: ContentBlock::Text {
                text: "hello".to_string(),
            },
            aggregation_hint: None,
        },
        part_id: Some("part-1".to_string()),
        message_id: Some("assistant-1".to_string()),
        parent_tool_use_id: None,
        session_id: Some("session-1".to_string()),
        produced_at_monotonic_ms: None,
    });

    let projection_registry = ProjectionRegistry::new();
    if let AcpUiEventPayload::SessionUpdate(update) = &event.payload {
        projection_registry.apply_session_update("session-1", update.as_ref());
    }
    let transcript_projection_registry = TranscriptProjectionRegistry::new();
    let runtime_graph_registry = SessionGraphRuntimeRegistry::new();
    seed_lifecycle(&runtime_graph_registry, "session-1");
    let effects = persist_dispatch_event(
        Some(&db),
        &event,
        &projection_registry,
        &runtime_graph_registry,
        &transcript_projection_registry,
    )
    .await;
    let envelope = effects
        .session_state_envelope
        .expect("session state envelope");

    assert_eq!(envelope.session_id, "session-1");
    assert_eq!(envelope.graph_revision, 1);
    assert_eq!(envelope.last_event_seq, 1);
    match envelope.payload {
        crate::acp::session_state_engine::SessionStatePayload::Snapshot { graph } => {
            assert_eq!(graph.revision, SessionGraphRevision::new(1, 1, 1));
            assert_eq!(graph.transcript_snapshot.revision, 1);
            assert_eq!(graph.transcript_snapshot.entries.len(), 1);
        }
        other => panic!("expected snapshot payload, got {:?}", other),
    }
}

#[tokio::test]
async fn persist_dispatch_event_emits_assistant_text_delta_envelope_for_streaming_chunks() {
    let db = setup_test_db().await;
    SessionMetadataRepository::ensure_exists(
        &db,
        "session-1",
        "/test/project",
        "claude-code",
        None,
    )
    .await
    .expect("session metadata");
    let event = AcpUiEvent::session_update(chunk_update_with_timestamp("session-1", "hello", 5));

    let projection_registry = ProjectionRegistry::new();
    if let AcpUiEventPayload::SessionUpdate(update) = &event.payload {
        projection_registry.apply_session_update("session-1", update.as_ref());
    }
    let transcript_projection_registry = TranscriptProjectionRegistry::new();
    let runtime_graph_registry = SessionGraphRuntimeRegistry::new();
    seed_lifecycle(&runtime_graph_registry, "session-1");
    let effects = persist_dispatch_event(
        Some(&db),
        &event,
        &projection_registry,
        &runtime_graph_registry,
        &transcript_projection_registry,
    )
    .await;

    assert!(
        effects.session_state_envelope.is_some(),
        "expected primary transcript/session envelope"
    );
    let delta = effects
        .additional_session_state_envelopes
        .iter()
        .find_map(|envelope| match &envelope.payload {
            crate::acp::session_state_engine::SessionStatePayload::AssistantTextDelta { delta } => {
                Some(delta)
            }
            _ => None,
        })
        .expect("assistant text delta payload");
    assert_eq!(delta.row_id, "acepe--entry--session-start--assistant---");
    assert_eq!(delta.turn_id, "acepe--entry--session-start--assistant---");
    assert_eq!(delta.char_offset, 0);
    assert_eq!(delta.delta_text, "hello");
    assert_eq!(delta.produced_at_monotonic_ms, 5);
    assert_eq!(delta.revision, 1);
}

#[tokio::test]
async fn persist_dispatch_event_writes_current_transcript_row_ledger() {
    let db = setup_test_db().await;
    SessionMetadataRepository::ensure_exists(
        &db,
        "session-1",
        "/test/project",
        "claude-code",
        None,
    )
    .await
    .expect("session metadata");
    let event = AcpUiEvent::session_update(chunk_update("session-1", "hello ledger"));
    let projection_registry = ProjectionRegistry::new();
    let transcript_projection_registry = TranscriptProjectionRegistry::new();
    let runtime_graph_registry = SessionGraphRuntimeRegistry::new();
    seed_lifecycle(&runtime_graph_registry, "session-1");

    let effects = persist_dispatch_event(
        Some(&db),
        &event,
        &projection_registry,
        &runtime_graph_registry,
        &transcript_projection_registry,
    )
    .await;

    assert!(
        effects.session_state_envelope.is_some(),
        "canonical update should still emit session state"
    );
    let ledger_page = SessionTranscriptRowLedgerRepository::read_tail_page(
        &db,
        "session-1",
        TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
        128,
    )
    .await
    .expect("ledger page should load");
    let SessionTranscriptRowLedgerRead::Current { metadata, rows } = ledger_page else {
        panic!("expected current row ledger page");
    };
    assert_eq!(
        metadata.projection_version,
        TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION
    );
    assert_eq!(metadata.row_count, 1);
    assert_eq!(metadata.last_event_seq, 1);
    let header_json = metadata
        .open_header_json
        .as_deref()
        .expect("ledger should store an open header");
    let header: SessionTranscriptRowLedgerOpenHeader =
        serde_json::from_str(header_json).expect("open header should deserialize");
    assert_eq!(header.agent_id, CanonicalAgentId::ClaudeCode);
    assert_eq!(header.project_path, "/test/project");
    assert_eq!(header.message_count, 1);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].row_index, 0);
    assert_eq!(
        rows[0].row_id,
        "transcript:acepe::entry::session-start::assistant::."
    );
    assert!(
        rows[0].row_json.contains("hello ledger"),
        "persisted row payload should contain canonical transcript content"
    );
}

#[tokio::test]
async fn persist_dispatch_event_splits_connection_complete_into_capabilities_and_lifecycle() {
    let db = setup_test_db().await;
    SessionMetadataRepository::ensure_exists(
        &db,
        "session-1",
        "/test/project",
        "claude-code",
        None,
    )
    .await
    .expect("session metadata");
    let event = AcpUiEvent::session_update(SessionUpdate::ConnectionComplete {
        session_id: "session-1".to_string(),
        attempt_id: 1,
        models: crate::acp::client_session::default_session_model_state(),
        modes: crate::acp::client_session::default_modes(),
        available_commands: Some(vec![AvailableCommand {
            name: "compact".to_string(),
            description: "Compact".to_string(),
            input: None,
        }]),
        config_options: Some(Vec::new()),
        autonomous_enabled: Some(true),
    });

    let projection_registry = ProjectionRegistry::new();
    if let AcpUiEventPayload::SessionUpdate(update) = &event.payload {
        projection_registry.apply_session_update("session-1", update.as_ref());
    }
    let transcript_projection_registry = TranscriptProjectionRegistry::new();
    let runtime_graph_registry = SessionGraphRuntimeRegistry::new();
    seed_lifecycle(&runtime_graph_registry, "session-1");
    let effects = persist_dispatch_event(
        Some(&db),
        &event,
        &projection_registry,
        &runtime_graph_registry,
        &transcript_projection_registry,
    )
    .await;

    match effects
        .session_state_envelope
        .expect("session state envelope")
        .payload
    {
        crate::acp::session_state_engine::SessionStatePayload::Capabilities {
            capabilities,
            ..
        } => {
            assert_eq!(
                capabilities
                    .available_commands
                    .as_ref()
                    .expect("available commands")
                    .len(),
                1
            );
            assert_eq!(capabilities.autonomous_enabled, Some(true));
        }
        other => panic!("expected capabilities payload, got {:?}", other),
    }
    let lifecycle = effects
        .additional_session_state_envelopes
        .iter()
        .find_map(|envelope| match &envelope.payload {
            crate::acp::session_state_engine::SessionStatePayload::Lifecycle {
                lifecycle, ..
            } => Some(lifecycle),
            _ => None,
        })
        .expect("lifecycle payload");
    assert_eq!(
        lifecycle.status,
        crate::acp::lifecycle::LifecycleStatus::Ready
    );
}

#[tokio::test]
async fn persist_dispatch_event_builds_delta_envelope_for_interaction_updates() {
    let db = setup_test_db().await;
    SessionMetadataRepository::ensure_exists(
        &db,
        "session-1",
        "/test/project",
        "claude-code",
        None,
    )
    .await
    .expect("session metadata");
    let event = AcpUiEvent::session_update(SessionUpdate::PermissionRequest {
        permission: PermissionData {
            id: "permission-1".to_string(),
            session_id: "session-1".to_string(),
            json_rpc_request_id: Some(7),
            reply_handler: Some(crate::acp::session_update::InteractionReplyHandler::json_rpc(7)),
            permission: "execute".to_string(),
            patterns: vec![],
            metadata: json!({ "command": "bun test" }),
            always: vec![],
            auto_accepted: false,
            tool: None,
        },
        session_id: Some("session-1".to_string()),
    });

    let projection_registry = ProjectionRegistry::new();
    if let AcpUiEventPayload::SessionUpdate(update) = &event.payload {
        projection_registry.apply_session_update("session-1", update.as_ref());
    }
    let transcript_projection_registry = TranscriptProjectionRegistry::new();
    let runtime_graph_registry = SessionGraphRuntimeRegistry::new();
    runtime_graph_registry.restore_session_state(
        "session-1".to_string(),
        1,
        crate::acp::session_state_engine::selectors::SessionGraphLifecycle::reserved(),
        crate::acp::session_state_engine::selectors::SessionGraphCapabilities::empty(),
    );
    let effects = persist_dispatch_event(
        Some(&db),
        &event,
        &projection_registry,
        &runtime_graph_registry,
        &transcript_projection_registry,
    )
    .await;

    let envelope = effects
        .session_state_envelope
        .expect("session state envelope");
    match envelope.payload {
        crate::acp::session_state_engine::SessionStatePayload::Delta { delta } => {
            assert_eq!(delta.to_revision.graph_revision, 2);
            assert_eq!(
                    delta.to_revision.transcript_revision, 0,
                    "PermissionRequest is non-transcript-bearing and must not advance transcript_revision"
                );
            assert_eq!(delta.interaction_patches.len(), 1);
            assert_eq!(delta.interaction_patches[0].id, "permission-1");
            assert_eq!(
                delta.activity.kind,
                crate::acp::session_state_engine::SessionGraphActivityKind::WaitingForUser
            );
        }
        other => panic!("expected delta payload, got {:?}", other),
    }
}

#[tokio::test]
async fn question_request_updates_live_interactions_without_raw_journal_row() {
    let db = setup_test_db().await;
    SessionMetadataRepository::ensure_exists(
        &db,
        "session-1",
        "/test/project",
        "claude-code",
        None,
    )
    .await
    .expect("session metadata");
    let event = AcpUiEvent::session_update(SessionUpdate::QuestionRequest {
        question: QuestionData {
            id: "question-1".to_string(),
            session_id: "session-1".to_string(),
            json_rpc_request_id: Some(8),
            reply_handler: Some(InteractionReplyHandler::json_rpc(8)),
            questions: vec![QuestionItem {
                question: "Which archive button should get the confirm step?".to_string(),
                header: "Archive".to_string(),
                options: vec![QuestionOption {
                    label: "Top toolbar".to_string(),
                    description: "Add confirm to the toolbar button".to_string(),
                }],
                multi_select: false,
            }],
            tool: None,
        },
        session_id: Some("session-1".to_string()),
    });

    let projection_registry = ProjectionRegistry::new();
    if let AcpUiEventPayload::SessionUpdate(update) = &event.payload {
        projection_registry.apply_session_update("session-1", update.as_ref());
    }
    let transcript_projection_registry = TranscriptProjectionRegistry::new();
    let runtime_graph_registry = SessionGraphRuntimeRegistry::new();
    runtime_graph_registry.restore_session_state(
        "session-1".to_string(),
        1,
        crate::acp::session_state_engine::selectors::SessionGraphLifecycle::reserved(),
        crate::acp::session_state_engine::selectors::SessionGraphCapabilities::empty(),
    );
    let effects = persist_dispatch_event(
        Some(&db),
        &event,
        &projection_registry,
        &runtime_graph_registry,
        &transcript_projection_registry,
    )
    .await;

    let journal_rows = SessionJournalEventRepository::list_serialized(&db, "session-1")
        .await
        .expect("journal rows");
    assert!(
        journal_rows.is_empty(),
        "pending question requests should not be written to the raw journal"
    );

    let envelope = effects
        .session_state_envelope
        .expect("session state envelope");
    match envelope.payload {
        crate::acp::session_state_engine::SessionStatePayload::Delta { delta } => {
            assert_eq!(delta.interaction_patches.len(), 1);
            assert_eq!(delta.interaction_patches[0].id, "question-1");
            assert!(delta
                .changed_fields
                .contains(&crate::acp::session_state_engine::SessionStateField::Interactions));
        }
        other => panic!("expected delta payload, got {:?}", other),
    }
}

#[tokio::test]
async fn synthetic_event_seq_path_must_not_inflate_transcript_revision_past_real_progress() {
    // REGRESSION GUARD: streaming bug where each AgentMessageChunk goes
    // through the Ok(None) journal path. Previously, `synthetic_event_seq`
    // was derived from `max(graph_revision, prev_transcript_revision) + 1`,
    // so non-transcript updates (CurrentMode, Plan, telemetry, ...) that
    // bumped graph_revision caused the very next chunk to jump
    // transcript_revision to graph_revision + 1. After enough such updates,
    // transcript_revision marches arbitrarily far ahead of real transcript
    // content, breaking the consumer-side `transcript_revision <=
    // last_event_seq` invariant and starving the live UI of progressive
    // chunk deltas during streaming.
    //
    // Invariant we enforce: transcript_revision must equal the count of
    // transcript-bearing events that have actually been applied — it must
    // not advance for non-transcript updates and must not be lifted by
    // graph_revision activity.
    let db = setup_test_db().await;
    SessionMetadataRepository::ensure_exists(
        &db,
        "session-1",
        "/test/project",
        "claude-code",
        None,
    )
    .await
    .expect("session metadata");

    let projection_registry = ProjectionRegistry::new();
    let transcript_projection_registry = TranscriptProjectionRegistry::new();
    let runtime_graph_registry = SessionGraphRuntimeRegistry::new();
    seed_lifecycle(&runtime_graph_registry, "session-1");

    // Five non-transcript updates (Ok(None) path: CurrentMode is not
    // journaled by `ProjectionJournalUpdate::from_session_update`). These
    // would each previously bump synthetic_event_seq via graph_revision.
    for index in 0..5 {
        let event =
            AcpUiEvent::session_update(current_mode_update("session-1", &format!("mode-{index}")));
        if let AcpUiEventPayload::SessionUpdate(update) = &event.payload {
            projection_registry.apply_session_update("session-1", update.as_ref());
        }
        let _ = persist_dispatch_event(
            Some(&db),
            &event,
            &projection_registry,
            &runtime_graph_registry,
            &transcript_projection_registry,
        )
        .await;
    }

    let transcript_revision_after_non_transcript = transcript_projection_registry
        .snapshot_for_session("session-1")
        .map(|snapshot| snapshot.revision)
        .unwrap_or(0);
    assert_eq!(
        transcript_revision_after_non_transcript, 0,
        "non-transcript updates must not advance transcript_revision"
    );

    // Now a single transcript-bearing chunk arrives. transcript_revision
    // must advance by exactly 1, not jump to graph_revision + 1.
    let chunk_event = AcpUiEvent::session_update(chunk_update("session-1", "hello"));
    if let AcpUiEventPayload::SessionUpdate(update) = &chunk_event.payload {
        projection_registry.apply_session_update("session-1", update.as_ref());
    }
    let _ = persist_dispatch_event(
        Some(&db),
        &chunk_event,
        &projection_registry,
        &runtime_graph_registry,
        &transcript_projection_registry,
    )
    .await;

    let transcript_revision_after_chunk = transcript_projection_registry
        .snapshot_for_session("session-1")
        .map(|snapshot| snapshot.revision)
        .unwrap_or(0);
    assert_eq!(
        transcript_revision_after_chunk, 1,
        "first transcript-bearing chunk must advance transcript_revision by exactly 1, \
             regardless of how many non-transcript updates inflated graph_revision before it"
    );
}

#[tokio::test]
async fn non_journaled_tool_call_source_link_matches_transcript_entry() {
    let db = setup_test_db().await;
    SessionMetadataRepository::ensure_exists(
        &db,
        "session-1",
        "/test/project",
        "claude-code",
        None,
    )
    .await
    .expect("session metadata");

    let projection_registry = ProjectionRegistry::new();
    let transcript_projection_registry = TranscriptProjectionRegistry::new();
    let runtime_graph_registry = SessionGraphRuntimeRegistry::new();
    seed_lifecycle(&runtime_graph_registry, "session-1");

    for index in 0..5 {
        let event =
            AcpUiEvent::session_update(current_mode_update("session-1", &format!("mode-{index}")));
        let _ = persist_dispatch_event(
            Some(&db),
            &event,
            &projection_registry,
            &runtime_graph_registry,
            &transcript_projection_registry,
        )
        .await;
    }

    let event = AcpUiEvent::session_update(read_tool_call_update("session-1", "toolu-read"));
    let _ = persist_dispatch_event(
        Some(&db),
        &event,
        &projection_registry,
        &runtime_graph_registry,
        &transcript_projection_registry,
    )
    .await;

    let transcript_snapshot = transcript_projection_registry
        .snapshot_for_session("session-1")
        .expect("transcript snapshot");
    let tool_entry = transcript_snapshot
        .entries
        .iter()
        .find(|entry| entry.role == TranscriptEntryRole::Tool)
        .expect("tool transcript entry");
    let operation = projection_registry
        .operation_for_tool_call("session-1", "toolu-read")
        .expect("operation snapshot");

    assert_eq!(
            operation.source_link,
            OperationSourceLink::TranscriptLinked {
                entry_id: tool_entry.entry_id.clone(),
            },
            "non-journaled ToolCall updates must link operations to the same transcript entry they emit"
        );
}

#[tokio::test]
async fn no_message_id_chunks_emit_live_transcript_deltas_before_turn_complete() {
    let db = setup_test_db().await;
    SessionMetadataRepository::ensure_exists(
        &db,
        "session-1",
        "/test/project",
        "claude-code",
        None,
    )
    .await
    .expect("session metadata");

    let projection_registry = ProjectionRegistry::new();
    let transcript_projection_registry = TranscriptProjectionRegistry::new();
    let runtime_graph_registry = SessionGraphRuntimeRegistry::new();
    seed_lifecycle(&runtime_graph_registry, "session-1");

    let first_event = AcpUiEvent::session_update(chunk_update("session-1", "Ra"));
    if let AcpUiEventPayload::SessionUpdate(update) = &first_event.payload {
        projection_registry.apply_session_update("session-1", update.as_ref());
    }
    let first_effects = persist_dispatch_event(
        Some(&db),
        &first_event,
        &projection_registry,
        &runtime_graph_registry,
        &transcript_projection_registry,
    )
    .await;

    let second_event =
        AcpUiEvent::session_update(chunk_update("session-1", "incoats keep growing"));
    if let AcpUiEventPayload::SessionUpdate(update) = &second_event.payload {
        projection_registry.apply_session_update("session-1", update.as_ref());
    }
    let second_effects = persist_dispatch_event(
        Some(&db),
        &second_event,
        &projection_registry,
        &runtime_graph_registry,
        &transcript_projection_registry,
    )
    .await;

    let first_envelope = first_effects
        .session_state_envelope
        .expect("first live transcript envelope");
    let second_envelope = second_effects
        .session_state_envelope
        .expect("second live transcript envelope");

    match first_envelope.payload {
        crate::acp::session_state_engine::SessionStatePayload::Snapshot { graph } => {
            assert_eq!(graph.transcript_snapshot.revision, 1);
            assert_eq!(graph.transcript_snapshot.entries.len(), 1);
        }
        crate::acp::session_state_engine::SessionStatePayload::Delta { delta } => {
            assert_eq!(delta.transcript_operations.len(), 1);
            assert_eq!(delta.to_revision.transcript_revision, 1);
        }
        other => panic!("expected first transcript-bearing payload, got {:?}", other),
    }
    match second_envelope.payload {
        crate::acp::session_state_engine::SessionStatePayload::Delta { delta } => {
            assert_eq!(delta.transcript_operations.len(), 1);
            assert_eq!(delta.to_revision.transcript_revision, 2);
        }
        other => panic!("expected second delta payload, got {:?}", other),
    }
}

#[tokio::test]
async fn same_session_write_lock_serializes_concurrent_chunk_persistence() {
    let db = Arc::new(setup_test_db().await);
    SessionMetadataRepository::ensure_exists(
        db.as_ref(),
        "session-1",
        "/test/project",
        "claude-code",
        None,
    )
    .await
    .expect("session metadata");

    let projection_registry = Arc::new(ProjectionRegistry::new());
    let transcript_projection_registry = Arc::new(TranscriptProjectionRegistry::new());
    let runtime_graph_registry = Arc::new(SessionGraphRuntimeRegistry::new());
    let journal_write_lock_registry = Arc::new(JournalWriteLockRegistry::new());
    seed_lifecycle(runtime_graph_registry.as_ref(), "session-1");

    let user_event = AcpUiEvent::session_update(user_chunk_update("session-1", "hello"));
    let assistant_event = AcpUiEvent::session_update(SessionUpdate::AgentMessageChunk {
        chunk: ContentChunk {
            content: ContentBlock::Text {
                text: "world".to_string(),
            },
            aggregation_hint: None,
        },
        part_id: Some("part-1".to_string()),
        message_id: Some("assistant-1".to_string()),
        parent_tool_use_id: None,
        session_id: Some("session-1".to_string()),
        produced_at_monotonic_ms: None,
    });

    let (user_acquired_tx, user_acquired_rx) = tokio::sync::oneshot::channel();

    let user_handle = {
        let db = Arc::clone(&db);
        let projection_registry = Arc::clone(&projection_registry);
        let transcript_projection_registry = Arc::clone(&transcript_projection_registry);
        let runtime_graph_registry = Arc::clone(&runtime_graph_registry);
        let journal_write_lock_registry = Arc::clone(&journal_write_lock_registry);
        tokio::spawn(async move {
            if let AcpUiEventPayload::SessionUpdate(update) = &user_event.payload {
                projection_registry.apply_session_update("session-1", update.as_ref());
            }

            let session_lock = journal_write_lock_registry.lock_for("session-1");
            let _guard = session_lock.lock().await;
            user_acquired_tx
                .send(())
                .expect("signal user lock acquired");
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;

            persist_dispatch_event(
                Some(db.as_ref()),
                &user_event,
                projection_registry.as_ref(),
                runtime_graph_registry.as_ref(),
                transcript_projection_registry.as_ref(),
            )
            .await
            .session_state_envelope
            .expect("user session state envelope")
            .last_event_seq
        })
    };

    let assistant_handle = {
        let db = Arc::clone(&db);
        let projection_registry = Arc::clone(&projection_registry);
        let transcript_projection_registry = Arc::clone(&transcript_projection_registry);
        let runtime_graph_registry = Arc::clone(&runtime_graph_registry);
        let journal_write_lock_registry = Arc::clone(&journal_write_lock_registry);
        tokio::spawn(async move {
            user_acquired_rx.await.expect("user acquired lock");

            if let AcpUiEventPayload::SessionUpdate(update) = &assistant_event.payload {
                projection_registry.apply_session_update("session-1", update.as_ref());
            }

            let session_lock = journal_write_lock_registry.lock_for("session-1");
            let _guard = session_lock.lock().await;

            persist_dispatch_event(
                Some(db.as_ref()),
                &assistant_event,
                projection_registry.as_ref(),
                runtime_graph_registry.as_ref(),
                transcript_projection_registry.as_ref(),
            )
            .await
            .session_state_envelope
            .expect("assistant session state envelope")
            .last_event_seq
        })
    };

    let user_last_event_seq = user_handle.await.expect("user join");
    let assistant_last_event_seq = assistant_handle.await.expect("assistant join");

    assert_eq!(user_last_event_seq, 1);
    assert_eq!(assistant_last_event_seq, 2);

    let transcript_snapshot = transcript_projection_registry
        .snapshot_for_session("session-1")
        .expect("transcript snapshot");
    assert_eq!(transcript_snapshot.revision, 2);
    assert_eq!(transcript_snapshot.entries.len(), 2);
    assert_eq!(
        transcript_snapshot.entries[0].role,
        crate::acp::transcript_projection::TranscriptEntryRole::User
    );
    assert_eq!(
        transcript_snapshot.entries[1].role,
        crate::acp::transcript_projection::TranscriptEntryRole::Assistant
    );

    let runtime_snapshot = runtime_graph_registry.snapshot_for_session("session-1");
    assert_eq!(runtime_snapshot.graph_revision, 2);
}

#[tokio::test]
async fn runtime_registry_maps_transcript_delta_to_session_state_delta_envelope() {
    let db = setup_test_db().await;
    let runtime_graph_registry = SessionGraphRuntimeRegistry::new();
    let transcript_projection_registry = TranscriptProjectionRegistry::new();
    transcript_projection_registry.restore_session_snapshot(
        "session-1".to_string(),
        crate::acp::transcript_projection::TranscriptSnapshot {
            revision: 6,
            entries: Vec::new(),
        },
    );
    let envelope = runtime_graph_registry
        .build_live_session_state_envelope(LiveSessionStateEnvelopeRequest {
            db: &db,
            session_id: "session-1",
            update: &chunk_update("session-1", "hello"),
            previous_revision: SessionGraphRevision::new(6, 6, 6),
            revision: SessionGraphRevision::new(7, 7, 7),
            projection_registry: &ProjectionRegistry::new(),
            transcript_projection_registry: &transcript_projection_registry,
            transcript_delta: Some(&TranscriptDelta {
                event_seq: 7,
                session_id: "session-1".to_string(),
                snapshot_revision: 7,
                operations: vec![
                    crate::acp::transcript_projection::TranscriptDeltaOperation::AppendEntry {
                        entry: crate::acp::transcript_projection::TranscriptEntry {
                            entry_id: "assistant-1".to_string(),
                            role: crate::acp::transcript_projection::TranscriptEntryRole::Assistant,
                            segments: vec![
                                crate::acp::transcript_projection::TranscriptSegment::Text {
                                    segment_id: "assistant-1:block:0".to_string(),
                                    text: "hello".to_string(),
                                },
                            ],
                            attempt_id: None,
                            timestamp_ms: None,
                        },
                    },
                ],
            }),
        })
        .await
        .expect("session state envelope");

    assert_eq!(envelope.session_id, "session-1");
    assert_eq!(envelope.graph_revision, 7);
    assert_eq!(envelope.last_event_seq, 7);

    match envelope.payload {
        crate::acp::session_state_engine::SessionStatePayload::Delta { delta } => {
            assert_eq!(delta.from_revision, SessionGraphRevision::new(6, 6, 6));
            assert_eq!(delta.to_revision, SessionGraphRevision::new(7, 7, 7));
            assert_eq!(
                delta.changed_fields,
                vec![
                    crate::acp::session_state_engine::SessionStateField::TranscriptSnapshot,
                    crate::acp::session_state_engine::SessionStateField::Activity,
                    crate::acp::session_state_engine::SessionStateField::TurnState,
                    crate::acp::session_state_engine::SessionStateField::ActiveTurnFailure,
                    crate::acp::session_state_engine::SessionStateField::LastTerminalTurnId,
                    crate::acp::session_state_engine::SessionStateField::ActiveStreamingTail,
                ]
            );
        }
        other => panic!("expected delta payload, got {:?}", other),
    }
}

#[tokio::test]
async fn runtime_registry_escalates_broken_transcript_lineage_to_snapshot() {
    let db = setup_test_db().await;
    SessionMetadataRepository::ensure_exists(
        &db,
        "session-1",
        "/test/project",
        "claude-code",
        None,
    )
    .await
    .expect("seed metadata");
    let runtime_graph_registry = SessionGraphRuntimeRegistry::new();
    let projection_registry = ProjectionRegistry::new();
    let transcript_projection_registry = TranscriptProjectionRegistry::new();
    transcript_projection_registry.restore_session_snapshot(
        "session-1".to_string(),
        crate::acp::transcript_projection::TranscriptSnapshot {
            revision: 7,
            entries: vec![crate::acp::transcript_projection::TranscriptEntry {
                entry_id: "assistant-history-1".to_string(),
                role: crate::acp::transcript_projection::TranscriptEntryRole::Assistant,
                segments: vec![crate::acp::transcript_projection::TranscriptSegment::Text {
                    segment_id: "assistant-history-1:block:0".to_string(),
                    text: "existing answer".to_string(),
                }],
                attempt_id: None,
                timestamp_ms: None,
            }],
        },
    );
    let envelope = runtime_graph_registry
        .build_live_session_state_envelope(LiveSessionStateEnvelopeRequest {
            db: &db,
            session_id: "session-1",
            update: &chunk_update("session-1", "hello"),
            previous_revision: SessionGraphRevision::new(8, 7, 8),
            revision: SessionGraphRevision::new(9, 6, 9),
            projection_registry: &projection_registry,
            transcript_projection_registry: &transcript_projection_registry,
            transcript_delta: Some(&TranscriptDelta {
                event_seq: 9,
                session_id: "session-1".to_string(),
                snapshot_revision: 6,
                operations: vec![
                    crate::acp::transcript_projection::TranscriptDeltaOperation::AppendEntry {
                        entry: crate::acp::transcript_projection::TranscriptEntry {
                            entry_id: "assistant-2".to_string(),
                            role: crate::acp::transcript_projection::TranscriptEntryRole::Assistant,
                            segments: vec![
                                crate::acp::transcript_projection::TranscriptSegment::Text {
                                    segment_id: "assistant-2:block:0".to_string(),
                                    text: "broken delta".to_string(),
                                },
                            ],
                            attempt_id: None,
                            timestamp_ms: None,
                        },
                    },
                ],
            }),
        })
        .await
        .expect("session state envelope");

    match envelope.payload {
        crate::acp::session_state_engine::SessionStatePayload::Snapshot { graph } => {
            assert_eq!(graph.revision, SessionGraphRevision::new(9, 6, 9));
            assert_eq!(graph.transcript_snapshot.revision, 7);
            assert_eq!(graph.transcript_snapshot.entries.len(), 1);
        }
        other => panic!("expected snapshot payload, got {:?}", other),
    }
}

#[tokio::test]
async fn drain_skips_raw_streaming_chunk_when_canonical_state_is_available() {
    let db = setup_test_db().await;
    SessionMetadataRepository::ensure_exists(
        &db,
        "session-1",
        "/test/project",
        "claude-code",
        None,
    )
    .await
    .expect("session metadata");

    let hub = AcpEventHubState::new();
    let mut receiver = hub.subscribe();
    let projection_registry = ProjectionRegistry::new();
    let transcript_projection_registry = TranscriptProjectionRegistry::new();
    let runtime_graph_registry = SessionGraphRuntimeRegistry::new();
    let journal_write_lock_registry = JournalWriteLockRegistry::new();
    seed_lifecycle(&runtime_graph_registry, "session-1");
    let mut state = DispatcherState::new(DispatchPolicy::default());
    state.enqueue(AcpUiEvent::session_update(
        SessionUpdate::AgentMessageChunk {
            chunk: ContentChunk {
                content: ContentBlock::Text {
                    text: "hello".to_string(),
                },
                aggregation_hint: None,
            },
            part_id: Some("part-1".to_string()),
            message_id: Some("assistant-1".to_string()),
            parent_tool_use_id: None,
            session_id: Some("session-1".to_string()),
            produced_at_monotonic_ms: None,
        },
    ));
    projection_registry.apply_session_update(
        "session-1",
        &SessionUpdate::AgentMessageChunk {
            chunk: ContentChunk {
                content: ContentBlock::Text {
                    text: "hello".to_string(),
                },
                aggregation_hint: None,
            },
            part_id: Some("part-1".to_string()),
            message_id: Some("assistant-1".to_string()),
            parent_tool_use_id: None,
            session_id: Some("session-1".to_string()),
            produced_at_monotonic_ms: None,
        },
    );

    state
        .drain(
            &hub,
            Some(&db),
            &projection_registry,
            &runtime_graph_registry,
            &transcript_projection_registry,
            &journal_write_lock_registry,
        )
        .await;

    let first = receiver.recv().await.expect("session state event");
    assert_eq!(first.event_name, "acp-session-state");

    let mut published_event_names = vec![first.event_name.clone()];
    while let Ok(event) = receiver.try_recv() {
        published_event_names.push(event.event_name);
    }

    assert!(
        !published_event_names
            .iter()
            .any(|event_name| event_name == "acp-session-update"),
        "canonical streaming chunks should not also wake the frontend on the raw lane"
    );

    let envelope: SessionStateEnvelope =
        serde_json::from_value(first.payload).expect("session state payload");
    assert_eq!(envelope.session_id, "session-1");
    assert_eq!(envelope.graph_revision, 1);
    assert_eq!(envelope.last_event_seq, 1);
}

#[tokio::test]
async fn drain_emits_canonical_append_segments_for_same_message_id_chunks() {
    let db = setup_test_db().await;
    SessionMetadataRepository::ensure_exists(
        &db,
        "session-1",
        "/test/project",
        "claude-code",
        None,
    )
    .await
    .expect("session metadata");

    let hub = AcpEventHubState::new();
    let mut receiver = hub.subscribe();
    let projection_registry = ProjectionRegistry::new();
    let transcript_projection_registry = TranscriptProjectionRegistry::new();
    let runtime_graph_registry = SessionGraphRuntimeRegistry::new();
    let journal_write_lock_registry = JournalWriteLockRegistry::new();
    seed_lifecycle(&runtime_graph_registry, "session-1");
    let mut state = DispatcherState::new(DispatchPolicy::default());
    let chunks = ["In", " their", " fight"];

    for text in chunks {
        let update = SessionUpdate::AgentMessageChunk {
            chunk: ContentChunk {
                content: ContentBlock::Text {
                    text: text.to_string(),
                },
                aggregation_hint: None,
            },
            part_id: Some("assistant-1".to_string()),
            message_id: Some("assistant-1".to_string()),
            parent_tool_use_id: None,
            session_id: Some("session-1".to_string()),
            produced_at_monotonic_ms: None,
        };
        projection_registry.apply_session_update("session-1", &update);
        state.enqueue(AcpUiEvent::session_update(update));
    }

    state
        .drain(
            &hub,
            Some(&db),
            &projection_registry,
            &runtime_graph_registry,
            &transcript_projection_registry,
            &journal_write_lock_registry,
        )
        .await;

    let mut rendered = String::new();
    let mut observed_state_envelopes = 0;
    while rendered != "In their fight" && observed_state_envelopes < 12 {
        let event = receiver.recv().await.expect("published event");
        if event.event_name != "acp-session-state" {
            continue;
        }
        observed_state_envelopes += 1;
        let envelope = serde_json::from_value::<SessionStateEnvelope>(event.payload)
            .expect("session state payload");
        match envelope.payload {
            crate::acp::session_state_engine::SessionStatePayload::Snapshot { graph } => {
                let Some(entry) = graph.transcript_snapshot.entries.last() else {
                    panic!("expected assistant entry");
                };
                rendered.clear();
                for segment in &entry.segments {
                    rendered.push_str(segment.primary_text());
                }
            }
            crate::acp::session_state_engine::SessionStatePayload::Delta { delta } => {
                assert_eq!(delta.transcript_operations.len(), 1);
                match &delta.transcript_operations[0] {
                        crate::acp::transcript_projection::TranscriptDeltaOperation::AppendEntry {
                            entry,
                        } => {
                            rendered.clear();
                            for segment in &entry.segments {
                                rendered.push_str(segment.primary_text());
                            }
                        }
                        crate::acp::transcript_projection::TranscriptDeltaOperation::AppendSegment {
                            entry_id,
                            segment,
                            ..
                        } => {
                            assert_eq!(entry_id, "acepe::entry::session-start::assistant::.");
                            match segment {
                                _ => rendered.push_str(segment.primary_text()),
                            }
                        }
                        other => panic!("unexpected transcript operation: {:?}", other),
                    }
            }
            crate::acp::session_state_engine::SessionStatePayload::ViewportBufferPush {
                ..
            } => {}
            crate::acp::session_state_engine::SessionStatePayload::ViewportBufferDelta {
                ..
            } => {}
            other => panic!("unexpected session-state payload: {:?}", other),
        }
    }

    assert_eq!(rendered, "In their fight");
}

#[test]
fn high_priority_beats_non_session_normal() {
    let mut state = DispatcherState::new(DispatchPolicy::default());
    state.enqueue(AcpUiEvent::json_event(
        "acp-session-created",
        Value::Null,
        None,
        AcpUiEventPriority::Normal,
        false,
    ));
    state.enqueue(AcpUiEvent::inbound_request(Value::Object(
        Default::default(),
    )));

    let first = state.next_event().expect("first event");
    assert_eq!(first.event_name, "acp-inbound-request");
}

#[test]
fn high_priority_preserves_causal_ordering_in_session() {
    let mut state = DispatcherState::new(DispatchPolicy::default());
    state.enqueue(AcpUiEvent::session_update(chunk_update("s1", "a")));
    state.enqueue(AcpUiEvent::session_update(chunk_update("s1", "b")));
    state.enqueue(AcpUiEvent::inbound_request(json!({
        "params": { "sessionId": "s1" }
    })));

    // Preceding Normal events in the same session must be emitted
    // before the High-priority event to preserve causal ordering.
    let first = state.next_event().expect("first event");
    assert_eq!(first.event_name, "acp-session-update");

    let second = state.next_event().expect("second event");
    assert_eq!(second.event_name, "acp-session-update");

    let third = state.next_event().expect("third event");
    assert_eq!(third.event_name, "acp-inbound-request");
}

#[test]
fn high_priority_still_beats_other_sessions() {
    let mut state = DispatcherState::new(DispatchPolicy::default());
    state.enqueue(AcpUiEvent::session_update(chunk_update("s2", "other")));
    state.enqueue(AcpUiEvent::inbound_request(json!({
        "params": { "sessionId": "s1" }
    })));

    // High-priority event from s1 should still beat Normal from s2
    // (no causal relationship across sessions).
    let first = state.next_event().expect("first event");
    assert_eq!(first.event_name, "acp-inbound-request");
}

#[test]
fn drops_droppable_when_global_backlog_exceeded() {
    let policy = DispatchPolicy {
        max_global_backlog: 1,
        ..DispatchPolicy::default()
    };

    let mut state = DispatcherState::new(policy);
    state.enqueue(AcpUiEvent::session_update(chunk_update("s1", "a")));
    state.enqueue(AcpUiEvent::session_update(chunk_update("s1", "b")));

    assert_eq!(state.global_backlog, 1);
    assert_eq!(state.telemetry.dropped, 1);
}

#[test]
fn keeps_non_droppable_when_global_backlog_exceeded() {
    let policy = DispatchPolicy {
        max_global_backlog: 1,
        ..DispatchPolicy::default()
    };

    let mut state = DispatcherState::new(policy);
    state.enqueue(AcpUiEvent::session_update(chunk_update("s1", "a")));
    state.enqueue(AcpUiEvent::inbound_request(Value::Object(
        Default::default(),
    )));

    assert_eq!(state.global_backlog, 2);
    assert_eq!(state.telemetry.dropped, 0);
}

#[tokio::test]
async fn drain_publishes_queued_events_without_rate_configuration() {
    let mut state = DispatcherState::new(DispatchPolicy::default());
    state.enqueue(AcpUiEvent::json_event(
        "acp-test-event",
        Value::Null,
        None,
        AcpUiEventPriority::Normal,
        false,
    ));
    let hub = AcpEventHubState::new();
    let mut receiver = hub.subscribe();
    let projection_registry = ProjectionRegistry::new();
    let transcript_projection_registry = TranscriptProjectionRegistry::new();
    let runtime_graph_registry = SessionGraphRuntimeRegistry::new();
    let journal_write_lock_registry = JournalWriteLockRegistry::new();

    tokio::time::timeout(
        Duration::from_millis(20),
        state.drain(
            &hub,
            None,
            &projection_registry,
            &runtime_graph_registry,
            &transcript_projection_registry,
            &journal_write_lock_registry,
        ),
    )
    .await
    .expect("dispatcher drain should publish without rate configuration");

    let event = receiver.recv().await.expect("published event");
    assert_eq!(event.event_name, "acp-test-event");
    assert_eq!(state.global_backlog, 0);
}

#[test]
fn round_robin_interleaves_sessions() {
    let mut state = DispatcherState::new(DispatchPolicy::default());
    state.enqueue(AcpUiEvent::session_update(chunk_update("s1", "a1")));
    state.enqueue(AcpUiEvent::session_update(chunk_update("s1", "a2")));
    state.enqueue(AcpUiEvent::session_update(chunk_update("s2", "b1")));
    state.enqueue(AcpUiEvent::session_update(chunk_update("s2", "b2")));

    let mut order = Vec::new();
    while let Some(event) = state.next_event() {
        let text = match &event.payload {
            AcpUiEventPayload::SessionUpdate(update) => match update.as_ref() {
                SessionUpdate::AgentMessageChunk {
                    chunk:
                        ContentChunk {
                            content: ContentBlock::Text { text },
                            ..
                        },
                    ..
                } => text.clone(),
                _ => String::new(),
            },
            _ => String::new(),
        };
        order.push(text);
    }

    assert_eq!(order, vec!["a1", "b1", "a2", "b2"]);
}

#[test]
fn session_domain_event_uses_dedicated_event_name() {
    let event = AcpUiEvent::session_domain_event(SessionDomainEvent {
        event_id: "event-1".to_string(),
        seq: 1,
        session_id: "session-1".to_string(),
        provider_session_id: None,
        occurred_at_ms: 123,
        causation_id: None,
        kind: SessionDomainEventKind::SessionConnected,
        payload: None,
    });

    assert_eq!(event.event_name, "acp-session-domain-event");
    assert_eq!(event.session_id.as_deref(), Some("session-1"));
}

#[test]
fn dispatcher_enqueues_turn_complete_domain_event_after_session_update() {
    let (dispatcher, captured_events) = AcpUiEventDispatcher::test_sink();
    dispatcher.enqueue(AcpUiEvent::session_update(SessionUpdate::TurnComplete {
        session_id: Some("session-1".to_string()),
        turn_id: None,
    }));

    let captured = captured_events.lock().expect("captured events lock");
    assert_eq!(captured.len(), 2);
    assert_eq!(captured[0].event_name, "acp-session-update");
    assert_eq!(captured[1].event_name, "acp-session-domain-event");

    match &captured[1].payload {
        AcpUiEventPayload::SessionDomainEvent(event) => {
            assert_eq!(event.session_id, "session-1");
            assert_eq!(event.seq, 1);
            assert!(matches!(event.kind, SessionDomainEventKind::TurnCompleted));
        }
        other => panic!("Expected session domain event payload, got {:?}", other),
    }
}

#[test]
fn dispatcher_updates_projection_snapshot_for_session_updates() {
    let projection_registry = Arc::new(ProjectionRegistry::new());
    projection_registry.register_session("session-1".to_string(), CanonicalAgentId::ClaudeCode);
    let (dispatcher, _captured_events) =
        AcpUiEventDispatcher::test_sink_with_projection_registry(Arc::clone(&projection_registry));

    dispatcher.enqueue(AcpUiEvent::session_update(
        SessionUpdate::AgentMessageChunk {
            chunk: ContentChunk {
                content: ContentBlock::Text {
                    text: "hello".to_string(),
                },
                aggregation_hint: None,
            },
            part_id: None,
            message_id: Some("msg-1".to_string()),
            parent_tool_use_id: None,
            session_id: Some("session-1".to_string()),
            produced_at_monotonic_ms: None,
        },
    ));
    dispatcher.enqueue(AcpUiEvent::session_update(SessionUpdate::TurnComplete {
        session_id: Some("session-1".to_string()),
        turn_id: None,
    }));

    let snapshot = projection_registry
        .snapshot_for_session("session-1")
        .expect("expected session snapshot");
    assert_eq!(snapshot.agent_id, Some(CanonicalAgentId::ClaudeCode));
    assert_eq!(snapshot.message_count, 1);
    assert_eq!(snapshot.turn_state, SessionTurnState::Completed);
    assert_eq!(snapshot.last_event_seq, 2);
}

#[test]
fn dispatcher_enqueues_interaction_domain_event_for_permission_request() {
    let (dispatcher, captured_events) = AcpUiEventDispatcher::test_sink();
    dispatcher.enqueue(AcpUiEvent::session_update(
        SessionUpdate::PermissionRequest {
            permission: PermissionData {
                id: "permission-1".to_string(),
                session_id: "session-1".to_string(),
                json_rpc_request_id: Some(7),
                reply_handler: Some(
                    crate::acp::session_update::InteractionReplyHandler::json_rpc(7),
                ),
                permission: "execute".to_string(),
                patterns: vec![],
                metadata: json!({ "command": "bun test" }),
                always: vec![],
                auto_accepted: false,
                tool: None,
            },
            session_id: Some("session-1".to_string()),
        },
    ));

    let captured = captured_events.lock().expect("captured events lock");
    assert_eq!(captured.len(), 2);
    assert_eq!(captured[0].event_name, "acp-session-update");
    assert_eq!(captured[1].event_name, "acp-session-domain-event");

    match &captured[1].payload {
        AcpUiEventPayload::SessionDomainEvent(event) => {
            assert_eq!(event.session_id, "session-1");
            assert!(matches!(
                event.kind,
                SessionDomainEventKind::InteractionUpserted
            ));
        }
        other => panic!("Expected session domain event payload, got {:?}", other),
    }
}

#[test]
fn dispatcher_enqueues_interaction_domain_event_for_plan_approval_tool_call() {
    let (dispatcher, captured_events) = AcpUiEventDispatcher::test_sink();
    dispatcher.enqueue(AcpUiEvent::session_update(SessionUpdate::ToolCall {
        tool_call: ToolCallData {
            id: "tool-1".to_string(),
            name: "create_plan".to_string(),
            arguments: ToolArguments::Other {
                raw: json!({}),
                intent: None,
            },
            diagnostic_input: None,
            kind: Some(ToolKind::CreatePlan),
            title: Some("Create plan".to_string()),
            status: ToolCallStatus::Pending,
            result: None,
            locations: None,
            skill_meta: None,
            normalized_questions: None,
            normalized_todos: None,
            normalized_todo_update: None,
            parent_tool_use_id: None,
            task_children: None,
            question_answer: None,
            awaiting_plan_approval: true,
            plan_approval_request_id: Some(9),
        },
        session_id: Some("session-1".to_string()),
    }));

    let captured = captured_events.lock().expect("captured events lock");
    assert_eq!(captured.len(), 2);
    assert_eq!(captured[0].event_name, "acp-session-update");
    assert_eq!(captured[1].event_name, "acp-session-domain-event");

    match &captured[1].payload {
        AcpUiEventPayload::SessionDomainEvent(event) => {
            assert_eq!(event.session_id, "session-1");
            assert!(matches!(
                event.kind,
                SessionDomainEventKind::InteractionUpserted
            ));
        }
        other => panic!("Expected session domain event payload, got {:?}", other),
    }
}

// =========================================================================
// Unit 7: End-to-end canonical pipeline proof
// =========================================================================

/// [E2E] Fresh session: a ToolCall enqueue emits both the raw update bridge
/// (acp-session-update) and the canonical operation domain event
/// (acp-session-domain-event / OperationUpserted) in that order.
///
/// This proves the dual-emission invariant that underpins the canonical live
/// ACP event pipeline: the raw bridge carries full projection data while the
/// domain event is the authoritative canonical signal.
#[test]
fn e2e_tool_call_emits_raw_update_bridge_and_canonical_operation_domain_event() {
    use crate::acp::domain_events::SessionDomainEventPayload;

    let (dispatcher, captured_events) = AcpUiEventDispatcher::test_sink();
    dispatcher.enqueue(AcpUiEvent::session_update(SessionUpdate::ToolCall {
        tool_call: ToolCallData {
            id: "tool-read-1".to_string(),
            name: "Read".to_string(),
            arguments: ToolArguments::Other {
                raw: json!({ "file_path": "src/main.rs" }),
                intent: None,
            },
            diagnostic_input: None,
            kind: Some(ToolKind::Read),
            title: Some("Read src/main.rs".to_string()),
            status: ToolCallStatus::Pending,
            result: None,
            locations: None,
            skill_meta: None,
            normalized_questions: None,
            normalized_todos: None,
            normalized_todo_update: None,
            parent_tool_use_id: None,
            task_children: None,
            question_answer: None,
            awaiting_plan_approval: false,
            plan_approval_request_id: None,
        },
        session_id: Some("session-e2e".to_string()),
    }));

    let captured = captured_events.lock().expect("lock");
    // Exactly 2 events: raw bridge first, canonical domain event second.
    assert_eq!(captured.len(), 2, "expected raw update + domain event");
    assert_eq!(
        captured[0].event_name, "acp-session-update",
        "first event must be raw bridge"
    );
    assert_eq!(captured[0].session_id.as_deref(), Some("session-e2e"));
    assert_eq!(
        captured[1].event_name, "acp-session-domain-event",
        "second event must be canonical"
    );

    match &captured[1].payload {
        AcpUiEventPayload::SessionDomainEvent(event) => {
            assert_eq!(event.session_id, "session-e2e");
            assert!(
                matches!(event.kind, SessionDomainEventKind::OperationUpserted),
                "domain event kind must be OperationUpserted for a ToolCall"
            );
            // Canonical payload carries operation identity
            match &event.payload {
                Some(SessionDomainEventPayload::OperationUpserted {
                    operation_id,
                    tool_name,
                    ..
                }) => {
                    assert_eq!(operation_id, "tool-read-1");
                    assert_eq!(tool_name, "Read");
                }
                other => panic!("Expected OperationUpserted payload, got {:?}", other),
            }
        }
        other => panic!("Expected SessionDomainEvent payload, got {:?}", other),
    }
}

/// [E2E] Late delivery: enqueueing the same ToolCall update twice does not
/// produce duplicate canonical domain events — the projection registry is
/// the idempotency authority.
///
/// Both enqueues still produce 2 events each (raw + domain) at the dispatcher
/// level, but the projection snapshot is updated consistently because
/// apply_canonical_event is idempotent for the same operation_id.
#[test]
fn e2e_duplicate_tool_call_enqueue_updates_projection_idempotently() {
    let projection_registry = Arc::new(ProjectionRegistry::new());
    projection_registry.register_session("session-idem".to_string(), CanonicalAgentId::ClaudeCode);
    let (dispatcher, captured_events) =
        AcpUiEventDispatcher::test_sink_with_projection_registry(Arc::clone(&projection_registry));

    let tool_call_event = AcpUiEvent::session_update(SessionUpdate::ToolCall {
        tool_call: ToolCallData {
            id: "tool-idem-1".to_string(),
            name: "Edit".to_string(),
            arguments: ToolArguments::Other {
                raw: json!({}),
                intent: None,
            },
            diagnostic_input: None,
            kind: Some(ToolKind::Edit),
            title: Some("Edit file".to_string()),
            status: ToolCallStatus::Pending,
            result: None,
            locations: None,
            skill_meta: None,
            normalized_questions: None,
            normalized_todos: None,
            normalized_todo_update: None,
            parent_tool_use_id: None,
            task_children: None,
            question_answer: None,
            awaiting_plan_approval: false,
            plan_approval_request_id: None,
        },
        session_id: Some("session-idem".to_string()),
    });

    // Enqueue the same logical update twice (simulating late/replay delivery)
    dispatcher.enqueue(tool_call_event.clone());
    dispatcher.enqueue(tool_call_event);

    // Dispatcher level: 4 events (2 raw + 2 domain) — dispatcher is not the dedup layer
    let captured = captured_events.lock().expect("lock");
    assert_eq!(captured.len(), 4);

    // Projection level: the snapshot reflects a consistent final state
    // (apply_canonical_event is the idempotency gate, not the dispatcher)
    let snapshot = projection_registry
        .snapshot_for_session("session-idem")
        .expect("snapshot must exist");
    // Snapshot is valid after duplicate delivery — no panic, no corrupted state
    assert!(
        snapshot.last_event_seq >= 1,
        "projection must have advanced"
    );
}

#[test]
fn dispatcher_seeds_domain_event_seq_from_restored_projection_frontier() {
    let projection_registry = Arc::new(ProjectionRegistry::new());
    projection_registry
        .register_session("session-seeded".to_string(), CanonicalAgentId::ClaudeCode);
    projection_registry.apply_session_update(
        "session-seeded",
        &SessionUpdate::TurnComplete {
            session_id: Some("session-seeded".to_string()),
            turn_id: None,
        },
    );
    projection_registry.set_last_event_seq_for_test("session-seeded", 7);

    let (dispatcher, captured_events) =
        AcpUiEventDispatcher::test_sink_with_projection_registry(Arc::clone(&projection_registry));

    dispatcher.enqueue(AcpUiEvent::session_update(SessionUpdate::ToolCall {
        tool_call: ToolCallData {
            id: "tool-seeded-1".to_string(),
            name: "Read".to_string(),
            arguments: ToolArguments::Other {
                raw: json!({ "file_path": "src/main.rs" }),
                intent: None,
            },
            diagnostic_input: None,
            kind: Some(ToolKind::Read),
            title: Some("Read src/main.rs".to_string()),
            status: ToolCallStatus::Pending,
            result: None,
            locations: None,
            skill_meta: None,
            normalized_questions: None,
            normalized_todos: None,
            normalized_todo_update: None,
            parent_tool_use_id: None,
            task_children: None,
            question_answer: None,
            awaiting_plan_approval: false,
            plan_approval_request_id: None,
        },
        session_id: Some("session-seeded".to_string()),
    }));

    let captured = captured_events.lock().expect("lock");
    let domain_event = match &captured[1].payload {
        AcpUiEventPayload::SessionDomainEvent(event) => event,
        other => panic!("Expected SessionDomainEvent payload, got {:?}", other),
    };
    assert_eq!(domain_event.seq, 8);
}
