use super::*;
use crate::acp::commands::{read_transcript_row_page_from_ledger, TranscriptRowPageResult};
use crate::acp::event_hub::AcpEventHubState;
use crate::acp::projections::{
    InteractionState, OperationSnapshot, OperationSourceLink, OperationState, SessionTurnState,
};
use crate::acp::session_descriptor::{SessionDescriptorCompatibility, SessionReplayContext};
use crate::acp::session_state_engine::runtime_registry::SessionGraphRuntimeRegistry;
use crate::acp::session_state_engine::runtime_registry::SessionGraphRuntimeSnapshot;
use crate::acp::session_state_engine::selectors::{
    SessionGraphActivity, SessionGraphCapabilities, SessionGraphLifecycle,
};
use crate::acp::session_state_engine::transcript_rows_ledger::{
    TranscriptRowsLedger, TranscriptRowsLedgerWriteHint,
};
use crate::acp::session_state_engine::{
    ActiveStreamingTail, ActiveStreamingTailContentKind, SessionGraphRevision, SessionStatePayload,
};
use crate::acp::session_thread_snapshot::{ProviderOwnedSessionSnapshot, SessionThreadSnapshot};
use crate::acp::session_update::{
    AvailableCommand, ToolArguments, ToolCallData, ToolCallStatus, ToolKind, TurnErrorKind,
    TurnErrorSource,
};
use crate::acp::transcript_projection::{
    TranscriptEntry, TranscriptEntryRole, TranscriptProjectionRegistry, TranscriptSegment,
    TranscriptSnapshot,
};
use crate::acp::transcript_viewport::ledger::{
    serialize_viewport_rows_for_ledger, SessionTranscriptRowLedgerOpenHeader,
    SessionTranscriptRowLedgerRead, SessionTranscriptRowLedgerStatus,
    TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
};
use crate::acp::transcript_viewport::{
    project_transcript_viewport_rows, TranscriptViewportRow, TranscriptViewportRowContent,
    TranscriptViewportRowKind,
};
use crate::acp::types::CanonicalAgentId;
use crate::db::repository::{
    SessionEventWriter, SessionJournalEventRepository, SessionMetadataRepository,
    SessionTranscriptRowLedgerRepository,
};
use crate::session_jsonl::types::{
    StoredAssistantChunk, StoredAssistantMessage, StoredContentBlock, StoredEntry,
    StoredErrorMessage, StoredUserMessage,
};
use sea_orm::{Database, DbConn};
use sea_orm_migration::MigratorTrait;
use serde_json::json;
use std::sync::Arc;
use uuid::Uuid;

async fn setup_db() -> DbConn {
    let db = Database::connect("sqlite::memory:")
        .await
        .expect("in-memory db");
    crate::db::migrations::Migrator::up(&db, None)
        .await
        .expect("migrations");
    db
}

fn make_hub() -> Arc<AcpEventHubState> {
    Arc::new(AcpEventHubState::new())
}

fn new_session_open_input(
    session_id: &str,
    capabilities: SessionGraphCapabilities,
) -> NewSessionOpenResultInput {
    NewSessionOpenResultInput {
        session_id: session_id.to_string(),
        agent_id: CanonicalAgentId::Copilot,
        project_path: "/test/project".to_string(),
        worktree_path: None,
        source_path: None,
        lifecycle: SessionGraphLifecycle::reserved(),
        capabilities,
    }
}

async fn seed_session_metadata(db: &DbConn, session_id: &str, agent_id: &str) {
    SessionMetadataRepository::ensure_exists(db, session_id, "/test/project", agent_id, None)
        .await
        .expect("seed metadata");
}

async fn append_frontier_barrier(db: &DbConn, session_id: &str) {
    SessionJournalEventRepository::append_materialization_barrier(db, session_id)
        .await
        .expect("append barrier event");
}

#[tokio::test]
async fn current_row_ledger_open_returns_hot_tail_page_without_full_snapshot_body() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "hot-ledger-session";
    seed_session_metadata(&db, session_id, "codex").await;
    append_frontier_barrier(&db, session_id).await;
    let header = SessionTranscriptRowLedgerOpenHeader {
        agent_id: CanonicalAgentId::Codex,
        project_path: "/test/project".to_string(),
        worktree_path: None,
        source_path: None,
        sequence_id: None,
        session_title: "Hot ledger session".to_string(),
        turn_state: SessionTurnState::Completed,
        message_count: 1,
        activity: SessionGraphActivity::idle(),
        active_streaming_tail: None,
        lifecycle: SessionGraphLifecycle::detached(
            crate::acp::lifecycle::DetachedReason::RestoredRequiresAttach,
        ),
        capabilities: SessionGraphCapabilities::empty(),
        active_turn_failure: None,
        last_terminal_turn_id: None,
    };
    let row = TranscriptViewportRow {
        row_id: "transcript:entry-1".to_string(),
        source_entry_id: "entry-1".to_string(),
        scope: crate::acp::transcript_projection::TranscriptScope::Root,
        kind: TranscriptViewportRowKind::AssistantText,
        version: "row-version-1".to_string(),
        anchor_eligible: true,
        active_streaming_tail: None,
        operation_links: Vec::new(),
        interaction_links: Vec::new(),
        content: TranscriptViewportRowContent::Transcript {
            role: TranscriptEntryRole::Assistant,
            segments: vec![TranscriptSegment::Text {
                segment_id: "entry-1:text:0".to_string(),
                text: "hello from the hot row ledger".to_string(),
            }],
        },
        duration_started_at_ms: None,
        timestamp_ms: None,
    };
    let rows = serialize_viewport_rows_for_ledger(
        session_id,
        7,
        1,
        TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
        &[row],
    )
    .expect("ledger rows should serialize");
    let expected_row_payload_bytes = rows
        .iter()
        .map(|row| row.row_json.len() as u64)
        .sum::<u64>();
    SessionTranscriptRowLedgerRepository::replace_current(
        &db,
        session_id,
        TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
        7,
        1,
        1,
        Some(serde_json::to_string(&header).expect("header should serialize")),
        rows,
    )
    .await
    .expect("ledger write should succeed");
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::Codex);

    let result =
        session_open_result_from_current_row_ledger(&db, &hub, &replay_context, session_id, 128)
            .await
            .expect("hot ledger lookup should succeed")
            .expect("current ledger should open hot");
    let SessionOpenResult::Found(found) = result else {
        panic!("expected found hot ledger open");
    };

    assert_eq!(found.open_path, SessionOpenPath::HotLedger);
    assert_eq!(
        found.lifecycle.status,
        crate::acp::lifecycle::LifecycleStatus::Reconnecting
    );
    assert_eq!(found.lifecycle.detached_reason, None);
    assert!(!found.lifecycle.actionability.can_resume);
    assert_eq!(found.transcript_snapshot.revision, 7);
    assert!(found.transcript_snapshot.entries.is_empty());
    assert!(found.operations.is_empty());
    assert_eq!(
        found
            .initial_transcript_row_page
            .as_ref()
            .expect("hot open should include row page")
            .rows
            .len(),
        1
    );
    assert_eq!(
        found
            .initial_transcript_row_page
            .as_ref()
            .expect("hot open should include row page")
            .row_payload_bytes,
        expected_row_payload_bytes
    );
    let envelope = found
        .initial_viewport_envelope
        .as_ref()
        .expect("hot open should include viewport push");
    let SessionStatePayload::ViewportBufferPush { push } = &envelope.payload else {
        panic!("expected viewport push payload");
    };
    assert_eq!(push.rows.len(), 1);
    assert_eq!(push.rows[0].row_id, "transcript:entry-1");
    let token = Uuid::parse_str(&found.open_token).expect("open token should be a uuid");
    assert!(hub.claim_reservation(token).is_some());
}

#[tokio::test]
async fn hot_ledger_open_uses_runtime_lifecycle_without_rewriting_row_page_revision() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "hot-ledger-runtime-ready";
    seed_session_metadata(&db, session_id, "codex").await;
    append_frontier_barrier(&db, session_id).await;
    let header = hot_ledger_header(CanonicalAgentId::Codex, "Runtime ready session");
    let rows = serialize_viewport_rows_for_ledger(
        session_id,
        70,
        70,
        TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
        &[assistant_text_row("entry-1", "cached row")],
    )
    .expect("ledger rows should serialize");
    SessionTranscriptRowLedgerRepository::replace_current(
        &db,
        session_id,
        TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
        70,
        70,
        70,
        Some(serde_json::to_string(&header).expect("header should serialize")),
        rows,
    )
    .await
    .expect("ledger write should succeed");
    let runtime_registry = SessionGraphRuntimeRegistry::new();
    runtime_registry.restore_session_state(
        session_id.to_string(),
        8,
        SessionGraphLifecycle::ready(),
        SessionGraphCapabilities {
            models: None,
            modes: None,
            available_commands: None,
            config_options: None,
            autonomous_enabled: Some(true),
        },
    );
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::Codex);

    let result =
        session_open_result_from_current_row_ledger(&db, &hub, &replay_context, session_id, 128)
            .await
            .expect("hot ledger lookup should succeed")
            .expect("current ledger should open hot");
    let result = apply_runtime_authority_to_session_open_result(result, Some(&runtime_registry));
    let SessionOpenResult::Found(found) = result else {
        panic!("expected found hot ledger open");
    };

    assert_eq!(found.graph_revision, 70);
    assert_eq!(
        found.lifecycle.status,
        crate::acp::lifecycle::LifecycleStatus::Ready
    );
    assert!(found.lifecycle.actionability.can_send);
    assert_eq!(found.capabilities.autonomous_enabled, Some(true));
    assert_eq!(
        found
            .initial_transcript_row_page
            .as_ref()
            .expect("hot open should include row page")
            .graph_revision,
        70
    );
}

#[tokio::test]
async fn hot_ledger_open_normalizes_stale_runtime_restored_detached_lifecycle() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "hot-ledger-stale-runtime-detached";
    seed_session_metadata(&db, session_id, "codex").await;
    append_frontier_barrier(&db, session_id).await;
    let header = hot_ledger_header(CanonicalAgentId::Codex, "Stale runtime detached");
    let rows = serialize_viewport_rows_for_ledger(
        session_id,
        70,
        70,
        TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
        &[assistant_text_row("entry-1", "cached row")],
    )
    .expect("ledger rows should serialize");
    SessionTranscriptRowLedgerRepository::replace_current(
        &db,
        session_id,
        TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
        70,
        70,
        70,
        Some(serde_json::to_string(&header).expect("header should serialize")),
        rows,
    )
    .await
    .expect("ledger write should succeed");
    let runtime_registry = SessionGraphRuntimeRegistry::new();
    runtime_registry.restore_session_state(
        session_id.to_string(),
        8,
        SessionGraphLifecycle::detached(
            crate::acp::lifecycle::DetachedReason::RestoredRequiresAttach,
        ),
        SessionGraphCapabilities::empty(),
    );
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::Codex);

    let result =
        session_open_result_from_current_row_ledger(&db, &hub, &replay_context, session_id, 128)
            .await
            .expect("hot ledger lookup should succeed")
            .expect("current ledger should open hot");
    let result = apply_runtime_authority_to_session_open_result(result, Some(&runtime_registry));
    let SessionOpenResult::Found(found) = result else {
        panic!("expected found hot ledger open");
    };

    assert_eq!(
        found.lifecycle.status,
        crate::acp::lifecycle::LifecycleStatus::Reconnecting
    );
    assert_eq!(found.lifecycle.detached_reason, None);
    assert!(!found.lifecycle.actionability.can_resume);
}

#[tokio::test]
async fn hot_ledger_cold_open_demotes_stale_running_turn_state() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "hot-ledger-stale-running-cold";
    seed_session_metadata(&db, session_id, "opencode").await;
    append_frontier_barrier(&db, session_id).await;
    let header = stale_running_header(CanonicalAgentId::OpenCode, "Stale running cold open");
    let rows = serialize_viewport_rows_for_ledger(
        session_id,
        7,
        1,
        TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
        &[assistant_text_row(
            "entry-1",
            "assistant reply before crash",
        )],
    )
    .expect("ledger rows should serialize");
    SessionTranscriptRowLedgerRepository::replace_current(
        &db,
        session_id,
        TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
        7,
        1,
        1,
        Some(serde_json::to_string(&header).expect("header should serialize")),
        rows,
    )
    .await
    .expect("ledger write should succeed");
    let runtime_registry = SessionGraphRuntimeRegistry::new();
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::OpenCode);

    let result =
        session_open_result_from_current_row_ledger(&db, &hub, &replay_context, session_id, 128)
            .await
            .expect("hot ledger lookup should succeed")
            .expect("current ledger should open hot");
    let result = apply_runtime_authority_to_session_open_result(result, Some(&runtime_registry));
    let SessionOpenResult::Found(found) = result else {
        panic!("expected found hot ledger open");
    };

    assert_eq!(
        found.turn_state,
        SessionTurnState::Completed,
        "cold hot-ledger open must demote stale Running turn state"
    );
    assert_ne!(
        found.activity.kind,
        crate::acp::session_state_engine::selectors::SessionGraphActivityKind::AwaitingModel,
        "cold hot-ledger open must not serve an awaiting-model spinner"
    );
    assert!(
        found.active_streaming_tail.is_none(),
        "cold hot-ledger open must not serve an active streaming tail"
    );
}

#[tokio::test]
async fn hot_ledger_cold_open_closes_stale_tool_rows_and_streaming_tail() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "hot-ledger-stale-browser-cold";
    seed_session_metadata(&db, session_id, "claude-code").await;
    append_frontier_barrier(&db, session_id).await;

    let assistant_entry_id = "assistant-before-browser";
    let mut header = stale_running_header(
        CanonicalAgentId::ClaudeCode,
        "Stale browser operation cold open",
    );
    header.active_streaming_tail = Some(ActiveStreamingTail {
        row_id: format!("transcript:{assistant_entry_id}"),
        content_kind: ActiveStreamingTailContentKind::Message,
    });
    let mut assistant_row = assistant_text_row(assistant_entry_id, "Opening the browser");
    assistant_row.active_streaming_tail = Some(ActiveStreamingTailContentKind::Message);
    let browser_row =
        running_browser_tool_row(session_id, "browser-tool-entry", "toolu_stale_browser");
    let rows = serialize_viewport_rows_for_ledger(
        session_id,
        7,
        1,
        TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
        &[assistant_row, browser_row],
    )
    .expect("ledger rows should serialize");
    SessionTranscriptRowLedgerRepository::replace_current(
        &db,
        session_id,
        TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
        7,
        1,
        1,
        Some(serde_json::to_string(&header).expect("header should serialize")),
        rows,
    )
    .await
    .expect("ledger write should succeed");
    let runtime_registry = SessionGraphRuntimeRegistry::new();
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::ClaudeCode);

    let result =
        session_open_result_from_current_row_ledger(&db, &hub, &replay_context, session_id, 128)
            .await
            .expect("hot ledger lookup should succeed")
            .expect("current ledger should open hot");
    let result = apply_runtime_authority_to_session_open_result(result, Some(&runtime_registry));
    let SessionOpenResult::Found(found) = result else {
        panic!("expected found hot ledger open");
    };

    assert_eq!(found.turn_state, SessionTurnState::Completed);
    assert!(found.active_streaming_tail.is_none());

    let page = found
        .initial_transcript_row_page
        .as_ref()
        .expect("hot open should include row page");
    assert!(page.rows[0].active_streaming_tail.is_none());
    assert_historical_browser_row_cancelled(&page.rows[1]);

    let envelope = found
        .initial_viewport_envelope
        .as_ref()
        .expect("hot open should include viewport push");
    let SessionStatePayload::ViewportBufferPush { push } = &envelope.payload else {
        panic!("expected viewport push payload");
    };
    assert!(push.rows[0].active_streaming_tail.is_none());
    assert_historical_browser_row_cancelled(&push.rows[1]);
}

