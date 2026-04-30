use crate::acp::lifecycle::{LifecycleCheckpoint, LifecycleState, SessionSupervisor};
use crate::acp::projections::ProjectionRegistry;
use crate::acp::session_state_engine::SessionGraphCapabilities;
use crate::acp::session_state_engine::SessionGraphRuntimeRegistry;
use crate::acp::session_update::{AvailableCommandsData, SessionUpdate};
use crate::db::repository::{SessionJournalEventRepository, SessionMetadataRepository};
use sea_orm::{Database, DbConn};
use sea_orm_migration::MigratorTrait;
use std::sync::Arc;

async fn setup_db() -> DbConn {
    let db = Database::connect("sqlite::memory:")
        .await
        .expect("in-memory db");
    crate::db::migrations::Migrator::up(&db, None)
        .await
        .expect("migrations");
    db
}

async fn seed_session_metadata(db: &DbConn, session_id: &str) {
    SessionMetadataRepository::ensure_exists(
        db,
        session_id,
        "/tmp/acepe-test",
        "claude-code",
        None,
    )
    .await
    .expect("seed metadata");
}

#[tokio::test]
async fn reserve_sets_reserved_checkpoint_and_advances_frontier() {
    let db = setup_db().await;
    seed_session_metadata(&db, "session-1").await;
    let projection_registry = ProjectionRegistry::new();
    projection_registry.register_session(
        "session-1".to_string(),
        crate::acp::types::CanonicalAgentId::ClaudeCode,
    );
    let supervisor = SessionSupervisor::new();

    let checkpoint = supervisor
        .reserve(&db, &projection_registry, "session-1")
        .await
        .expect("reserve session");

    assert_eq!(checkpoint.graph_revision, 1);
    assert_eq!(checkpoint.lifecycle, LifecycleState::reserved());
    assert_eq!(
        SessionJournalEventRepository::max_event_seq(&db, "session-1")
            .await
            .expect("load max seq"),
        Some(1)
    );
    let supervisor_checkpoint = supervisor
        .snapshot_for_session("session-1")
        .expect("supervisor checkpoint");
    assert_eq!(
        supervisor_checkpoint.graph_revision,
        checkpoint.graph_revision
    );
    assert_eq!(supervisor_checkpoint.lifecycle, checkpoint.lifecycle);
}

#[tokio::test]
async fn double_reservation_returns_error_without_second_write() {
    let db = setup_db().await;
    seed_session_metadata(&db, "session-1").await;
    let projection_registry = ProjectionRegistry::new();
    projection_registry.register_session(
        "session-1".to_string(),
        crate::acp::types::CanonicalAgentId::ClaudeCode,
    );
    let supervisor = SessionSupervisor::new();

    supervisor
        .reserve(&db, &projection_registry, "session-1")
        .await
        .expect("first reserve");
    let second = supervisor
        .reserve(&db, &projection_registry, "session-1")
        .await;

    assert!(matches!(
        second,
        Err(crate::acp::lifecycle::SessionSupervisorError::AlreadyReserved { .. })
    ));
    assert_eq!(
        SessionJournalEventRepository::max_event_seq(&db, "session-1")
            .await
            .expect("load max seq"),
        Some(1)
    );
}

#[tokio::test]
async fn restore_session_checkpoint_replaces_supervisor_checkpoint() {
    let db = setup_db().await;
    seed_session_metadata(&db, "session-1").await;
    let projection_registry = ProjectionRegistry::new();
    projection_registry.register_session(
        "session-1".to_string(),
        crate::acp::types::CanonicalAgentId::ClaudeCode,
    );
    let supervisor = Arc::new(SessionSupervisor::new());
    let runtime_registry = SessionGraphRuntimeRegistry::with_supervisor(supervisor.clone());

    let _reserved = supervisor
        .reserve(&db, &projection_registry, "session-1")
        .await
        .expect("reserve session");
    let restored = LifecycleCheckpoint::new(
        99,
        LifecycleState::ready(),
        SessionGraphCapabilities::empty(),
    );
    runtime_registry.restore_session_checkpoint("session-1".to_string(), restored.clone());

    let current = supervisor
        .snapshot_for_session("session-1")
        .expect("supervisor checkpoint");
    assert_eq!(current.graph_revision, restored.graph_revision);
    assert_eq!(current.lifecycle, restored.lifecycle);
}

#[tokio::test]
async fn unknown_update_does_not_create_supervisor_checkpoint_or_block_reserve() {
    let db = setup_db().await;
    seed_session_metadata(&db, "session-1").await;
    let projection_registry = ProjectionRegistry::new();
    projection_registry.register_session(
        "session-1".to_string(),
        crate::acp::types::CanonicalAgentId::ClaudeCode,
    );
    let supervisor = Arc::new(SessionSupervisor::new());
    let runtime_registry = SessionGraphRuntimeRegistry::with_supervisor(supervisor.clone());
    let early_update = SessionUpdate::AvailableCommandsUpdate {
        update: AvailableCommandsData {
            available_commands: Vec::new(),
        },
        session_id: Some("session-1".to_string()),
    };

    runtime_registry.apply_session_update_with_graph_seed("session-1", 1, &early_update);

    assert!(
        supervisor.snapshot_for_session("session-1").is_none(),
        "provider updates must not create lifecycle existence before reserve"
    );
    let checkpoint = supervisor
        .reserve(&db, &projection_registry, "session-1")
        .await
        .expect("reserve should still create lifecycle after early provider update");
    assert_eq!(checkpoint.lifecycle, LifecycleState::reserved());
}