#[tokio::test]
async fn hot_ledger_cold_open_normalizes_paginated_rows_and_versions() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "hot-ledger-paginated-stale-browser-cold";
    seed_session_metadata(&db, session_id, "claude-code").await;
    append_frontier_barrier(&db, session_id).await;

    let stale_tail_entry_id = "assistant-stale-tail-row-1";
    let mut header = stale_running_header(
        CanonicalAgentId::ClaudeCode,
        "Paginated stale browser operation cold open",
    );
    header.active_streaming_tail = Some(ActiveStreamingTail {
        row_id: format!("transcript:{stale_tail_entry_id}"),
        content_kind: ActiveStreamingTailContentKind::Message,
    });

    let stale_tail_row = projected_assistant_text_row(
        stale_tail_entry_id,
        "Opening the browser",
        Some(ActiveStreamingTailContentKind::Message),
    );
    let stale_tail_version = stale_tail_row.version.clone();
    let historical_tail_version =
        projected_assistant_text_row(stale_tail_entry_id, "Opening the browser", None).version;
    let browser_row = browser_tool_row_with_state(
        session_id,
        "browser-tool-entry-row-10",
        "toolu_stale_browser_paginated",
        OperationState::Running,
    );
    let running_browser_version = browser_row.version.clone();
    let historical_browser_version = browser_tool_row_with_state(
        session_id,
        "browser-tool-entry-row-10",
        "toolu_stale_browser_paginated",
        OperationState::Cancelled,
    )
    .version;
    let mut rows = Vec::with_capacity(11);
    rows.push(projected_assistant_text_row(
        "assistant-row-0",
        "Starting",
        None,
    ));
    rows.push(stale_tail_row);
    for index in 2..10 {
        rows.push(projected_assistant_text_row(
            &format!("assistant-row-{index}"),
            &format!("Historical assistant row {index}"),
            None,
        ));
    }
    rows.push(browser_row);
    let rows = serialize_viewport_rows_for_ledger(
        session_id,
        7,
        1,
        TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
        &rows,
    )
    .expect("ledger rows should serialize");
    SessionTranscriptRowLedgerRepository::replace_current(
        &db,
        session_id,
        TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
        7,
        1,
        1,
        Some(serde_json::to_string(&header).expect("header should serialize")),
        rows,
    )
    .await
    .expect("ledger write should succeed");
    let runtime_registry = SessionGraphRuntimeRegistry::new();
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::ClaudeCode);

    let result =
        session_open_result_from_current_row_ledger(&db, &hub, &replay_context, session_id, 1)
            .await
            .expect("hot ledger lookup should succeed")
            .expect("current ledger should open hot");
    let result = apply_runtime_authority_to_session_open_result(result, Some(&runtime_registry));
    let SessionOpenResult::Found(found) = result else {
        panic!("expected found hot ledger open");
    };
    let initial_page = found
        .initial_transcript_row_page
        .as_ref()
        .expect("hot open should include row page");
    assert_eq!(initial_page.start_row_index, 10);
    let initial_browser_row = initial_page
        .rows
        .first()
        .expect("tail page should contain browser row");
    assert_historical_browser_row_cancelled(initial_browser_row);

    let older_page = read_transcript_row_page_from_ledger(
        &db,
        session_id,
        1,
        1,
        SessionGraphRevision::new(1, 7, 1),
        Some(&runtime_registry),
    )
    .await
    .expect("older row page should read");
    let TranscriptRowPageResult::Current { rows, .. } = older_page else {
        panic!("expected current older row page");
    };
    let historical_tail_row = rows
        .first()
        .expect("older page should contain stale tail row");
    assert!(
        historical_tail_row.active_streaming_tail.is_none(),
        "cold historical pagination must clear stale active tails"
    );
    assert_ne!(historical_tail_row.version, stale_tail_version);
    assert_eq!(historical_tail_row.version, historical_tail_version);
    assert_ne!(initial_browser_row.version, running_browser_version);
    assert_eq!(initial_browser_row.version, historical_browser_version);

    runtime_registry.restore_session_state(
        session_id.to_string(),
        2,
        SessionGraphLifecycle::ready(),
        SessionGraphCapabilities::empty(),
    );
    let live_page = read_transcript_row_page_from_ledger(
        &db,
        session_id,
        10,
        1,
        SessionGraphRevision::new(1, 7, 1),
        Some(&runtime_registry),
    )
    .await
    .expect("live row page should read");
    let TranscriptRowPageResult::Current { rows, .. } = live_page else {
        panic!("expected current live row page");
    };
    let live_browser_row = rows.first().expect("live page should contain browser row");
    assert_browser_row_running(live_browser_row);
    assert_eq!(live_browser_row.version, running_browser_version);
}

#[tokio::test]
async fn hot_ledger_open_preserves_running_turn_when_runtime_is_live() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "hot-ledger-live-running";
    seed_session_metadata(&db, session_id, "opencode").await;
    append_frontier_barrier(&db, session_id).await;
    let assistant_entry_id = "entry-1";
    let mut header = stale_running_header(CanonicalAgentId::OpenCode, "Live running open");
    header.active_streaming_tail = Some(ActiveStreamingTail {
        row_id: format!("transcript:{assistant_entry_id}"),
        content_kind: ActiveStreamingTailContentKind::Message,
    });
    let mut assistant_row = assistant_text_row(assistant_entry_id, "assistant reply mid turn");
    assistant_row.active_streaming_tail = Some(ActiveStreamingTailContentKind::Message);
    let rows = serialize_viewport_rows_for_ledger(
        session_id,
        7,
        1,
        TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
        &[assistant_row],
    )
    .expect("ledger rows should serialize");
    SessionTranscriptRowLedgerRepository::replace_current(
        &db,
        session_id,
        TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
        7,
        1,
        1,
        Some(serde_json::to_string(&header).expect("header should serialize")),
        rows,
    )
    .await
    .expect("ledger write should succeed");
    let runtime_registry = SessionGraphRuntimeRegistry::new();
    runtime_registry.restore_session_state(
        session_id.to_string(),
        8,
        SessionGraphLifecycle::ready(),
        SessionGraphCapabilities::empty(),
    );
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::OpenCode);

    let result =
        session_open_result_from_current_row_ledger(&db, &hub, &replay_context, session_id, 128)
            .await
            .expect("hot ledger lookup should succeed")
            .expect("current ledger should open hot");
    let result = apply_runtime_authority_to_session_open_result(result, Some(&runtime_registry));
    let SessionOpenResult::Found(found) = result else {
        panic!("expected found hot ledger open");
    };

    assert_eq!(
        found.turn_state,
        SessionTurnState::Running,
        "live runtime with an attached session must keep the Running turn state"
    );
}

#[tokio::test]
async fn hot_ledger_open_with_ready_runtime_closes_running_turn_without_active_evidence() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "hot-ledger-ready-stale-running";
    seed_session_metadata(&db, session_id, "opencode").await;
    append_frontier_barrier(&db, session_id).await;
    let header = stale_running_header(CanonicalAgentId::OpenCode, "Ready stale running open");
    let rows = serialize_viewport_rows_for_ledger(
        session_id,
        7,
        1,
        TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
        &[assistant_text_row("entry-1", "assistant reply after turn")],
    )
    .expect("ledger rows should serialize");
    SessionTranscriptRowLedgerRepository::replace_current(
        &db,
        session_id,
        TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
        7,
        1,
        1,
        Some(serde_json::to_string(&header).expect("header should serialize")),
        rows,
    )
    .await
    .expect("ledger write should succeed");
    let runtime_registry = SessionGraphRuntimeRegistry::new();
    runtime_registry.restore_session_state(
        session_id.to_string(),
        8,
        SessionGraphLifecycle::ready(),
        SessionGraphCapabilities::empty(),
    );
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::OpenCode);

    let result =
        session_open_result_from_current_row_ledger(&db, &hub, &replay_context, session_id, 128)
            .await
            .expect("hot ledger lookup should succeed")
            .expect("current ledger should open hot");
    let result = apply_runtime_authority_to_session_open_result(result, Some(&runtime_registry));
    let SessionOpenResult::Found(found) = result else {
        panic!("expected found hot ledger open");
    };

    assert_eq!(found.turn_state, SessionTurnState::Completed);
    assert_ne!(
        found.activity.kind,
        crate::acp::session_state_engine::selectors::SessionGraphActivityKind::AwaitingModel
    );
    assert!(found.active_streaming_tail.is_none());
}

fn stale_running_header(
    agent_id: CanonicalAgentId,
    session_title: &str,
) -> SessionTranscriptRowLedgerOpenHeader {
    let mut header = hot_ledger_header(agent_id, session_title);
    header.turn_state = SessionTurnState::Running;
    header.activity = SessionGraphActivity {
        kind: crate::acp::session_state_engine::selectors::SessionGraphActivityKind::AwaitingModel,
        active_operation_count: 0,
        active_subagent_count: 0,
        dominant_operation_id: None,
        blocking_interaction_id: None,
        kind_started_at_ms: Some(1_000),
    };
    header
}

#[tokio::test]
async fn current_row_ledger_open_claim_frontier_matches_ledger_revision() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "hot-ledger-open-frontier";
    seed_session_metadata(&db, session_id, "codex").await;
    append_frontier_barrier(&db, session_id).await;
    let header = hot_ledger_header(CanonicalAgentId::Codex, "Hot ledger frontier");
    let rows = serialize_viewport_rows_for_ledger(
        session_id,
        7,
        7,
        TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
        &[assistant_text_row("entry-1", "frontier row")],
    )
    .expect("ledger rows should serialize");
    SessionTranscriptRowLedgerRepository::replace_current(
        &db,
        session_id,
        TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
        7,
        7,
        7,
        Some(serde_json::to_string(&header).expect("header should serialize")),
        rows,
    )
    .await
    .expect("ledger write should succeed");
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::Codex);

    let result =
        session_open_result_from_current_row_ledger(&db, &hub, &replay_context, session_id, 128)
            .await
            .expect("hot ledger lookup should succeed")
            .expect("current ledger should open hot");
    let SessionOpenResult::Found(found) = result else {
        panic!("expected found hot ledger open");
    };
    let token = Uuid::parse_str(&found.open_token).expect("open token should be a uuid");
    hub.publish(
        "acp-session-state",
        Some(session_id.to_string()),
        json!({"lastEventSeq": 8}),
        "normal",
        false,
    );
    let claim = hub
        .claim_reservation_for_session(token, session_id)
        .expect("reservation should be claimable for the hot-open session");

    assert_eq!(found.last_event_seq, 7);
    assert_eq!(claim.last_event_seq, 7);
    assert_eq!(claim.buffered_events.len(), 1);
}

#[tokio::test]
async fn row_ledger_pipeline_preserves_delivery_frontier_when_transcript_revision_is_ahead() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "row-ledger-independent-delivery-frontier";
    seed_session_metadata(&db, session_id, "codex").await;
    append_frontier_barrier(&db, session_id).await;

    let projection_registry = crate::acp::projections::ProjectionRegistry::new();
    let transcript_projection_registry = TranscriptProjectionRegistry::new();
    let mut session = crate::acp::projections::SessionSnapshot::new(
        session_id.to_string(),
        Some(CanonicalAgentId::Codex),
    );
    session.message_count = 1;
    session.transcript_entry_count = 1;
    projection_registry.restore_session_projection(
        crate::acp::projections::SessionProjectionSnapshot {
            session: Some(session),
            operations: Vec::new(),
            interactions: Vec::new(),
            runtime: None,
        },
    );
    transcript_projection_registry.restore_session_snapshot(
        session_id.to_string(),
        TranscriptSnapshot {
            revision: 41,
            entries: vec![TranscriptEntry {
                scope: crate::acp::transcript_projection::TranscriptScope::Root,
                entry_id: "entry-1".to_string(),
                role: TranscriptEntryRole::Assistant,
                segments: vec![TranscriptSegment::Text {
                    segment_id: "entry-1:text:0".to_string(),
                    text: "transcript progress is not delivery progress".to_string(),
                }],
                attempt_id: None,
                timestamp_ms: None,
            }],
        },
    );
    let revision = SessionGraphRevision::new(7, 41, 1);

    let materialized = TranscriptRowsLedger::new()
        .materialize_rows(
            SessionGraphRuntimeSnapshot::default(),
            session_id,
            revision,
            &projection_registry,
            &transcript_projection_registry,
        )
        .expect("rows should materialize");
    assert_eq!(materialized.effective_revision.transcript_revision, 41);
    assert_eq!(
        materialized.effective_revision.last_event_seq, 1,
        "materialization must preserve the delivery frontier"
    );

    let write_hint = TranscriptRowsLedgerWriteHint {
        force_full_replace: false,
        changed_source_entry_ids: vec!["entry-1".to_string()],
        changed_tool_call_ids: Vec::new(),
        changed_interaction_ids: Vec::new(),
    };
    let persisted_materialization = TranscriptRowsLedger::new()
        .materialize_persisted_rows(
            SessionGraphRuntimeSnapshot::default(),
            session_id,
            revision,
            &projection_registry,
            &transcript_projection_registry,
            &write_hint,
        )
        .expect("persisted rows should materialize")
        .expect("session should be attached");
    assert_eq!(
        persisted_materialization
            .effective_revision
            .transcript_revision,
        41
    );
    assert_eq!(
        persisted_materialization.effective_revision.last_event_seq, 1,
        "fast persistence materialization must preserve the delivery frontier"
    );

    let runtime_registry = SessionGraphRuntimeRegistry::new();
    runtime_registry
        .persist_current_transcript_row_ledger(
            &db,
            session_id,
            revision,
            &projection_registry,
            &transcript_projection_registry,
            write_hint,
        )
        .await
        .expect("row ledger should persist");
    let persisted = SessionTranscriptRowLedgerRepository::read_tail_page(
        &db,
        session_id,
        TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
        128,
    )
    .await
    .expect("persisted row ledger should read");
    let SessionTranscriptRowLedgerRead::Current { metadata, .. } = persisted else {
        panic!("expected current persisted row ledger");
    };
    assert_eq!(metadata.transcript_revision, 41);
    assert_eq!(
        metadata.last_event_seq, 1,
        "persistence must preserve the delivery frontier"
    );

    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::Codex);
    let opened =
        session_open_result_from_current_row_ledger(&db, &hub, &replay_context, session_id, 128)
            .await
            .expect("hot ledger lookup should succeed")
            .expect("persisted ledger should open hot");
    let SessionOpenResult::Found(found) = opened else {
        panic!("expected found hot ledger open");
    };
    assert_eq!(found.transcript_snapshot.revision, 41);
    assert_eq!(
        found.last_event_seq, 1,
        "open must preserve the persisted delivery frontier"
    );
}

#[tokio::test]
async fn current_row_ledger_hot_open_allows_barriers_after_row_cutoff() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "hot-ledger-barrier-tail";
    seed_session_metadata(&db, session_id, "codex").await;
    append_frontier_barrier(&db, session_id).await;
    let header = hot_ledger_header(CanonicalAgentId::Codex, "Barrier tail hot ledger");
    let rows = serialize_viewport_rows_for_ledger(
        session_id,
        7,
        1,
        TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
        &[assistant_text_row(
            "entry-1",
            "visible row is still current",
        )],
    )
    .expect("ledger rows should serialize");
    SessionTranscriptRowLedgerRepository::replace_current(
        &db,
        session_id,
        TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
        7,
        1,
        1,
        Some(serde_json::to_string(&header).expect("header should serialize")),
        rows,
    )
    .await
    .expect("ledger write should succeed");
    append_frontier_barrier(&db, session_id).await;
    append_frontier_barrier(&db, session_id).await;
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::Codex);

    let result = session_open_result_from_current_row_ledger_with_status(
        &db,
        &hub,
        &replay_context,
        session_id,
        128,
    )
    .await
    .expect("hot ledger lookup should succeed");
    let CurrentRowLedgerOpenLookup::Found {
        result: SessionOpenResult::Found(found),
        ..
    } = result
    else {
        panic!("barrier-only journal tail should not force legacy rebuild");
    };

    assert_eq!(found.open_path, SessionOpenPath::HotLedger);
    assert_eq!(found.last_event_seq, 1);
    assert_eq!(
        found
            .initial_transcript_row_page
            .as_ref()
            .expect("hot open should include row page")
            .rows
            .len(),
        1
    );
}

#[tokio::test]
async fn current_row_ledger_hot_open_still_misses_after_projection_update() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "hot-ledger-projection-tail";
    seed_session_metadata(&db, session_id, "codex").await;
    append_frontier_barrier(&db, session_id).await;
    let header = hot_ledger_header(CanonicalAgentId::Codex, "Projection tail hot ledger");
    let rows = serialize_viewport_rows_for_ledger(
        session_id,
        7,
        1,
        TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
        &[assistant_text_row(
            "entry-1",
            "this row is stale after update",
        )],
    )
    .expect("ledger rows should serialize");
    SessionTranscriptRowLedgerRepository::replace_current(
        &db,
        session_id,
        TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
        7,
        1,
        1,
        Some(serde_json::to_string(&header).expect("header should serialize")),
        rows,
    )
    .await
    .expect("ledger write should succeed");
    SessionEventWriter::commit_session_update(
        &db,
        session_id,
        &crate::acp::session_update::SessionUpdate::AgentMessageChunk {
            chunk: crate::acp::session_update::ContentChunk {
                content: crate::acp::types::ContentBlock::Text {
                    text: "new row after ledger".to_string(),
                },
                aggregation_hint: None,
            },
            part_id: Some("assistant-part-2".to_string()),
            message_id: Some("assistant-2".to_string()),
            parent_tool_use_id: None,
            session_id: Some(session_id.to_string()),
            produced_at_monotonic_ms: None,
        },
    )
    .await
    .expect("append projection update");
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::Codex);

    let result = session_open_result_from_current_row_ledger_with_status(
        &db,
        &hub,
        &replay_context,
        session_id,
        128,
    )
    .await
    .expect("hot ledger lookup should succeed");
    let CurrentRowLedgerOpenLookup::Miss(miss) = result else {
        panic!("projection update after ledger must force rebuild");
    };

    assert_eq!(miss, CurrentRowLedgerOpenMiss::BehindJournal);
}

#[tokio::test]
async fn current_row_ledger_hot_open_stays_bounded_for_1k_ledger() {
    assert_large_hot_ledger_open_is_bounded("one-k-hot-ledger-session", 1_000).await;
}

#[tokio::test]
async fn current_row_ledger_hot_open_stays_bounded_for_large_ledger() {
    assert_large_hot_ledger_open_is_bounded("large-hot-ledger-session", 10_000).await;
}

#[tokio::test]
async fn current_row_ledger_initial_page_policy_trims_heavy_tail_payload() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "heavy-hot-ledger-session";
    let row_count = 32usize;
    let max_rows = 16u64;
    let expected_initial_rows = 10usize;
    let heavy_text = "heavy row payload ".repeat(160);
    seed_session_metadata(&db, session_id, "codex").await;
    append_frontier_barrier(&db, session_id).await;
    let mut header = hot_ledger_header(CanonicalAgentId::Codex, "Heavy hot ledger session");
    header.message_count = row_count as u64;
    let mut viewport_rows = Vec::with_capacity(row_count);
    for index in 0..row_count {
        let entry_id = format!("entry-{index}");
        viewport_rows.push(assistant_text_row(
            &entry_id,
            &format!("{index}: {heavy_text}"),
        ));
    }
    let rows = serialize_viewport_rows_for_ledger(
        session_id,
        row_count as i64,
        row_count as i64,
        TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
        &viewport_rows,
    )
    .expect("heavy ledger rows should serialize");
    let tail_start = row_count - max_rows as usize;
    let expected_tail_start = row_count - expected_initial_rows;
    let expected_payload_bytes = rows[expected_tail_start..]
        .iter()
        .map(|row| row.row_json.len() as u64)
        .sum::<u64>();
    let payload_budget_bytes = expected_payload_bytes;
    SessionTranscriptRowLedgerRepository::replace_current(
        &db,
        session_id,
        TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
        row_count as i64,
        row_count as i64,
        row_count as i64,
        Some(serde_json::to_string(&header).expect("header should serialize")),
        rows.clone(),
    )
    .await
    .expect("heavy ledger write should succeed");
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::Codex);

    let result = session_open_result_from_current_row_ledger_with_initial_page_policy(
        &db,
        &hub,
        &replay_context,
        session_id,
        CurrentRowLedgerInitialPagePolicy::byte_bounded(max_rows, 8, payload_budget_bytes),
    )
    .await
    .expect("hot ledger lookup should succeed");
    let CurrentRowLedgerOpenLookup::Found { result, .. } = result else {
        panic!("expected found hot ledger open");
    };
    let SessionOpenResult::Found(found) = result else {
        panic!("expected found hot ledger open result");
    };
    let page = found
        .initial_transcript_row_page
        .as_ref()
        .expect("hot open should include bounded row page");
    let envelope = found
        .initial_viewport_envelope
        .as_ref()
        .expect("hot open should include bounded viewport push");
    let SessionStatePayload::ViewportBufferPush { push } = &envelope.payload else {
        panic!("expected viewport push payload");
    };

    assert_eq!(page.total_row_count, row_count as i64);
    assert_eq!(page.start_row_index, expected_tail_start as i64);
    assert_eq!(page.row_payload_bytes, expected_payload_bytes);
    assert_eq!(page.rows.len(), expected_initial_rows);
    assert_eq!(
        page.rows[0].source_entry_id,
        format!("entry-{expected_tail_start}")
    );
    assert_eq!(push.rows.len(), expected_initial_rows);
    assert_eq!(
        push.rows[0].source_entry_id,
        format!("entry-{expected_tail_start}")
    );
    assert!(
        rows[tail_start..]
            .iter()
            .map(|row| row.row_json.len() as u64)
            .sum::<u64>()
            > page.row_payload_bytes
    );
}

#[tokio::test]
#[ignore = "synthetic 100k row ledger flatness probe; run explicitly for performance validation"]
async fn current_row_ledger_hot_open_stays_bounded_for_100k_ledger() {
    assert_large_hot_ledger_open_is_bounded("hundred-k-hot-ledger-session", 100_000).await;
}

async fn assert_large_hot_ledger_open_is_bounded(session_id: &str, row_count: usize) {
    let db = setup_db().await;
    let hub = make_hub();
    let tail_limit = 128u64;
    seed_session_metadata(&db, session_id, "codex").await;
    append_frontier_barrier(&db, session_id).await;
    let mut header = hot_ledger_header(CanonicalAgentId::Codex, "Large hot ledger session");
    header.message_count = row_count as u64;
    let mut viewport_rows = Vec::with_capacity(row_count);
    for index in 0..row_count {
        let entry_id = format!("entry-{index}");
        viewport_rows.push(assistant_text_row(&entry_id, "large ledger row"));
    }
    let rows = serialize_viewport_rows_for_ledger(
        session_id,
        row_count as i64,
        row_count as i64,
        TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
        &viewport_rows,
    )
    .expect("large ledger rows should serialize");
    let expected_tail_payload_bytes = rows[row_count - tail_limit as usize..]
        .iter()
        .map(|row| row.row_json.len() as u64)
        .sum::<u64>();
    SessionTranscriptRowLedgerRepository::replace_current(
        &db,
        session_id,
        TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
        row_count as i64,
        row_count as i64,
        row_count as i64,
        Some(serde_json::to_string(&header).expect("header should serialize")),
        rows,
    )
    .await
    .expect("large ledger write should succeed");
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::Codex);

    let result = session_open_result_from_current_row_ledger(
        &db,
        &hub,
        &replay_context,
        session_id,
        tail_limit,
    )
    .await
    .expect("large hot ledger lookup should succeed")
    .expect("current large ledger should open hot");
    let SessionOpenResult::Found(found) = result else {
        panic!("expected found hot ledger open");
    };
    let page = found
        .initial_transcript_row_page
        .as_ref()
        .expect("hot open should include bounded row page");
    let envelope = found
        .initial_viewport_envelope
        .as_ref()
        .expect("hot open should include bounded viewport push");
    let SessionStatePayload::ViewportBufferPush { push } = &envelope.payload else {
        panic!("expected viewport push payload");
    };

    assert_eq!(found.open_path, SessionOpenPath::HotLedger);
    assert!(found.transcript_snapshot.entries.is_empty());
    assert!(found.operations.is_empty());
    assert_eq!(page.total_row_count, row_count as i64);
    assert_eq!(page.start_row_index, row_count as i64 - tail_limit as i64);
    assert_eq!(page.row_payload_bytes, expected_tail_payload_bytes);
    assert!(
        page.row_payload_bytes < 100_000,
        "tail payload must stay page-sized, got {} bytes",
        page.row_payload_bytes
    );
    assert_eq!(page.rows.len(), tail_limit as usize);
    assert_eq!(
        page.rows[0].source_entry_id,
        format!("entry-{}", row_count - tail_limit as usize)
    );
    assert_eq!(push.rows.len(), tail_limit as usize);
    assert_eq!(
        push.rows[0].source_entry_id,
        format!("entry-{}", row_count - tail_limit as usize)
    );
}

#[tokio::test]
async fn journal_rebuild_upgrades_v16_ledger_to_v17_and_next_open_is_hot() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "journal-rebuilt-hot-open";
    seed_session_metadata(&db, session_id, "copilot").await;
    let journal_updates = vec![
        crate::acp::session_update::SessionUpdate::UserMessageChunk {
            chunk: crate::acp::session_update::ContentChunk {
                content: crate::acp::types::ContentBlock::Text {
                    text: "hello ledger".to_string(),
                },
                aggregation_hint: None,
            },
            session_id: Some(session_id.to_string()),
            attempt_id: Some("attempt-1".to_string()),
        },
        crate::acp::session_update::SessionUpdate::AgentMessageChunk {
            chunk: crate::acp::session_update::ContentChunk {
                content: crate::acp::types::ContentBlock::Text {
                    text: "hello from rebuild".to_string(),
                },
                aggregation_hint: None,
            },
            part_id: Some("assistant-part-1".to_string()),
            message_id: Some("assistant-1".to_string()),
            parent_tool_use_id: None,
            session_id: Some(session_id.to_string()),
            produced_at_monotonic_ms: None,
        },
        crate::acp::session_update::SessionUpdate::TurnComplete {
            session_id: Some(session_id.to_string()),
            turn_id: Some("turn-1".to_string()),
        },
    ];
    for update in journal_updates {
        SessionEventWriter::commit_session_update(&db, session_id, &update)
            .await
            .expect("append journal update");
    }
    SessionTranscriptRowLedgerRepository::mark_rebuild_needed(
        &db,
        session_id,
        "transcript_viewport_row:v16",
        0,
        0,
        0,
    )
    .await
    .expect("mark stale ledger");
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::Copilot);

    let detailed_before_rebuild = session_open_result_from_current_row_ledger_with_status(
        &db,
        &hub,
        &replay_context,
        session_id,
        128,
    )
    .await
    .expect("stale ledger status read should not fail");
    let CurrentRowLedgerOpenLookup::Miss(miss) = detailed_before_rebuild else {
        panic!("stale ledger must not satisfy the detailed hot-open path");
    };
    assert_eq!(miss, CurrentRowLedgerOpenMiss::RebuildNeeded);

    let before_rebuild =
        session_open_result_from_current_row_ledger(&db, &hub, &replay_context, session_id, 128)
            .await
            .expect("stale ledger read should not fail");
    assert!(
        before_rebuild.is_none(),
        "stale ledger must not satisfy the hot-open path"
    );

    let lifecycle = SessionGraphLifecycle::detached(
        crate::acp::lifecycle::DetachedReason::RestoredRequiresAttach,
    );
    let capabilities = SessionGraphCapabilities::empty();
    let rebuilt_revision =
        crate::acp::transcript_viewport::ledger_rebuild::rebuild_and_replace_current_transcript_row_ledger_from_journal(
            &db,
            &replay_context,
            &lifecycle,
            &capabilities,
        )
        .await
        .expect("journal ledger rebuild should succeed")
        .expect("journal events should rebuild a ledger");
    assert_eq!(rebuilt_revision.last_event_seq, 3);

    let ledger_page = SessionTranscriptRowLedgerRepository::read_tail_page(
        &db,
        session_id,
        TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
        128,
    )
    .await
    .expect("rebuilt ledger page should read");
    let SessionTranscriptRowLedgerRead::Current { metadata, rows } = ledger_page else {
        panic!("rebuilt ledger should be current");
    };
    assert_eq!(
        metadata.projection_version,
        TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION
    );
    assert_eq!(metadata.last_event_seq, 3);
    assert_eq!(metadata.row_count, 2);
    assert_eq!(rows.len(), 2);

    let result =
        session_open_result_from_current_row_ledger(&db, &hub, &replay_context, session_id, 128)
            .await
            .expect("rebuilt ledger hot lookup should succeed")
            .expect("rebuilt current ledger should open hot");
    let SessionOpenResult::Found(found) = result else {
        panic!("expected found hot ledger open");
    };
    assert_eq!(found.open_path, SessionOpenPath::HotLedger);
    assert_eq!(found.last_event_seq, 3);
    assert_eq!(found.session_title, "hello ledger");
    assert!(found.transcript_snapshot.entries.is_empty());
    assert_eq!(
        found
            .initial_transcript_row_page
            .as_ref()
            .expect("hot open should include row page")
            .rows
            .len(),
        2
    );
}

#[tokio::test]
async fn corrupt_current_row_ledger_row_is_marked_rebuild_needed() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "corrupt-row-ledger-session";
    seed_session_metadata(&db, session_id, "codex").await;
    append_frontier_barrier(&db, session_id).await;
    let header = hot_ledger_header(CanonicalAgentId::Codex, "Corrupt row ledger session");
    let mut rows = serialize_viewport_rows_for_ledger(
        session_id,
        7,
        1,
        TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
        &[assistant_text_row("entry-1", "valid before corruption")],
    )
    .expect("ledger rows should serialize");
    rows[0].row_json = "{not valid json".to_string();
    SessionTranscriptRowLedgerRepository::replace_current(
        &db,
        session_id,
        TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
        7,
        1,
        1,
        Some(serde_json::to_string(&header).expect("header should serialize")),
        rows,
    )
    .await
    .expect("corrupt row payload can exist in persisted storage");
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::Codex);

    let result =
        session_open_result_from_current_row_ledger(&db, &hub, &replay_context, session_id, 128)
            .await
            .expect("corrupt ledger should route to rebuild, not hard-fail open");

    assert!(
        result.is_none(),
        "corrupt row payload must not satisfy hot open"
    );
    assert_rebuild_needed(&db, session_id).await;
}

#[tokio::test]
async fn corrupt_current_row_ledger_header_is_marked_rebuild_needed() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "corrupt-header-ledger-session";
    seed_session_metadata(&db, session_id, "codex").await;
    append_frontier_barrier(&db, session_id).await;
    let rows = serialize_viewport_rows_for_ledger(
        session_id,
        7,
        1,
        TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
        &[assistant_text_row("entry-1", "valid row")],
    )
    .expect("ledger rows should serialize");
    SessionTranscriptRowLedgerRepository::replace_current(
        &db,
        session_id,
        TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
        7,
        1,
        1,
        Some("{not valid header".to_string()),
        rows,
    )
    .await
    .expect("corrupt header payload can exist in persisted storage");
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::Codex);

    let result =
        session_open_result_from_current_row_ledger(&db, &hub, &replay_context, session_id, 128)
            .await
            .expect("corrupt ledger header should route to rebuild, not hard-fail open");

    assert!(
        result.is_none(),
        "corrupt header payload must not satisfy hot open"
    );
    assert_rebuild_needed(&db, session_id).await;
}

fn replay_context_for_session(
    session_id: &str,
    agent_id: CanonicalAgentId,
) -> SessionReplayContext {
    let project_path = "/test/project".to_string();
    SessionReplayContext {
        local_session_id: session_id.to_string(),
        history_session_id: session_id.to_string(),
        agent_id: agent_id.clone(),
        parser_agent_type: crate::acp::parsers::AgentType::from_canonical(&agent_id),
        project_path: project_path.clone(),
        worktree_path: None,
        effective_cwd: project_path,
        source_path: None,
        compatibility: SessionDescriptorCompatibility::Canonical,
    }
}

fn hot_ledger_header(
    agent_id: CanonicalAgentId,
    session_title: &str,
) -> SessionTranscriptRowLedgerOpenHeader {
    SessionTranscriptRowLedgerOpenHeader {
        agent_id,
        project_path: "/test/project".to_string(),
        worktree_path: None,
        source_path: None,
        sequence_id: None,
        session_title: session_title.to_string(),
        turn_state: SessionTurnState::Completed,
        message_count: 1,
        activity: SessionGraphActivity::idle(),
        active_streaming_tail: None,
        lifecycle: SessionGraphLifecycle::detached(
            crate::acp::lifecycle::DetachedReason::RestoredRequiresAttach,
        ),
        capabilities: SessionGraphCapabilities::empty(),
        active_turn_failure: None,
        last_terminal_turn_id: None,
    }
}

fn assistant_text_row(entry_id: &str, text: &str) -> TranscriptViewportRow {
    TranscriptViewportRow {
        row_id: format!("transcript:{entry_id}"),
        source_entry_id: entry_id.to_string(),
        scope: crate::acp::transcript_projection::TranscriptScope::Root,
        kind: TranscriptViewportRowKind::AssistantText,
        version: format!("{entry_id}:version"),
        anchor_eligible: true,
        active_streaming_tail: None,
        operation_links: Vec::new(),
        interaction_links: Vec::new(),
        content: TranscriptViewportRowContent::Transcript {
            role: TranscriptEntryRole::Assistant,
            segments: vec![TranscriptSegment::Text {
                segment_id: format!("{entry_id}:text:0"),
                text: text.to_string(),
            }],
        },
        duration_started_at_ms: None,
        timestamp_ms: None,
    }
}

fn running_browser_tool_row(
    session_id: &str,
    entry_id: &str,
    tool_call_id: &str,
) -> TranscriptViewportRow {
    browser_tool_row_with_state(session_id, entry_id, tool_call_id, OperationState::Running)
}

fn browser_tool_row_with_state(
    session_id: &str,
    entry_id: &str,
    tool_call_id: &str,
    operation_state: OperationState,
) -> TranscriptViewportRow {
    let operation = OperationSnapshot {
        id: format!("operation:{tool_call_id}"),
        session_id: session_id.to_string(),
        tool_call_id: tool_call_id.to_string(),
        name: "mcp__tauri__webview_execute_js".to_string(),
        kind: Some(ToolKind::Browser),
        provider_status: ToolCallStatus::InProgress,
        title: Some("Run browser script".to_string()),
        arguments: ToolArguments::Browser {
            raw: json!({ "script": "document.title" }),
            action: Some("execute_js".to_string()),
            selector: None,
            script: Some("document.title".to_string()),
        },
        progressive_arguments: None,
        result: None,
        computer_payload: None,
        command: None,
        normalized_todos: None,
        parent_tool_call_id: None,
        parent_operation_id: None,
        child_tool_call_ids: Vec::new(),
        child_operation_ids: Vec::new(),
        operation_provenance_key: Some(tool_call_id.to_string()),
        operation_state,
        locations: None,
        skill_meta: None,
        normalized_questions: None,
        question_answer: None,
        awaiting_plan_approval: false,
        plan_approval_request_id: None,
        started_at_ms: None,
        completed_at_ms: None,
        source_link: OperationSourceLink::transcript_linked(entry_id.to_string()),
        degradation_reason: None,
    };
    let mut row = project_transcript_viewport_rows(
        &TranscriptSnapshot {
            revision: 1,
            entries: vec![TranscriptEntry {
                scope: crate::acp::transcript_projection::TranscriptScope::Root,
                entry_id: entry_id.to_string(),
                role: TranscriptEntryRole::Tool,
                segments: vec![TranscriptSegment::Text {
                    segment_id: format!("{entry_id}:text:0"),
                    text: "Browser".to_string(),
                }],
                attempt_id: None,
                timestamp_ms: None,
            }],
        },
        std::slice::from_ref(&operation),
        &[],
        None,
        None,
    )
    .into_iter()
    .next()
    .expect("browser operation should project a viewport row");
    row.operation_links
        .first_mut()
        .expect("browser row should contain an operation link")
        .operation = Some(Box::new(operation));
    row
}

fn projected_assistant_text_row(
    entry_id: &str,
    text: &str,
    active_streaming_tail: Option<ActiveStreamingTailContentKind>,
) -> TranscriptViewportRow {
    let active_streaming_tail = active_streaming_tail.map(|content_kind| ActiveStreamingTail {
        row_id: entry_id.to_string(),
        content_kind,
    });
    project_transcript_viewport_rows(
        &TranscriptSnapshot {
            revision: 1,
            entries: vec![TranscriptEntry {
                scope: crate::acp::transcript_projection::TranscriptScope::Root,
                entry_id: entry_id.to_string(),
                role: TranscriptEntryRole::Assistant,
                segments: vec![TranscriptSegment::Text {
                    segment_id: format!("{entry_id}:text:0"),
                    text: text.to_string(),
                }],
                attempt_id: None,
                timestamp_ms: None,
            }],
        },
        &[],
        &[],
        active_streaming_tail.as_ref(),
        None,
    )
    .into_iter()
    .next()
    .expect("assistant text should project a viewport row")
}

fn assert_historical_browser_row_cancelled(row: &TranscriptViewportRow) {
    assert!(row.active_streaming_tail.is_none());
    let link = row
        .operation_links
        .first()
        .expect("browser row should link an operation");
    assert_eq!(link.state, OperationState::Cancelled);
    assert_eq!(
        link.display_facts
            .as_ref()
            .expect("browser row should contain display facts")
            .state,
        OperationState::Cancelled
    );
    let operation = link
        .operation
        .as_ref()
        .expect("browser row should contain its compact operation");
    assert_eq!(operation.operation_state, OperationState::Cancelled);
    assert_eq!(operation.provider_status, ToolCallStatus::InProgress);
}

fn assert_browser_row_running(row: &TranscriptViewportRow) {
    let link = row
        .operation_links
        .first()
        .expect("browser row should link an operation");
    assert_eq!(link.state, OperationState::Running);
    assert_eq!(
        link.display_facts
            .as_ref()
            .expect("browser row should contain display facts")
            .state,
        OperationState::Running
    );
    assert_eq!(
        link.operation
            .as_ref()
            .expect("browser row should contain its compact operation")
            .operation_state,
        OperationState::Running
    );
}

async fn assert_rebuild_needed(db: &DbConn, session_id: &str) {
    let ledger_page = SessionTranscriptRowLedgerRepository::read_tail_page(
        db,
        session_id,
        TRANSCRIPT_ROW_LEDGER_PROJECTION_VERSION,
        128,
    )
    .await
    .expect("rebuild-needed metadata should read");
    let SessionTranscriptRowLedgerRead::Stale { metadata } = ledger_page else {
        panic!("expected ledger to be marked rebuild-needed");
    };
    assert_eq!(
        metadata.rebuild_status,
        SessionTranscriptRowLedgerStatus::RebuildNeeded
    );
}

fn provider_owned_agents_with_history_replay() -> Vec<CanonicalAgentId> {
    vec![
        CanonicalAgentId::ClaudeCode,
        CanonicalAgentId::Copilot,
        CanonicalAgentId::Cursor,
        CanonicalAgentId::OpenCode,
        CanonicalAgentId::Codex,
    ]
}

fn make_tool_call_entry(id: &str) -> StoredEntry {
    StoredEntry::ToolCall {
        id: id.to_string(),
        message: ToolCallData {
            id: id.to_string(),
            name: "Read".to_string(),
            arguments: ToolArguments::Read {
                file_path: Some("/provider/README.md".to_string()),
                source_context: None,
            },
            diagnostic_input: None,
            status: ToolCallStatus::Completed,
            result: None,
            kind: Some(ToolKind::Read),
            title: Some("Read file".to_string()),
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
        timestamp: None,
    }
}

fn make_sparse_tool_call_entry(id: &str) -> StoredEntry {
    StoredEntry::ToolCall {
        id: format!("{id}-sparse-entry"),
        message: ToolCallData {
            id: id.to_string(),
            name: "Read".to_string(),
            arguments: ToolArguments::Read {
                file_path: Some("/provider/README.md".to_string()),
                source_context: None,
            },
            diagnostic_input: None,
            status: ToolCallStatus::Completed,
            result: None,
            kind: Some(ToolKind::Read),
            title: None,
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
        timestamp: None,
    }
}

fn make_running_tool_call_entry(id: &str) -> StoredEntry {
    StoredEntry::ToolCall {
        id: id.to_string(),
        message: ToolCallData {
            id: id.to_string(),
            name: "Read".to_string(),
            arguments: ToolArguments::Read {
                file_path: Some("/provider/README.md".to_string()),
                source_context: None,
            },
            diagnostic_input: None,
            status: ToolCallStatus::InProgress,
            result: None,
            kind: Some(ToolKind::Read),
            title: Some("Read file".to_string()),
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
        timestamp: None,
    }
}

fn make_pending_plan_approval_entry(id: &str) -> StoredEntry {
    StoredEntry::ToolCall {
        id: id.to_string(),
        message: ToolCallData {
            id: id.to_string(),
            name: "create_plan".to_string(),
            arguments: ToolArguments::Other {
                raw: json!({}),
                intent: None,
            },
            diagnostic_input: None,
            status: ToolCallStatus::Pending,
            result: None,
            kind: Some(ToolKind::CreatePlan),
            title: Some("Create plan".to_string()),
            locations: None,
            skill_meta: None,
            normalized_questions: None,
            normalized_todos: None,
            normalized_todo_update: None,
            parent_tool_use_id: None,
            task_children: None,
            question_answer: None,
            awaiting_plan_approval: true,
            plan_approval_request_id: Some(42),
        },
        timestamp: None,
    }
}

fn make_provider_thread_snapshot(entry_id: &str, title: &str) -> SessionThreadSnapshot {
    SessionThreadSnapshot {
        entries: vec![make_tool_call_entry(entry_id)],
        title: title.to_string(),
        created_at: "2026-04-23T00:00:00Z".to_string(),
        current_mode_id: None,
    }
}

fn make_text_block(text: &str) -> StoredContentBlock {
    StoredContentBlock {
        block_type: "text".to_string(),
        text: Some(text.to_string()),
    }
}

fn make_user_entry(id: &str, text: &str) -> StoredEntry {
    StoredEntry::User {
        id: id.to_string(),
        message: StoredUserMessage {
            id: Some(id.to_string()),
            content: make_text_block(text),
            chunks: vec![make_text_block(text)],
            sent_at: None,
        },
        timestamp: None,
    }
}

fn make_assistant_entry(id: &str, text: &str) -> StoredEntry {
    StoredEntry::Assistant {
        id: id.to_string(),
        message: StoredAssistantMessage {
            chunks: vec![StoredAssistantChunk {
                chunk_type: "message".to_string(),
                block: make_text_block(text),
            }],
            model: None,
            display_model: None,
            received_at: None,
        },
        timestamp: None,
    }
}

fn make_provider_pipeline_snapshot(agent_id: &CanonicalAgentId) -> SessionThreadSnapshot {
    let agent_name = agent_id.as_str();
    SessionThreadSnapshot {
        entries: vec![
            make_user_entry(
                &format!("{agent_name}-user-1"),
                &format!("restore {agent_name} session"),
            ),
            make_tool_call_entry(&format!("{agent_name}-tool-read")),
        ],
        title: format!("Restore {agent_name} session"),
        created_at: "2026-04-23T00:00:00Z".to_string(),
        current_mode_id: None,
    }
}

fn make_error_entry(id: &str, text: &str) -> StoredEntry {
    StoredEntry::Error {
        id: id.to_string(),
        message: StoredErrorMessage {
            content: text.to_string(),
            code: Some("401".to_string()),
            details: None,
            kind: TurnErrorKind::Fatal,
            source: Some(TurnErrorSource::Transport),
        },
        timestamp: None,
    }
}

// -----------------------------------------------------------------------
// Happy path: new session returns found with empty state and seq=0
// -----------------------------------------------------------------------
#[tokio::test]
async fn new_session_returns_found_with_empty_state_and_seq_zero() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "new-session-abc123";
    let capabilities = SessionGraphCapabilities {
        models: None,
        modes: None,
        available_commands: Some(vec![AvailableCommand {
            name: "list".to_string(),
            description: "List files".to_string(),
            input: None,
        }]),
        config_options: Some(Vec::new()),
        autonomous_enabled: Some(true),
    };

    let result = session_open_result_for_new_session(
        &db,
        &hub,
        new_session_open_input(session_id, capabilities.clone()),
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    assert_eq!(found.canonical_session_id, session_id);
    assert_eq!(found.requested_session_id, session_id);
    assert!(!found.is_alias);
    assert_eq!(found.last_event_seq, 0);
    assert_eq!(found.transcript_snapshot.revision, 0);
    assert!(found.transcript_snapshot.entries.is_empty());
    assert!(found.operations.is_empty());
    assert!(found.interactions.is_empty());
    assert_eq!(found.turn_state, SessionTurnState::Idle);
    assert_eq!(found.message_count, 0);
    assert_eq!(
        found.lifecycle.status,
        crate::acp::lifecycle::LifecycleStatus::Reserved
    );
    assert!(!found.lifecycle.actionability.can_send);
    assert_eq!(
        found
            .capabilities
            .available_commands
            .as_ref()
            .expect("available commands")
            .len(),
        1
    );
    assert_eq!(found.capabilities.autonomous_enabled, Some(true));
    // open_token must be a valid UUID
    assert!(Uuid::parse_str(&found.open_token).is_ok());
}

// -----------------------------------------------------------------------
// Edge case: new session with pre-existing journal event returns proven seq
// -----------------------------------------------------------------------
#[tokio::test]
async fn new_session_with_seed_journal_event_returns_proven_seq() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "new-with-seed-abc";
    seed_session_metadata(&db, session_id, "copilot").await;
    // Simulate a seed journal event already persisted before open completes
    append_frontier_barrier(&db, session_id).await;

    let result = session_open_result_for_new_session(
        &db,
        &hub,
        new_session_open_input(session_id, SessionGraphCapabilities::empty()),
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    assert_eq!(found.last_event_seq, 1, "seed event should yield seq=1");
    assert_eq!(
        found.graph_revision, 0,
        "delivery allocation must not invent graph progress"
    );
    assert_eq!(
        found.transcript_snapshot.revision, 0,
        "delivery allocation must not invent transcript progress"
    );
}

#[tokio::test]
async fn new_session_open_result_rebuilds_completed_local_journal_transcript() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "local-journal-open";
    seed_session_metadata(&db, session_id, "copilot").await;

    let journal_updates = vec![
        crate::acp::session_update::SessionUpdate::UserMessageChunk {
            chunk: crate::acp::session_update::ContentChunk {
                content: crate::acp::types::ContentBlock::Text {
                    text: "hi".to_string(),
                },
                aggregation_hint: None,
            },
            session_id: Some(session_id.to_string()),
            attempt_id: Some("attempt-1".to_string()),
        },
        crate::acp::session_update::SessionUpdate::AgentMessageChunk {
            chunk: crate::acp::session_update::ContentChunk {
                content: crate::acp::types::ContentBlock::Text {
                    text: "Hi!".to_string(),
                },
                aggregation_hint: None,
            },
            part_id: None,
            message_id: Some("assistant-1".to_string()),
            parent_tool_use_id: None,
            session_id: Some(session_id.to_string()),
            produced_at_monotonic_ms: None,
        },
        crate::acp::session_update::SessionUpdate::TurnComplete {
            session_id: Some(session_id.to_string()),
            turn_id: Some("turn-1".to_string()),
        },
        crate::acp::session_update::SessionUpdate::UserMessageChunk {
            chunk: crate::acp::session_update::ContentChunk {
                content: crate::acp::types::ContentBlock::Text {
                    text: "do you have access to the tauri mcp ?".to_string(),
                },
                aggregation_hint: None,
            },
            session_id: Some(session_id.to_string()),
            attempt_id: Some("attempt-2".to_string()),
        },
        crate::acp::session_update::SessionUpdate::AgentMessageChunk {
            chunk: crate::acp::session_update::ContentChunk {
                content: crate::acp::types::ContentBlock::Text {
                    text: "No — I don't see a Tauri MCP server.".to_string(),
                },
                aggregation_hint: None,
            },
            part_id: None,
            message_id: Some("assistant-2".to_string()),
            parent_tool_use_id: None,
            session_id: Some(session_id.to_string()),
            produced_at_monotonic_ms: None,
        },
        crate::acp::session_update::SessionUpdate::TurnComplete {
            session_id: Some(session_id.to_string()),
            turn_id: Some("turn-2".to_string()),
        },
    ];
    for update in journal_updates {
        SessionEventWriter::commit_session_update(&db, session_id, &update)
            .await
            .expect("append journal update");
    }

    let result = session_open_result_for_new_session(
        &db,
        &hub,
        new_session_open_input(session_id, SessionGraphCapabilities::empty()),
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    let text = found
        .transcript_snapshot
        .entries
        .iter()
        .flat_map(|entry| entry.segments.iter())
        .map(|segment| segment.primary_text())
        .collect::<Vec<_>>();

    assert_eq!(found.last_event_seq, 6);
    assert_eq!(found.message_count, 4);
    assert_eq!(found.transcript_snapshot.revision, 5);
    assert_eq!(
        text,
        vec![
            "hi",
            "Hi!",
            "do you have access to the tauri mcp ?",
            "No — I don't see a Tauri MCP server."
        ]
    );
}

#[tokio::test]
async fn completed_local_journal_open_does_not_infer_graph_revision_from_delivery() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "completed-local-journal-frontiers";
    seed_session_metadata(&db, session_id, "copilot").await;

    let updates = [
        crate::acp::session_update::SessionUpdate::UserMessageChunk {
            chunk: crate::acp::session_update::ContentChunk {
                content: crate::acp::types::ContentBlock::Text {
                    text: "hello".to_string(),
                },
                aggregation_hint: None,
            },
            session_id: Some(session_id.to_string()),
            attempt_id: Some("attempt-1".to_string()),
        },
        crate::acp::session_update::SessionUpdate::AgentMessageChunk {
            chunk: crate::acp::session_update::ContentChunk {
                content: crate::acp::types::ContentBlock::Text {
                    text: "hi".to_string(),
                },
                aggregation_hint: None,
            },
            part_id: None,
            message_id: Some("assistant-1".to_string()),
            parent_tool_use_id: None,
            session_id: Some(session_id.to_string()),
            produced_at_monotonic_ms: None,
        },
        crate::acp::session_update::SessionUpdate::TurnComplete {
            session_id: Some(session_id.to_string()),
            turn_id: Some("turn-1".to_string()),
        },
    ];
    for update in updates {
        SessionEventWriter::commit_session_update(&db, session_id, &update)
            .await
            .expect("append completed local journal update");
    }

    let result = session_open_result_from_completed_local_journal(
        &db,
        &hub,
        &replay_context_for_session(session_id, CanonicalAgentId::Copilot),
        session_id,
        SessionGraphLifecycle::reconnecting(),
        SessionGraphCapabilities::empty(),
    )
    .await
    .expect("completed journal open should succeed")
    .expect("completed journal should produce an open result");

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    assert_eq!(found.last_event_seq, 3);
    assert_eq!(
        found.graph_revision, 0,
        "delivery replay must not invent graph progress"
    );
}

#[tokio::test]
async fn new_session_open_restores_canonical_turn_failure_from_local_journal() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "local-journal-failure-open";
    seed_session_metadata(&db, session_id, "opencode").await;

    let updates = [
        crate::acp::session_update::SessionUpdate::UserMessageChunk {
            chunk: crate::acp::session_update::ContentChunk {
                content: crate::acp::types::ContentBlock::Text {
                    text: "trigger failure".to_string(),
                },
                aggregation_hint: None,
            },
            session_id: Some(session_id.to_string()),
            attempt_id: Some("attempt-1".to_string()),
        },
        crate::acp::session_update::SessionUpdate::TurnError {
            error: crate::acp::session_update::TurnErrorData::Structured(
                crate::acp::session_update::TurnErrorInfo {
                    message: "Model unavailable".to_string(),
                    kind: TurnErrorKind::Recoverable,
                    code: Some("MODEL_NOT_FOUND".to_string()),
                    source: Some(TurnErrorSource::Unknown),
                    details: Some("{\"status\":404}".to_string()),
                },
            ),
            session_id: Some(session_id.to_string()),
            turn_id: None,
        },
    ];
    for update in updates {
        SessionEventWriter::commit_session_update(&db, session_id, &update)
            .await
            .expect("append journal update");
    }

    let result = session_open_result_for_new_session(
        &db,
        &hub,
        new_session_open_input(session_id, SessionGraphCapabilities::empty()),
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    assert_eq!(found.turn_state, SessionTurnState::Failed);
    let failure = found
        .active_turn_failure
        .expect("journaled failure should survive reopen");
    assert_eq!(failure.message, "Model unavailable");
    assert_eq!(failure.code.as_deref(), Some("MODEL_NOT_FOUND"));
    assert_eq!(failure.details.as_deref(), Some("{\"status\":404}"));
    assert_eq!(failure.source, TurnErrorSource::Unknown);
}

#[tokio::test]
async fn provider_thread_snapshot_open_does_not_require_local_snapshot_tables() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "provider-translated-open";
    seed_session_metadata(&db, session_id, "copilot").await;
    append_frontier_barrier(&db, session_id).await;

    let provider_snapshot = make_provider_thread_snapshot("provider-read", "Provider title");
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::Copilot);
    let expected_transcript =
        TranscriptSnapshot::from_stored_entries(1, &provider_snapshot.entries);

    let result = session_open_result_from_thread_snapshot(
        &db,
        &hub,
        None,
        &replay_context,
        session_id,
        &provider_snapshot,
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    assert_eq!(found.last_event_seq, 1);
    assert_eq!(found.transcript_snapshot.revision, 1);
    assert_eq!(found.transcript_snapshot, expected_transcript);
    assert_eq!(
        found.lifecycle.status,
        crate::acp::lifecycle::LifecycleStatus::Reconnecting
    );
    assert!(!found.lifecycle.actionability.can_resume);
    assert!(found.capabilities.available_commands.is_none());
    assert_eq!(found.operations.len(), 1);
    let operation = &found.operations[0];
    assert_eq!(operation.tool_call_id, "provider-read");
    assert_eq!(operation.kind, Some(ToolKind::Read));
    assert_eq!(operation.provider_status, ToolCallStatus::Completed);
    assert_eq!(operation.title.as_deref(), Some("Read file"));
    assert!(matches!(
        operation.arguments,
        ToolArguments::Read {
            file_path: Some(ref file_path),
            ..
        } if file_path == "/provider/README.md"
    ));
}

#[tokio::test]
async fn provider_thread_snapshot_open_prefers_completed_local_journal_transcript() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "provider-stale-local-journal-open";
    seed_session_metadata(&db, session_id, "copilot").await;

    let journal_updates = vec![
        crate::acp::session_update::SessionUpdate::UserMessageChunk {
            chunk: crate::acp::session_update::ContentChunk {
                content: crate::acp::types::ContentBlock::Text {
                    text: "hi".to_string(),
                },
                aggregation_hint: None,
            },
            session_id: Some(session_id.to_string()),
            attempt_id: Some("attempt-1".to_string()),
        },
        crate::acp::session_update::SessionUpdate::AgentMessageChunk {
            chunk: crate::acp::session_update::ContentChunk {
                content: crate::acp::types::ContentBlock::Text {
                    text: "Hello there.".to_string(),
                },
                aggregation_hint: None,
            },
            part_id: None,
            message_id: Some("assistant-1".to_string()),
            parent_tool_use_id: None,
            session_id: Some(session_id.to_string()),
            produced_at_monotonic_ms: None,
        },
        crate::acp::session_update::SessionUpdate::TurnComplete {
            session_id: Some(session_id.to_string()),
            turn_id: Some("turn-1".to_string()),
        },
        crate::acp::session_update::SessionUpdate::UserMessageChunk {
            chunk: crate::acp::session_update::ContentChunk {
                content: crate::acp::types::ContentBlock::Text {
                    text: "second question".to_string(),
                },
                aggregation_hint: None,
            },
            session_id: Some(session_id.to_string()),
            attempt_id: Some("attempt-2".to_string()),
        },
        crate::acp::session_update::SessionUpdate::AgentMessageChunk {
            chunk: crate::acp::session_update::ContentChunk {
                content: crate::acp::types::ContentBlock::Text {
                    text: "Second answer.".to_string(),
                },
                aggregation_hint: None,
            },
            part_id: None,
            message_id: Some("assistant-2".to_string()),
            parent_tool_use_id: None,
            session_id: Some(session_id.to_string()),
            produced_at_monotonic_ms: None,
        },
        crate::acp::session_update::SessionUpdate::TurnComplete {
            session_id: Some(session_id.to_string()),
            turn_id: Some("turn-2".to_string()),
        },
    ];
    for update in journal_updates {
        SessionEventWriter::commit_session_update(&db, session_id, &update)
            .await
            .expect("append journal update");
    }

    let stale_provider_snapshot = SessionThreadSnapshot {
        entries: vec![
            make_user_entry("provider-user-1", "hi"),
            make_assistant_entry("provider-assistant-1", "Hello there."),
        ],
        title: "Stale provider title".to_string(),
        created_at: "2026-04-23T00:00:00Z".to_string(),
        current_mode_id: None,
    };
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::Copilot);

    let result = session_open_result_from_thread_snapshot(
        &db,
        &hub,
        None,
        &replay_context,
        session_id,
        &stale_provider_snapshot,
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    let text = found
        .transcript_snapshot
        .entries
        .iter()
        .flat_map(|entry| entry.segments.iter())
        .map(|segment| segment.primary_text())
        .collect::<Vec<_>>();

    assert_eq!(found.last_event_seq, 6);
    assert_eq!(found.message_count, 4);
    assert_eq!(found.transcript_snapshot.revision, 5);
    assert_eq!(
        text,
        vec!["hi", "Hello there.", "second question", "Second answer."]
    );
}

#[tokio::test]
async fn provider_thread_snapshot_open_preserves_failure_before_frontier_barriers() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "provider-failure-before-barriers-open";
    seed_session_metadata(&db, session_id, "opencode").await;

    let updates = [
        crate::acp::session_update::SessionUpdate::UserMessageChunk {
            chunk: crate::acp::session_update::ContentChunk {
                content: crate::acp::types::ContentBlock::Text {
                    text: "trigger failure".to_string(),
                },
                aggregation_hint: None,
            },
            session_id: Some(session_id.to_string()),
            attempt_id: Some("attempt-1".to_string()),
        },
        crate::acp::session_update::SessionUpdate::TurnError {
            error: crate::acp::session_update::TurnErrorData::Structured(
                crate::acp::session_update::TurnErrorInfo {
                    message: "No endpoints support tool use".to_string(),
                    kind: TurnErrorKind::Recoverable,
                    code: Some("APIError".to_string()),
                    source: Some(TurnErrorSource::Unknown),
                    details: None,
                },
            ),
            session_id: Some(session_id.to_string()),
            turn_id: None,
        },
        crate::acp::session_update::SessionUpdate::TurnComplete {
            session_id: Some(session_id.to_string()),
            turn_id: None,
        },
    ];
    for update in updates {
        SessionEventWriter::commit_session_update(&db, session_id, &update)
            .await
            .expect("append journal update");
    }
    append_frontier_barrier(&db, session_id).await;
    append_frontier_barrier(&db, session_id).await;

    let provider_snapshot = SessionThreadSnapshot {
        entries: vec![make_user_entry("provider-user-1", "trigger failure")],
        title: "Failed provider turn".to_string(),
        created_at: "2026-07-11T00:00:00Z".to_string(),
        current_mode_id: None,
    };
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::OpenCode);

    let result = session_open_result_from_thread_snapshot(
        &db,
        &hub,
        None,
        &replay_context,
        session_id,
        &provider_snapshot,
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    assert_eq!(found.turn_state, SessionTurnState::Failed);
    let failure = found
        .active_turn_failure
        .expect("failure must survive non-semantic frontier barriers");
    assert_eq!(failure.message, "No endpoints support tool use");
}

#[tokio::test]
async fn provider_thread_snapshot_open_keeps_provider_tool_rows_with_local_journal_transcript() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "provider-local-journal-with-skill-tool-open";
    seed_session_metadata(&db, session_id, "copilot").await;

    let journal_updates = vec![
        crate::acp::session_update::SessionUpdate::UserMessageChunk {
            chunk: crate::acp::session_update::ContentChunk {
                content: crate::acp::types::ContentBlock::Text {
                    text: "Can you diagnose this?".to_string(),
                },
                aggregation_hint: None,
            },
            session_id: Some(session_id.to_string()),
            attempt_id: Some("attempt-1".to_string()),
        },
        crate::acp::session_update::SessionUpdate::AgentMessageChunk {
            chunk: crate::acp::session_update::ContentChunk {
                content: crate::acp::types::ContentBlock::Text {
                    text: "The user is invoking the diagnose skill.".to_string(),
                },
                aggregation_hint: None,
            },
            part_id: None,
            message_id: Some("assistant-1".to_string()),
            parent_tool_use_id: None,
            session_id: Some(session_id.to_string()),
            produced_at_monotonic_ms: None,
        },
        crate::acp::session_update::SessionUpdate::TurnComplete {
            session_id: Some(session_id.to_string()),
            turn_id: Some("turn-1".to_string()),
        },
    ];
    for update in journal_updates {
        SessionEventWriter::commit_session_update(&db, session_id, &update)
            .await
            .expect("append journal update");
    }
    for turn_id in ["turn-2", "turn-3", "turn-4"] {
        SessionEventWriter::commit_session_update(
            &db,
            session_id,
            &crate::acp::session_update::SessionUpdate::TurnComplete {
                session_id: Some(session_id.to_string()),
                turn_id: Some(turn_id.to_string()),
            },
        )
        .await
        .expect("append newer local projection update");
    }

    let provider_snapshot = SessionThreadSnapshot {
        entries: vec![
            make_user_entry("provider-user-1", "Can you diagnose this?"),
            make_assistant_entry(
                "provider-assistant-1",
                "The user is invoking the diagnose skill.",
            ),
            StoredEntry::ToolCall {
                id: "toolu_skill".to_string(),
                message: ToolCallData {
                    id: "toolu_skill".to_string(),
                    name: "skill".to_string(),
                    arguments: ToolArguments::Think {
                        description: None,
                        prompt: None,
                        subagent_type: None,
                        skill: Some("diagnose".to_string()),
                        skill_args: None,
                        raw: Some(json!({ "skill": "diagnose" })),
                    },
                    diagnostic_input: None,
                    status: ToolCallStatus::Completed,
                    result: Some(json!({ "content": "Skill loaded" })),
                    kind: Some(ToolKind::Skill),
                    title: Some("diagnose".to_string()),
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
                timestamp: None,
            },
            make_assistant_entry("provider-assistant-2", "I will diagnose it."),
        ],
        title: "Provider title".to_string(),
        created_at: "2026-04-23T00:00:00Z".to_string(),
        current_mode_id: None,
    };
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::Copilot);

    let result = session_open_result_from_thread_snapshot(
        &db,
        &hub,
        None,
        &replay_context,
        session_id,
        &provider_snapshot,
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };

    let roles = found
        .transcript_snapshot
        .entries
        .iter()
        .map(|entry| entry.role.clone())
        .collect::<Vec<_>>();
    let tool_entry = found
        .transcript_snapshot
        .entries
        .iter()
        .find(|entry| entry.role == TranscriptEntryRole::Tool)
        .expect("skill tool transcript row should survive local transcript merge");

    assert_eq!(
        roles,
        vec![
            TranscriptEntryRole::User,
            TranscriptEntryRole::Assistant,
            TranscriptEntryRole::Tool,
        ]
    );
    assert_eq!(
        tool_entry.segments,
        vec![TranscriptSegment::Text {
            segment_id: "acepe::entry::assistant-boundary:1::tool::toolu_skill:tool".to_string(),
            text: "diagnose".to_string(),
        }]
    );
    assert!(found
        .operations
        .iter()
        .any(|operation| operation.tool_call_id == "toolu_skill"
            && operation.kind == Some(ToolKind::Skill)));
}

#[tokio::test]
async fn provider_thread_snapshot_open_includes_new_user_message_after_last_complete_turn() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "provider-stale-local-journal-incomplete-open";
    seed_session_metadata(&db, session_id, "copilot").await;

    let journal_updates = vec![
        crate::acp::session_update::SessionUpdate::UserMessageChunk {
            chunk: crate::acp::session_update::ContentChunk {
                content: crate::acp::types::ContentBlock::Text {
                    text: "first question".to_string(),
                },
                aggregation_hint: None,
            },
            session_id: Some(session_id.to_string()),
            attempt_id: Some("attempt-1".to_string()),
        },
        crate::acp::session_update::SessionUpdate::AgentMessageChunk {
            chunk: crate::acp::session_update::ContentChunk {
                content: crate::acp::types::ContentBlock::Text {
                    text: "First answer.".to_string(),
                },
                aggregation_hint: None,
            },
            part_id: None,
            message_id: Some("assistant-1".to_string()),
            parent_tool_use_id: None,
            session_id: Some(session_id.to_string()),
            produced_at_monotonic_ms: None,
        },
        crate::acp::session_update::SessionUpdate::TurnComplete {
            session_id: Some(session_id.to_string()),
            turn_id: Some("turn-1".to_string()),
        },
        crate::acp::session_update::SessionUpdate::UserMessageChunk {
            chunk: crate::acp::session_update::ContentChunk {
                content: crate::acp::types::ContentBlock::Text {
                    text: "missing question".to_string(),
                },
                aggregation_hint: None,
            },
            session_id: Some(session_id.to_string()),
            attempt_id: Some("attempt-2".to_string()),
        },
    ];
    for update in journal_updates {
        SessionEventWriter::commit_session_update(&db, session_id, &update)
            .await
            .expect("append journal update");
    }

    let stale_provider_snapshot = SessionThreadSnapshot {
        entries: vec![
            make_user_entry("provider-user-1", "first question"),
            make_assistant_entry("provider-assistant-1", "First answer."),
        ],
        title: "Stale provider title".to_string(),
        created_at: "2026-04-23T00:00:00Z".to_string(),
        current_mode_id: None,
    };
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::Copilot);

    let result = session_open_result_from_thread_snapshot(
        &db,
        &hub,
        None,
        &replay_context,
        session_id,
        &stale_provider_snapshot,
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    let text = found
        .transcript_snapshot
        .entries
        .iter()
        .flat_map(|entry| entry.segments.iter())
        .map(|segment| segment.primary_text())
        .collect::<Vec<_>>();

    assert_eq!(found.last_event_seq, 4);
    assert_eq!(found.message_count, 3);
    assert_eq!(found.transcript_snapshot.revision, 4);
    assert_eq!(
        text,
        vec!["first question", "First answer.", "missing question"]
    );
}

#[tokio::test]
async fn provider_thread_snapshot_open_returns_claimable_reconnect_token() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "provider-snapshot-only-open";
    seed_session_metadata(&db, session_id, "copilot").await;

    let provider_snapshot = make_provider_thread_snapshot("provider-read", "Provider title");
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::Copilot);

    let result = session_open_result_from_thread_snapshot(
        &db,
        &hub,
        None,
        &replay_context,
        session_id,
        &provider_snapshot,
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    let token = Uuid::parse_str(&found.open_token).expect("open token must be a UUID");
    assert!(
        hub.has_reservation_for_session(token, session_id),
        "historical provider opens must reserve the reconnect token"
    );
}

#[tokio::test]
async fn provider_owned_open_pipeline_restores_each_builtin_agent_to_canonical_state() {
    for agent_id in provider_owned_agents_with_history_replay() {
        let db = setup_db().await;
        let hub = make_hub();
        let runtime_registry = SessionGraphRuntimeRegistry::new();
        let session_id = format!("{}-pipeline-session", agent_id.as_str());
        seed_session_metadata(&db, &session_id, agent_id.as_str()).await;
        append_frontier_barrier(&db, &session_id).await;
        append_frontier_barrier(&db, &session_id).await;
        append_frontier_barrier(&db, &session_id).await;

        let provider_snapshot = ProviderOwnedSessionSnapshot::from_thread_snapshot(
            make_provider_pipeline_snapshot(&agent_id),
        );
        let replay_context = replay_context_for_session(&session_id, agent_id.clone());

        let result = session_open_result_from_provider_owned_snapshot(
            &db,
            &hub,
            Some(&runtime_registry),
            &replay_context,
            &session_id,
            &provider_snapshot,
        )
        .await;

        let SessionOpenResult::Found(found) = result else {
            panic!("expected Found for {}, got {result:?}", agent_id.as_str());
        };
        assert_eq!(found.agent_id, agent_id);
        assert_eq!(found.canonical_session_id, session_id);
        assert_eq!(found.last_event_seq, 3);
        assert_ne!(
            found.graph_revision, found.last_event_seq,
            "folded provider graph revision must not be replaced by delivery"
        );
        assert_eq!(found.transcript_snapshot.revision, 2);
        assert_eq!(found.transcript_snapshot.entries.len(), 2);
        assert_eq!(
            found.transcript_snapshot.entries[0].role,
            TranscriptEntryRole::User
        );
        assert_eq!(
            found.transcript_snapshot.entries[1].role,
            TranscriptEntryRole::Tool
        );
        assert_eq!(found.operations.len(), 1);
        assert_eq!(
            found.operations[0].source_link,
            OperationSourceLink::TranscriptLinked {
                entry_id: format!(
                    "acepe::entry::assistant-boundary:1::tool::{}-tool-read",
                    agent_id.as_str()
                )
            }
        );
        assert_eq!(
            found.lifecycle.status,
            crate::acp::lifecycle::LifecycleStatus::Reconnecting
        );
        assert!(!found.lifecycle.actionability.can_resume);
        assert!(!found.lifecycle.actionability.can_send);

        let token = Uuid::parse_str(&found.open_token).expect("open token must be a UUID");
        assert!(
            hub.has_reservation_for_session(token, &session_id),
            "open token should be reserved for {}",
            agent_id.as_str()
        );

        let runtime_snapshot = runtime_registry.snapshot_for_session(&session_id);
        assert_eq!(runtime_snapshot.graph_revision, found.graph_revision);
        assert_eq!(
            runtime_snapshot.lifecycle.status,
            crate::acp::lifecycle::LifecycleStatus::Reconnecting
        );
    }
}

#[tokio::test]
async fn provider_thread_snapshot_open_normalizes_tool_transcript_ids_to_match_operations() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "provider-normalized-tool-open";
    seed_session_metadata(&db, session_id, "cursor").await;
    append_frontier_barrier(&db, session_id).await;

    let provider_snapshot =
        make_provider_thread_snapshot("provider-tool\ncursor-call", "Provider title");
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::Cursor);

    let result = session_open_result_from_thread_snapshot(
        &db,
        &hub,
        None,
        &replay_context,
        session_id,
        &provider_snapshot,
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    assert_eq!(found.transcript_snapshot.entries.len(), 1);
    assert_eq!(
        found.transcript_snapshot.entries[0].entry_id,
        "acepe::entry::session-start::tool::provider-tool%0Acursor-call"
    );
    assert_eq!(
        found.transcript_snapshot.entries[0].segments,
        vec![crate::acp::transcript_projection::TranscriptSegment::Text {
            segment_id: "acepe::entry::session-start::tool::provider-tool%0Acursor-call:tool"
                .to_string(),
            text: "Read file".to_string(),
        }]
    );
    assert_eq!(found.operations.len(), 1);
    let operation = &found.operations[0];
    assert_eq!(operation.tool_call_id, "provider-tool%0Acursor-call");
    assert_eq!(
        operation.source_link,
        crate::acp::projections::OperationSourceLink::TranscriptLinked {
            entry_id: "acepe::entry::session-start::tool::provider-tool%0Acursor-call".to_string()
        }
    );
    assert_ne!(
        operation.operation_state,
        crate::acp::projections::OperationState::Degraded
    );
}

#[tokio::test]
async fn provider_thread_snapshot_open_titles_placeholder_metadata_from_first_user_message() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "b859c458-ca4f-4c31-a3aa-6c606a1c065f";
    seed_session_metadata(&db, session_id, "claude-code").await;
    append_frontier_barrier(&db, session_id).await;

    let snapshot = SessionThreadSnapshot {
        entries: vec![make_user_entry(
            "user-1",
            "please enable anti alias in acepe.",
        )],
        title: "Session b859c458".to_string(),
        created_at: "2026-04-23T00:00:00Z".to_string(),
        current_mode_id: None,
    };
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::ClaudeCode);

    let result = session_open_result_from_thread_snapshot(
        &db,
        &hub,
        None,
        &replay_context,
        session_id,
        &snapshot,
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    assert_eq!(found.session_title, "please enable anti alias in acepe.");
}

#[tokio::test]
async fn provider_thread_snapshot_open_keeps_renamed_title_over_first_user_message() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "renamed-session-title";
    seed_session_metadata(&db, session_id, "claude-code").await;
    SessionMetadataRepository::set_title_override(&db, session_id, Some("Renamed by user"))
        .await
        .expect("set title override");
    append_frontier_barrier(&db, session_id).await;

    let snapshot = SessionThreadSnapshot {
        entries: vec![make_user_entry(
            "user-1",
            "please enable anti alias in acepe.",
        )],
        title: "please enable anti alias in acepe.".to_string(),
        created_at: "2026-04-23T00:00:00Z".to_string(),
        current_mode_id: None,
    };
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::ClaudeCode);

    let result = session_open_result_from_thread_snapshot(
        &db,
        &hub,
        None,
        &replay_context,
        session_id,
        &snapshot,
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    assert_eq!(found.session_title, "Renamed by user");
}

#[tokio::test]
async fn provider_thread_snapshot_open_restores_runtime_lifecycle_for_attach() {
    let db = setup_db().await;
    let hub = make_hub();
    let runtime_registry = SessionGraphRuntimeRegistry::new();
    let session_id = "provider-open-runtime-restore";
    seed_session_metadata(&db, session_id, "copilot").await;
    append_frontier_barrier(&db, session_id).await;

    let provider_snapshot = make_provider_thread_snapshot("provider-read", "Provider title");
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::Copilot);

    let result = session_open_result_from_thread_snapshot(
        &db,
        &hub,
        Some(&runtime_registry),
        &replay_context,
        session_id,
        &provider_snapshot,
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    let runtime_snapshot = runtime_registry.snapshot_for_session(session_id);

    assert_eq!(runtime_snapshot.graph_revision, found.graph_revision);
    assert_eq!(
        runtime_snapshot.lifecycle.status,
        crate::acp::lifecycle::LifecycleStatus::Reconnecting
    );
    assert_eq!(runtime_snapshot.lifecycle.detached_reason, None);
}

#[tokio::test]
async fn provider_thread_snapshot_open_merges_replayed_operation_evidence() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "provider-duplicate-operation-open";
    seed_session_metadata(&db, session_id, "copilot").await;
    append_frontier_barrier(&db, session_id).await;

    let provider_snapshot = SessionThreadSnapshot {
        entries: vec![
            make_tool_call_entry("provider-read"),
            make_sparse_tool_call_entry("provider-read"),
        ],
        title: "Provider title".to_string(),
        created_at: "2026-04-23T00:00:00Z".to_string(),
        current_mode_id: None,
    };
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::Copilot);

    let result = session_open_result_from_thread_snapshot(
        &db,
        &hub,
        None,
        &replay_context,
        session_id,
        &provider_snapshot,
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    assert_eq!(found.operations.len(), 1);
    let operation = &found.operations[0];
    assert_eq!(operation.tool_call_id, "provider-read");
    assert_eq!(operation.title.as_deref(), Some("Read file"));
    assert_eq!(operation.kind, Some(ToolKind::Read));
    assert_eq!(operation.provider_status, ToolCallStatus::Completed);
}

#[tokio::test]
async fn provider_thread_snapshot_open_does_not_treat_delivery_barriers_as_graph_progress() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "provider-stale-active-operation-open";
    seed_session_metadata(&db, session_id, "copilot").await;
    append_frontier_barrier(&db, session_id).await;
    append_frontier_barrier(&db, session_id).await;

    let provider_snapshot = SessionThreadSnapshot {
        entries: vec![make_running_tool_call_entry("provider-read")],
        title: "Provider title".to_string(),
        created_at: "2026-04-23T00:00:00Z".to_string(),
        current_mode_id: None,
    };
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::Copilot);

    let result = session_open_result_from_thread_snapshot(
        &db,
        &hub,
        None,
        &replay_context,
        session_id,
        &provider_snapshot,
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    assert_eq!(found.last_event_seq, 2);
    assert_eq!(found.graph_revision, 1);
    assert_eq!(found.turn_state, SessionTurnState::Completed);
    assert_eq!(found.operations.len(), 1);
    let operation = &found.operations[0];
    assert_eq!(
        operation.operation_state,
        crate::acp::projections::OperationState::Cancelled
    );
}

#[tokio::test]
async fn provider_thread_snapshot_open_closes_historical_active_operation_without_journal_gap() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "provider-historical-active-operation-open";
    seed_session_metadata(&db, session_id, "copilot").await;

    let provider_snapshot = SessionThreadSnapshot {
        entries: vec![make_running_tool_call_entry("provider-read")],
        title: "Provider title".to_string(),
        created_at: "2026-04-23T00:00:00Z".to_string(),
        current_mode_id: None,
    };
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::Copilot);

    let result = session_open_result_from_thread_snapshot(
        &db,
        &hub,
        None,
        &replay_context,
        session_id,
        &provider_snapshot,
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    assert_eq!(found.turn_state, SessionTurnState::Completed);
    assert_eq!(found.operations.len(), 1);
    let operation = &found.operations[0];
    assert_eq!(operation.tool_call_id, "provider-read");
    assert_eq!(operation.provider_status, ToolCallStatus::InProgress);
    assert_eq!(
        operation.operation_state,
        crate::acp::projections::OperationState::Cancelled
    );
}

#[tokio::test]
async fn provider_thread_snapshot_open_does_not_reopen_tool_interrupted_by_later_user_message() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "provider-user-boundary-tool-open";
    seed_session_metadata(&db, session_id, "copilot").await;

    let provider_snapshot = SessionThreadSnapshot {
        entries: vec![
            make_running_tool_call_entry("provider-write"),
            make_user_entry("user-resumed", "i ran the command myself, proceed"),
        ],
        title: "Provider title".to_string(),
        created_at: "2026-04-23T00:00:00Z".to_string(),
        current_mode_id: None,
    };
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::Copilot);

    let result = session_open_result_from_thread_snapshot(
        &db,
        &hub,
        None,
        &replay_context,
        session_id,
        &provider_snapshot,
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    assert_eq!(found.turn_state, SessionTurnState::Completed);
    assert!(!found.lifecycle.actionability.can_send);
    assert_eq!(found.operations.len(), 1);
    let operation = &found.operations[0];
    assert_eq!(operation.tool_call_id, "provider-write");
    assert_eq!(operation.provider_status, ToolCallStatus::InProgress);
    assert_eq!(
        operation.operation_state,
        crate::acp::projections::OperationState::Cancelled
    );
}

#[tokio::test]
async fn provider_thread_snapshot_open_marks_historical_pending_interactions_unresolved() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "provider-historical-pending-interaction-open";
    seed_session_metadata(&db, session_id, "copilot").await;

    let provider_snapshot = SessionThreadSnapshot {
        entries: vec![make_pending_plan_approval_entry("provider-plan")],
        title: "Provider title".to_string(),
        created_at: "2026-04-23T00:00:00Z".to_string(),
        current_mode_id: None,
    };
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::Copilot);

    let result = session_open_result_from_thread_snapshot(
        &db,
        &hub,
        None,
        &replay_context,
        session_id,
        &provider_snapshot,
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    assert_eq!(found.turn_state, SessionTurnState::Completed);
    assert_eq!(found.interactions.len(), 1);
    let interaction = &found.interactions[0];
    assert_eq!(interaction.state, InteractionState::Unresolved);
    assert!(interaction.reply_handler.is_none());
    assert_eq!(found.operations.len(), 1);
    assert_eq!(
        found.operations[0].operation_state,
        crate::acp::projections::OperationState::Cancelled
    );
}

#[tokio::test]
async fn provider_thread_snapshot_open_does_not_reactivate_stale_historical_error() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "provider-stale-error-open";
    seed_session_metadata(&db, session_id, "claude-code").await;
    append_frontier_barrier(&db, session_id).await;
    append_frontier_barrier(&db, session_id).await;
    append_frontier_barrier(&db, session_id).await;

    let provider_snapshot = SessionThreadSnapshot {
        entries: vec![
            make_user_entry("user-1", "hi"),
            make_error_entry(
                "error-1",
                "Failed to authenticate. API Error: 401 {\"error\":{\"message\":\"User not found.\",\"code\":401}}",
            ),
        ],
        title: "hi".to_string(),
        created_at: "2026-04-23T00:00:00Z".to_string(),
        current_mode_id: None,
    };
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::ClaudeCode);

    let result = session_open_result_from_thread_snapshot(
        &db,
        &hub,
        None,
        &replay_context,
        session_id,
        &provider_snapshot,
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    assert_eq!(found.last_event_seq, 3);
    assert_eq!(found.graph_revision, 0);
    assert_eq!(found.turn_state, SessionTurnState::Completed);
    assert!(found.active_turn_failure.is_none());
    assert_eq!(found.transcript_snapshot.entries.len(), 1);
}

#[tokio::test]
async fn provider_thread_snapshot_open_marks_alias_request_without_rewriting_canonical_id() {
    let db = setup_db().await;
    let hub = make_hub();
    let canonical_session_id = "canonical-provider-session";
    let requested_session_id = "provider-session-alias";
    seed_session_metadata(&db, canonical_session_id, "copilot").await;
    let provider_snapshot = make_provider_thread_snapshot("provider-read", "Provider title");
    let replay_context =
        replay_context_for_session(canonical_session_id, CanonicalAgentId::Copilot);

    let result = session_open_result_from_thread_snapshot(
        &db,
        &hub,
        None,
        &replay_context,
        requested_session_id,
        &provider_snapshot,
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    assert!(found.is_alias);
    assert_eq!(found.requested_session_id, requested_session_id);
    assert_eq!(found.canonical_session_id, canonical_session_id);
}

fn completed_operation_with_payload(session_id: &str, index: usize) -> OperationSnapshot {
    OperationSnapshot {
        id: format!("op-{index}"),
        session_id: session_id.to_string(),
        tool_call_id: format!("tool-{index}"),
        name: "Read".to_string(),
        kind: Some(ToolKind::Read),
        provider_status: ToolCallStatus::Completed,
        title: Some("Historical read".to_string()),
        arguments: ToolArguments::Other {
            raw: json!({
                "payload": "x".repeat(3_000)
            }),
            intent: None,
        },
        progressive_arguments: None,
        result: Some(json!({
            "content": "x".repeat(3_000)
        })),
        computer_payload: None,
        command: Some("x".repeat(1_024)),
        normalized_todos: None,
        parent_tool_call_id: None,
        parent_operation_id: None,
        child_tool_call_ids: Vec::new(),
        child_operation_ids: Vec::new(),
        operation_provenance_key: None,
        operation_state: OperationState::Completed,
        locations: None,
        skill_meta: None,
        normalized_questions: None,
        question_answer: None,
        awaiting_plan_approval: false,
        plan_approval_request_id: None,
        started_at_ms: None,
        completed_at_ms: None,
        source_link: OperationSourceLink::Synthetic {
            reason: "test".to_string(),
        },
        degradation_reason: None,
    }
}

fn running_operation(session_id: &str) -> OperationSnapshot {
    let mut operation = completed_operation_with_payload(session_id, 10_000);
    operation.id = "op-running".to_string();
    operation.tool_call_id = "tool-running".to_string();
    operation.provider_status = ToolCallStatus::InProgress;
    operation.operation_state = OperationState::Running;
    operation
}

fn compact_completed_execute_operation(session_id: &str, index: usize) -> OperationSnapshot {
    OperationSnapshot {
        id: format!("op-display-{index}"),
        session_id: session_id.to_string(),
        tool_call_id: format!("tool-display-{index}"),
        name: "exec_command".to_string(),
        kind: Some(ToolKind::Execute),
        provider_status: ToolCallStatus::Completed,
        title: Some("exec_command".to_string()),
        arguments: ToolArguments::Execute {
            command: Some(format!("echo {index}")),
        },
        progressive_arguments: None,
        result: Some(json!(format!("ok {index}"))),
        computer_payload: None,
        command: Some(format!("echo {index}")),
        normalized_todos: None,
        parent_tool_call_id: None,
        parent_operation_id: None,
        child_tool_call_ids: Vec::new(),
        child_operation_ids: Vec::new(),
        operation_provenance_key: Some(format!("tool-display-{index}")),
        operation_state: OperationState::Completed,
        locations: None,
        skill_meta: None,
        normalized_questions: None,
        question_answer: None,
        awaiting_plan_approval: false,
        plan_approval_request_id: None,
        started_at_ms: None,
        completed_at_ms: None,
        source_link: OperationSourceLink::transcript_linked(format!(
            "acepe::entry::assistant-boundary:{index}::tool::tool-display-{index}"
        )),
        degradation_reason: None,
    }
}

fn viewport_envelope_for_operation(
    session_id: &str,
    operation: &OperationSnapshot,
) -> crate::acp::session_state_engine::SessionStateEnvelope {
    crate::acp::session_state_engine::SessionStateEnvelope {
        session_id: session_id.to_string(),
        graph_revision: 12,
        last_event_seq: 12,
        payload: crate::acp::session_state_engine::SessionStatePayload::ViewportBufferPush {
            push: crate::acp::session_state_engine::ViewportBufferPush {
                session_id: session_id.to_string(),
                graph_revision: crate::acp::session_state_engine::SessionGraphRevision::new(
                    12, 11, 12,
                ),
                emission_seq: 1,
                rows: vec![crate::acp::transcript_viewport::TranscriptViewportRow {
                    row_id: format!("transcript:{}", operation.tool_call_id),
                    source_entry_id: operation.tool_call_id.clone(),
                    scope: crate::acp::transcript_projection::TranscriptScope::Root,
                    kind: crate::acp::transcript_viewport::TranscriptViewportRowKind::Tool,
                    version: "visible-op-version".to_string(),
                    anchor_eligible: true,
                    active_streaming_tail: None,
                    operation_links: vec![
                        crate::acp::transcript_viewport::TranscriptViewportOperationLink {
                            operation_id: operation.id.clone(),
                            tool_call_id: operation.tool_call_id.clone(),
                            name: operation.name.clone(),
                            state: operation.operation_state.clone(),
                            display_facts: None,
                            operation: None,
                        },
                    ],
                    interaction_links: Vec::new(),
                    content:
                        crate::acp::transcript_viewport::TranscriptViewportRowContent::Transcript {
                            role: TranscriptEntryRole::Tool,
                            segments: Vec::new(),
                        },
                    duration_started_at_ms: None,
                    timestamp_ms: None,
                }],
                request_generation: None,
                diagnostics: Vec::new(),
            },
        },
    }
}

#[test]
fn oversized_open_result_compacts_transcript_body_for_ipc() {
    let result = SessionOpenResult::Found(Box::new(SessionOpenFound {
        requested_session_id: "requested-oversized".to_string(),
        canonical_session_id: "canonical-oversized".to_string(),
        is_alias: false,
        last_event_seq: 12,
        graph_revision: 12,
        open_token: "open-token-oversized".to_string(),
        agent_id: CanonicalAgentId::ClaudeCode,
        project_path: "/test/project".to_string(),
        worktree_path: None,
        source_path: None,
        sequence_id: None,
        transcript_snapshot: TranscriptSnapshot {
            revision: 11,
            entries: vec![crate::acp::transcript_projection::TranscriptEntry {
                scope: crate::acp::transcript_projection::TranscriptScope::Root,
                entry_id: "assistant-large".to_string(),
                role: TranscriptEntryRole::Assistant,
                segments: vec![TranscriptSegment::Text {
                    segment_id: "assistant-large:text".to_string(),
                    text: "x".repeat(2_100_000),
                }],
                attempt_id: None,
                timestamp_ms: None,
            }],
        },
        session_title: "Large restored session".to_string(),
        operations: vec![OperationSnapshot {
            id: "op-large".to_string(),
            session_id: "canonical-oversized".to_string(),
            tool_call_id: "tool-large".to_string(),
            name: "Read".to_string(),
            kind: Some(ToolKind::Read),
            provider_status: ToolCallStatus::Completed,
            title: Some("Large read".to_string()),
            arguments: ToolArguments::Other {
                raw: json!({
                    "payload": "x".repeat(2_100_000)
                }),
                intent: None,
            },
            progressive_arguments: Some(ToolArguments::Other {
                raw: json!({
                    "payload": "x".repeat(2_100_000)
                }),
                intent: None,
            }),
            result: Some(json!({
                "content": "x".repeat(2_100_000)
            })),
            computer_payload: None,
            command: Some("x".repeat(2_100_000)),
            normalized_todos: None,
            parent_tool_call_id: None,
            parent_operation_id: None,
            child_tool_call_ids: Vec::new(),
            child_operation_ids: Vec::new(),
            operation_provenance_key: None,
            operation_state: OperationState::Completed,
            locations: None,
            skill_meta: None,
            normalized_questions: None,
            question_answer: None,
            awaiting_plan_approval: false,
            plan_approval_request_id: None,
            started_at_ms: None,
            completed_at_ms: None,
            source_link: OperationSourceLink::Synthetic {
                reason: "test".to_string(),
            },
            degradation_reason: None,
        }],
        interactions: Vec::new(),
        turn_state: SessionTurnState::Idle,
        message_count: 1,
        activity: crate::acp::session_state_engine::SessionGraphActivity::idle(),
        active_streaming_tail: None,
        lifecycle: SessionGraphLifecycle::detached(
            crate::acp::lifecycle::DetachedReason::RestoredRequiresAttach,
        ),
        capabilities: SessionGraphCapabilities::empty(),
        open_path: crate::acp::session_open_snapshot::SessionOpenPath::CompatSnapshot,
        initial_transcript_row_page: None,
        initial_viewport_envelope: None,
        open_result_timing: None,
        active_turn_failure: None,
        last_terminal_turn_id: None,
    }));

    let compacted = compact_oversized_session_open_result(result);
    let byte_len = serde_json::to_vec(&compacted)
        .expect("compacted open result should serialize")
        .len();

    let SessionOpenResult::Found(found) = compacted else {
        panic!("expected compacted found result");
    };
    assert!(found.transcript_snapshot.entries.is_empty());
    assert_eq!(found.transcript_snapshot.revision, 11);
    assert_eq!(found.message_count, 1);
    assert_eq!(found.session_title, "Large restored session");
    assert_eq!(found.operations.len(), 1);
    assert!(
        serde_json::to_vec(&found.operations[0])
            .expect("operation serializes")
            .len()
            < 32_000
    );
    assert!(
        byte_len <= crate::acp::session_state_engine::SessionStatePayloadKind::Snapshot.max_bytes()
    );
}

#[test]
fn oversized_open_result_keeps_compact_completed_operations_when_they_fit() {
    let session_id = "canonical-compact-display-ops";
    let operation_count = super::snapshot::SESSION_OPEN_TRANSCRIPT_COMPACTION_ENTRY_THRESHOLD + 100;
    let operations: Vec<OperationSnapshot> = (0..operation_count)
        .map(|index| compact_completed_execute_operation(session_id, index))
        .collect();
    let entries: Vec<TranscriptEntry> = (0..operation_count)
        .map(|index| TranscriptEntry {
            scope: crate::acp::transcript_projection::TranscriptScope::Root,
            entry_id: format!(
                "acepe::entry::assistant-boundary:{index}::tool::tool-display-{index}"
            ),
            role: TranscriptEntryRole::Tool,
            segments: Vec::new(),
            attempt_id: None,
            timestamp_ms: None,
        })
        .collect();
    let result = SessionOpenResult::Found(Box::new(SessionOpenFound {
        requested_session_id: "requested-compact-display-ops".to_string(),
        canonical_session_id: session_id.to_string(),
        is_alias: false,
        last_event_seq: 12,
        graph_revision: 12,
        open_token: "open-token-compact-display-ops".to_string(),
        agent_id: CanonicalAgentId::Codex,
        project_path: "/test/project".to_string(),
        worktree_path: None,
        source_path: None,
        sequence_id: None,
        transcript_snapshot: TranscriptSnapshot {
            revision: 11,
            entries,
        },
        session_title: "Many compact operation restored session".to_string(),
        operations,
        interactions: Vec::new(),
        turn_state: SessionTurnState::Idle,
        message_count: operation_count as u64,
        activity: crate::acp::session_state_engine::SessionGraphActivity::idle(),
        active_streaming_tail: None,
        lifecycle: SessionGraphLifecycle::detached(
            crate::acp::lifecycle::DetachedReason::RestoredRequiresAttach,
        ),
        capabilities: SessionGraphCapabilities::empty(),
        open_path: crate::acp::session_open_snapshot::SessionOpenPath::CompatSnapshot,
        initial_transcript_row_page: None,
        initial_viewport_envelope: None,
        open_result_timing: None,
        active_turn_failure: None,
        last_terminal_turn_id: None,
    }));

    let compacted = compact_oversized_session_open_result(result);
    let byte_len = serde_json::to_vec(&compacted)
        .expect("compacted open result should serialize")
        .len();

    let SessionOpenResult::Found(found) = compacted else {
        panic!("expected compacted found result");
    };
    assert!(found.transcript_snapshot.entries.is_empty());
    assert_eq!(found.operations.len(), operation_count);
    assert!(found.operations.iter().any(|operation| {
        operation.tool_call_id == "tool-display-42"
            && operation.command.as_deref() == Some("echo 42")
            && matches!(
                operation.source_link,
                OperationSourceLink::TranscriptLinked { .. }
            )
    }));
    assert!(
        byte_len <= crate::acp::session_state_engine::SessionStatePayloadKind::Snapshot.max_bytes()
    );
}

#[test]
fn oversized_open_result_drops_historical_operations_when_still_over_budget() {
    let session_id = "canonical-many-ops";
    let mut operations: Vec<OperationSnapshot> = (0..4_000)
        .map(|index| completed_operation_with_payload(session_id, index))
        .collect();
    operations.push(running_operation(session_id));
    let result = SessionOpenResult::Found(Box::new(SessionOpenFound {
        requested_session_id: "requested-many-ops".to_string(),
        canonical_session_id: session_id.to_string(),
        is_alias: false,
        last_event_seq: 12,
        graph_revision: 12,
        open_token: "open-token-many-ops".to_string(),
        agent_id: CanonicalAgentId::ClaudeCode,
        project_path: "/test/project".to_string(),
        worktree_path: None,
        source_path: None,
        sequence_id: None,
        transcript_snapshot: TranscriptSnapshot {
            revision: 11,
            entries: vec![TranscriptEntry {
                scope: crate::acp::transcript_projection::TranscriptScope::Root,
                entry_id: "assistant-large".to_string(),
                role: TranscriptEntryRole::Assistant,
                segments: vec![TranscriptSegment::Text {
                    segment_id: "assistant-large:text".to_string(),
                    text: "x".repeat(2_100_000),
                }],
                attempt_id: None,
                timestamp_ms: None,
            }],
        },
        session_title: "Many operation restored session".to_string(),
        operations,
        interactions: Vec::new(),
        turn_state: SessionTurnState::Idle,
        message_count: 1,
        activity: crate::acp::session_state_engine::SessionGraphActivity::idle(),
        active_streaming_tail: None,
        lifecycle: SessionGraphLifecycle::detached(
            crate::acp::lifecycle::DetachedReason::RestoredRequiresAttach,
        ),
        capabilities: SessionGraphCapabilities::empty(),
        open_path: crate::acp::session_open_snapshot::SessionOpenPath::CompatSnapshot,
        initial_transcript_row_page: None,
        initial_viewport_envelope: None,
        open_result_timing: None,
        active_turn_failure: None,
        last_terminal_turn_id: None,
    }));

    let compacted = compact_oversized_session_open_result(result);
    let byte_len = serde_json::to_vec(&compacted)
        .expect("compacted open result should serialize")
        .len();

    let SessionOpenResult::Found(found) = compacted else {
        panic!("expected compacted found result");
    };
    assert!(found.transcript_snapshot.entries.is_empty());
    assert_eq!(found.operations.len(), 1);
    assert_eq!(found.operations[0].id, "op-running");
    assert!(
        byte_len <= crate::acp::session_state_engine::SessionStatePayloadKind::Snapshot.max_bytes()
    );
}

#[test]
fn oversized_open_result_keeps_initial_viewport_operations_before_actionable_fallback() {
    let session_id = "canonical-many-ops-visible-tool";
    let visible_operation = completed_operation_with_payload(session_id, 42);
    let mut operations: Vec<OperationSnapshot> = (0..4_000)
        .map(|index| completed_operation_with_payload(session_id, index))
        .collect();
    operations.push(running_operation(session_id));
    let result = SessionOpenResult::Found(Box::new(SessionOpenFound {
        requested_session_id: "requested-many-ops-visible-tool".to_string(),
        canonical_session_id: session_id.to_string(),
        is_alias: false,
        last_event_seq: 12,
        graph_revision: 12,
        open_token: "open-token-many-ops-visible-tool".to_string(),
        agent_id: CanonicalAgentId::Codex,
        project_path: "/test/project".to_string(),
        worktree_path: None,
        source_path: None,
        sequence_id: None,
        transcript_snapshot: TranscriptSnapshot {
            revision: 11,
            entries: vec![TranscriptEntry {
                scope: crate::acp::transcript_projection::TranscriptScope::Root,
                entry_id: "assistant-large".to_string(),
                role: TranscriptEntryRole::Assistant,
                segments: vec![TranscriptSegment::Text {
                    segment_id: "assistant-large:text".to_string(),
                    text: "x".repeat(2_100_000),
                }],
                attempt_id: None,
                timestamp_ms: None,
            }],
        },
        session_title: "Many operation restored session with visible tool".to_string(),
        operations,
        interactions: Vec::new(),
        turn_state: SessionTurnState::Idle,
        message_count: 1,
        activity: crate::acp::session_state_engine::SessionGraphActivity::idle(),
        active_streaming_tail: None,
        lifecycle: SessionGraphLifecycle::detached(
            crate::acp::lifecycle::DetachedReason::RestoredRequiresAttach,
        ),
        capabilities: SessionGraphCapabilities::empty(),
        open_path: crate::acp::session_open_snapshot::SessionOpenPath::CompatSnapshot,
        initial_transcript_row_page: None,
        initial_viewport_envelope: Some(viewport_envelope_for_operation(
            session_id,
            &visible_operation,
        )),
        open_result_timing: None,
        active_turn_failure: None,
        last_terminal_turn_id: None,
    }));

    let compacted = compact_oversized_session_open_result(result);
    let byte_len = serde_json::to_vec(&compacted)
        .expect("compacted open result should serialize")
        .len();

    let SessionOpenResult::Found(found) = compacted else {
        panic!("expected compacted found result");
    };
    assert!(found.transcript_snapshot.entries.is_empty());
    assert!(found
        .operations
        .iter()
        .any(|operation| operation.id == "op-42" && operation.command.is_some()));
    assert!(found
        .operations
        .iter()
        .any(|operation| operation.id == "op-running"));
    assert!(
        byte_len <= crate::acp::session_state_engine::SessionStatePayloadKind::Snapshot.max_bytes()
    );
}

#[test]
fn large_entry_count_open_result_compacts_transcript_body_before_full_byte_count() {
    let entry_count = super::snapshot::SESSION_OPEN_TRANSCRIPT_COMPACTION_ENTRY_THRESHOLD + 1;
    let entries = (0..entry_count)
        .map(|index| TranscriptEntry {
            scope: crate::acp::transcript_projection::TranscriptScope::Root,
            entry_id: format!("assistant-{index}"),
            role: TranscriptEntryRole::Assistant,
            segments: vec![TranscriptSegment::Text {
                segment_id: format!("assistant-{index}:text"),
                text: "small row".to_string(),
            }],
            attempt_id: None,
            timestamp_ms: None,
        })
        .collect();

    let result = SessionOpenResult::Found(Box::new(SessionOpenFound {
        requested_session_id: "requested-many-entries".to_string(),
        canonical_session_id: "canonical-many-entries".to_string(),
        is_alias: false,
        last_event_seq: 12,
        graph_revision: 12,
        open_token: "open-token-many-entries".to_string(),
        agent_id: CanonicalAgentId::ClaudeCode,
        project_path: "/test/project".to_string(),
        worktree_path: None,
        source_path: None,
        sequence_id: None,
        transcript_snapshot: TranscriptSnapshot {
            revision: 11,
            entries,
        },
        session_title: "Many row restored session".to_string(),
        operations: Vec::new(),
        interactions: Vec::new(),
        turn_state: SessionTurnState::Idle,
        message_count: entry_count as u64,
        activity: crate::acp::session_state_engine::SessionGraphActivity::idle(),
        active_streaming_tail: None,
        lifecycle: SessionGraphLifecycle::detached(
            crate::acp::lifecycle::DetachedReason::RestoredRequiresAttach,
        ),
        capabilities: SessionGraphCapabilities::empty(),
        open_path: crate::acp::session_open_snapshot::SessionOpenPath::CompatSnapshot,
        initial_transcript_row_page: None,
        initial_viewport_envelope: None,
        open_result_timing: None,
        active_turn_failure: None,
        last_terminal_turn_id: None,
    }));

    let compacted = compact_oversized_session_open_result(result);

    let SessionOpenResult::Found(found) = compacted else {
        panic!("expected compacted found result");
    };
    assert!(found.transcript_snapshot.entries.is_empty());
    assert_eq!(found.transcript_snapshot.revision, 11);
    assert_eq!(found.message_count, entry_count as u64);
    assert_eq!(found.session_title, "Many row restored session");
}

#[tokio::test]
async fn provider_owned_alias_open_keys_viewport_authority_to_canonical_id_only() {
    let db = setup_db().await;
    let hub = make_hub();
    let runtime_registry = SessionGraphRuntimeRegistry::new();
    let projection_registry = crate::acp::projections::ProjectionRegistry::new();
    let transcript_projection_registry =
        crate::acp::transcript_projection::TranscriptProjectionRegistry::new();
    let canonical_session_id = "canonical-provider-owned-session";
    let requested_session_id = "provider-owned-session-alias";
    seed_session_metadata(&db, canonical_session_id, "copilot").await;
    append_frontier_barrier(&db, canonical_session_id).await;

    let provider_snapshot = ProviderOwnedSessionSnapshot::from_thread_snapshot(
        make_provider_pipeline_snapshot(&CanonicalAgentId::Copilot),
    );
    let replay_context =
        replay_context_for_session(canonical_session_id, CanonicalAgentId::Copilot);

    let result = session_open_result_from_provider_owned_snapshot(
        &db,
        &hub,
        Some(&runtime_registry),
        &replay_context,
        requested_session_id,
        &provider_snapshot,
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    assert!(found.is_alias);
    let initial_viewport_envelope = found
        .initial_viewport_envelope
        .as_ref()
        .expect("provider-owned open should include the initial viewport buffer");
    assert_eq!(
        initial_viewport_envelope.session_id,
        found.canonical_session_id
    );
    match &initial_viewport_envelope.payload {
        crate::acp::session_state_engine::SessionStatePayload::ViewportBufferPush { push } => {
            assert_eq!(push.session_id, canonical_session_id);
            assert!(!push.rows.is_empty());
        }
        other => panic!("expected initial viewport buffer push, got {other:?}"),
    }

    // Mirror restore_session_open_authority: canonical-keyed transcript +
    // projection registries are the sole viewport authority.
    transcript_projection_registry.restore_session_snapshot(
        found.canonical_session_id.clone(),
        found.transcript_snapshot.clone(),
    );
    projection_registry.restore_session_projection(
        crate::acp::projections::SessionProjectionSnapshot {
            session: Some(crate::acp::projections::SessionSnapshot {
                session_id: found.canonical_session_id.clone(),
                agent_id: Some(found.agent_id.clone()),
                last_event_seq: found.last_event_seq,
                turn_state: found.turn_state.clone(),
                message_count: found.message_count,
                active_tool_call_ids: Vec::new(),
                completed_tool_call_ids: Vec::new(),
                active_turn_failure: found.active_turn_failure.clone(),
                last_terminal_turn_id: found.last_terminal_turn_id.clone(),
                assistant_boundary_entry_count:
                    crate::acp::transcript_projection::assistant_boundary_entry_count_from_transcript_entries(
                        &found.transcript_snapshot.entries,
                    ),
                transcript_entry_count: found.transcript_snapshot.entries.len(),
            }),
            operations: found.operations.clone(),
            interactions: found.interactions.clone(),
            runtime: None,
        },
    );

    let revision = crate::acp::session_state_engine::SessionGraphRevision::new(
        found.graph_revision,
        found.transcript_snapshot.revision,
        found.last_event_seq,
    );

    let repeated_envelope = runtime_registry
        .build_or_advance_viewport_buffer_envelope(
            &found.canonical_session_id,
            revision,
            &projection_registry,
            &transcript_projection_registry,
            Some(720),
            false,
        )
        .expect("canonical id should have restored viewport authority");
    assert!(
        repeated_envelope.is_none(),
        "initial viewport envelope should seed the row tracker"
    );

    // The alias id has no viewport authority and must miss as SessionNotAttached.
    let alias_miss = runtime_registry
        .build_viewport_buffer_push_envelope_for_session(
            requested_session_id,
            revision,
            &projection_registry,
            &transcript_projection_registry,
            Some(720),
        )
        .expect_err("alias id must not resolve viewport authority");
    assert!(matches!(
        alias_miss,
        crate::acp::session_state_engine::runtime_registry::VisibleTranscriptWindowMiss::SessionNotAttached
    ));
}
// -----------------------------------------------------------------------
// Happy path: open token guarantees reservation is armed after assembly
// -----------------------------------------------------------------------
#[tokio::test]
async fn found_result_open_token_has_active_reservation_in_hub() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "reservation-test-session";

    let result = session_open_result_for_new_session(
        &db,
        &hub,
        new_session_open_input(session_id, SessionGraphCapabilities::empty()),
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    let token = Uuid::parse_str(&found.open_token).expect("valid uuid");
    assert!(
        hub.has_reservation(token),
        "reservation must be active after open"
    );
}

// -----------------------------------------------------------------------
// Edge case: abandoned open token expires reservation buffer after TTL
// -----------------------------------------------------------------------
#[tokio::test]
async fn expired_open_token_is_removed_after_gc() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "ttl-test-session";

    let result = session_open_result_for_new_session(
        &db,
        &hub,
        new_session_open_input(session_id, SessionGraphCapabilities::empty()),
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    let token = Uuid::parse_str(&found.open_token).expect("valid uuid");
    // Manually expire the reservation by forcing GC with a zero TTL
    hub.gc_reservations_older_than(std::time::Duration::ZERO);
    assert!(
        !hub.has_reservation(token),
        "expired reservation should be removed by gc"
    );
}

// -----------------------------------------------------------------------
// Integration: post-assembly delta captured in reservation buffer
// -----------------------------------------------------------------------
#[tokio::test]
async fn post_assembly_event_captured_in_reservation_buffer() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "buffer-test-session";

    let result = session_open_result_for_new_session(
        &db,
        &hub,
        new_session_open_input(session_id, SessionGraphCapabilities::empty()),
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    let token = Uuid::parse_str(&found.open_token).expect("valid uuid");

    // Publish a delta to the hub AFTER the open result is returned
    hub.publish(
        "session_update",
        Some(session_id.to_string()),
        json!({"type": "turn_complete"}),
        "high",
        false,
    );

    // The delta must be in the reservation buffer
    let buffered = hub.claim_reservation(token);
    assert!(
        buffered.is_some(),
        "claim must succeed for active reservation"
    );
    let events = buffered.unwrap();
    assert_eq!(events.len(), 1, "exactly one buffered delta expected");
    assert_eq!(events[0].event_name, "session_update");
}

// -----------------------------------------------------------------------
// Integration: event for a different session is NOT buffered in reservation
// -----------------------------------------------------------------------
#[tokio::test]
async fn event_for_different_session_not_captured_in_reservation() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "target-session";
    let other_session = "other-session";

    let result = session_open_result_for_new_session(
        &db,
        &hub,
        new_session_open_input(session_id, SessionGraphCapabilities::empty()),
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    let token = Uuid::parse_str(&found.open_token).expect("valid uuid");

    // Publish an event for a different session
    hub.publish(
        "session_update",
        Some(other_session.to_string()),
        json!({"type": "turn_complete"}),
        "high",
        false,
    );

    let buffered = hub.claim_reservation(token);
    let events = buffered.unwrap_or_default();
    assert!(
        events.is_empty(),
        "events for other sessions must not be captured"
    );
}

// -----------------------------------------------------------------------
// Edge case: claim supersedes reservation (single-use token)
// -----------------------------------------------------------------------
#[tokio::test]
async fn open_token_is_single_use_second_claim_returns_none() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "single-use-session";

    let result = session_open_result_for_new_session(
        &db,
        &hub,
        new_session_open_input(session_id, SessionGraphCapabilities::empty()),
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    let token = Uuid::parse_str(&found.open_token).expect("valid uuid");

    let first = hub.claim_reservation(token);
    assert!(first.is_some(), "first claim must succeed");

    let second = hub.claim_reservation(token);
    assert!(second.is_none(), "second claim of same token must fail");
}

#[tokio::test]
async fn open_token_claim_rejects_wrong_session() {
    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "claim-session";

    let result = session_open_result_for_new_session(
        &db,
        &hub,
        new_session_open_input(session_id, SessionGraphCapabilities::empty()),
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected Found, got {result:?}");
    };
    let token = Uuid::parse_str(&found.open_token).expect("valid uuid");

    let claimed = hub.claim_reservation_for_session(token, "other-session");
    assert!(
        claimed.is_none(),
        "claim must fail when the token is presented for a different session"
    );
    assert!(
        hub.has_reservation(token),
        "failed claim must leave the reservation intact"
    );
}

// -----------------------------------------------------------------------
// Edge case: missing session returns Missing outcome, not partial data
// -----------------------------------------------------------------------
#[tokio::test]
async fn missing_session_returns_missing_outcome() {
    // Note: assemble_session_open_result is called by the command layer only
    // when metadata IS found.  The Missing case is emitted by the command
    // layer itself.  We test here that the SessionOpenResult::Missing variant
    // serializes and round-trips correctly.
    let missing = SessionOpenResult::Missing(SessionOpenMissing {
        requested_session_id: "ghost-session-id".to_string(),
    });
    let json = serde_json::to_string(&missing).expect("serialize");
    let back: SessionOpenResult = serde_json::from_str(&json).expect("deserialize");
    let SessionOpenResult::Missing(m) = back else {
        panic!("expected Missing after round-trip");
    };
    assert_eq!(m.requested_session_id, "ghost-session-id");
}

// -----------------------------------------------------------------------
// Error path: SessionOpenResult::Error round-trips correctly
// -----------------------------------------------------------------------
#[tokio::test]
async fn error_outcome_round_trips_over_serde() {
    let err = SessionOpenResult::Error(SessionOpenError {
        requested_session_id: "bad-session".to_string(),
        message: "Something went wrong".to_string(),
        reason: SessionOpenErrorReason::ParseFailure,
        retryable: false,
    });
    let json = serde_json::to_string(&err).expect("serialize");
    let back: SessionOpenResult = serde_json::from_str(&json).expect("deserialize");
    let SessionOpenResult::Error(e) = back else {
        panic!("expected Error after round-trip");
    };
    assert_eq!(e.requested_session_id, "bad-session");
    assert_eq!(e.message, "Something went wrong");
    assert!(matches!(e.reason, SessionOpenErrorReason::ParseFailure));
    assert!(!e.retryable);
}

#[test]
fn fold_open_cursor_junk_matches_golden() {
    use crate::acp::session::engine::persisted_region::{
        extract_persisted_region, persisted_regions_equal, PersistedSessionGraph,
    };
    use crate::acp::session::ingress::providers::cursor::CursorHistorySource;
    use crate::acp::session::ingress::source::{HistoryInput, HistorySource};
    use std::path::PathBuf;

    const SESSION_ID: &str = "c2a34686-f99a-4632-90e2-e036b96124c2";
    const GOLDEN_CURSOR_JUNK_NAME: &str = "cursor_c2a34686_junk";

    let fixture_dir =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/cursor_sessions");

    let events = CursorHistorySource
        .read(HistoryInput {
            session_id: SESSION_ID.to_string(),
            workspace_root: Some(fixture_dir),
        })
        .expect("read cursor junk fixture");

    assert!(
        !events.is_empty(),
        "HistorySource must emit events from junk fixture"
    );

    let rt = tokio::runtime::Runtime::new().expect("runtime");
    let db = rt.block_on(setup_db());
    let hub = make_hub();
    rt.block_on(seed_session_metadata(&db, SESSION_ID, "cursor"));
    let replay_context = replay_context_for_session(SESSION_ID, CanonicalAgentId::Cursor);

    let result = rt.block_on(session_open_result_from_history_events(
        &db,
        &hub,
        None,
        &replay_context,
        SESSION_ID,
        &events,
    ));

    let SessionOpenResult::Found(found) = result else {
        panic!("expected fold-based history open to succeed");
    };
    assert_eq!(found.open_path, SessionOpenPath::FoldHistory);

    let folded = extract_persisted_region(
        &crate::acp::session_state_engine::graph::SessionStateGraph {
            requested_session_id: found.requested_session_id.clone(),
            canonical_session_id: found.canonical_session_id.clone(),
            is_alias: found.is_alias,
            agent_id: found.agent_id.clone(),
            project_path: found.project_path.clone(),
            worktree_path: found.worktree_path.clone(),
            source_path: found.source_path.clone(),
            sequence_id: found.sequence_id,
            revision: crate::acp::session_state_engine::revision::SessionGraphRevision::new(
                found.graph_revision,
                found.transcript_snapshot.revision,
                found.last_event_seq,
            ),
            transcript_snapshot: found.transcript_snapshot.clone(),
            operations: found.operations.clone(),
            interactions: found.interactions.clone(),
            turn_state: found.turn_state.clone(),
            message_count: found.message_count,
            active_streaming_tail: found.active_streaming_tail.clone(),
            active_turn_failure: found.active_turn_failure.clone(),
            last_terminal_turn_id: found.last_terminal_turn_id.clone(),
            lifecycle: found.lifecycle.clone(),
            activity: found.activity.clone(),
            capabilities: found.capabilities.clone(),
        },
    );
    let golden_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/session_graph_goldens")
        .join(format!("{GOLDEN_CURSOR_JUNK_NAME}.json"));
    let golden_contents = std::fs::read_to_string(&golden_path).unwrap_or_else(|error| {
        panic!(
            "golden fixture missing at {}: {error}",
            golden_path.display()
        )
    });
    let golden: PersistedSessionGraph =
        serde_json::from_str(&golden_contents).expect("deserialize golden fixture");

    assert!(
        persisted_regions_equal(&folded, &golden),
        "fold_open cursor junk must match Phase 0 golden"
    );
}

#[tokio::test]
async fn fold_open_keeps_folded_graph_revision_independent_from_delivery() {
    use crate::acp::session::ingress::stored_entry_events::stored_entries_to_provider_events;

    let db = setup_db().await;
    let hub = make_hub();
    let session_id = "fold-open-independent-frontiers";
    seed_session_metadata(&db, session_id, "cursor").await;
    let snapshot = make_provider_pipeline_snapshot(&CanonicalAgentId::Cursor);
    let events = stored_entries_to_provider_events(&snapshot.entries, CanonicalAgentId::Cursor);
    let replay_context = replay_context_for_session(session_id, CanonicalAgentId::Cursor);

    let result = session_open_result_from_history_events(
        &db,
        &hub,
        None,
        &replay_context,
        session_id,
        &events,
    )
    .await;

    let SessionOpenResult::Found(found) = result else {
        panic!("expected fold-based history open to succeed");
    };
    assert_eq!(found.last_event_seq, 0);
    assert!(
        found.graph_revision > found.last_event_seq,
        "folded graph progress must remain independent from delivery"
    );
}
