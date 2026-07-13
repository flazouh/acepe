use crate::acp::lifecycle::supervisor::SupervisorTestPause;
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

#[tokio::test]
async fn unreserved_lifecycle_transition_fails_without_advancing_journal_frontier() {
    let db = setup_db().await;
    seed_session_metadata(&db, "historical-session").await;
    let projection_registry = ProjectionRegistry::new();
    projection_registry.register_session(
        "historical-session".to_string(),
        crate::acp::types::CanonicalAgentId::ClaudeCode,
    );
    let supervisor = SessionSupervisor::new();

    let result = supervisor
        .transition_lifecycle_state(
            &db,
            &projection_registry,
            "historical-session",
            LifecycleState::activating(),
        )
        .await;

    assert!(matches!(
        result,
        Err(crate::acp::lifecycle::SessionSupervisorError::SessionNotFound {
            session_id,
        }) if session_id == "historical-session"
    ));
    assert_eq!(
        SessionJournalEventRepository::max_event_seq(&db, "historical-session")
            .await
            .expect("load journal frontier"),
        None,
        "rejecting an unreserved lifecycle transition must not mutate durable session truth"
    );
}

#[tokio::test]
async fn lifecycle_state_transition_preserves_ahead_restored_frontier() {
    let db = setup_db().await;
    seed_session_metadata(&db, "restored-session").await;
    let projection_registry = ProjectionRegistry::new();
    let supervisor = SessionSupervisor::new();
    assert!(supervisor.seed_checkpoint(
        "restored-session".to_string(),
        LifecycleCheckpoint::new(
            10,
            LifecycleState::ready(),
            SessionGraphCapabilities::empty(),
        ),
    ));

    let checkpoint = supervisor
        .transition_lifecycle_state(
            &db,
            &projection_registry,
            "restored-session",
            LifecycleState::activating(),
        )
        .await
        .expect("transition restored session");

    assert_eq!(checkpoint.graph_revision, 10);
    assert_eq!(checkpoint.lifecycle, LifecycleState::activating());
}

#[tokio::test]
async fn conditional_transition_cannot_overwrite_checkpoint_changed_during_barrier_await() {
    let db = setup_db().await;
    seed_session_metadata(&db, "racing-session").await;
    let projection_registry = Arc::new(ProjectionRegistry::new());
    projection_registry.register_session(
        "racing-session".to_string(),
        crate::acp::types::CanonicalAgentId::ClaudeCode,
    );
    let supervisor = Arc::new(SessionSupervisor::new());
    let runtime_registry = SessionGraphRuntimeRegistry::with_supervisor(supervisor.clone());
    let expected = LifecycleCheckpoint::new(
        10,
        LifecycleState::detached(crate::acp::lifecycle::DetachedReason::ReconnectExhausted),
        SessionGraphCapabilities::empty(),
    );
    runtime_registry.restore_session_checkpoint("racing-session".to_string(), expected.clone());

    let hook = SupervisorTestPause::new();
    supervisor.install_conditional_transition_test_hook(hook.clone());
    let transition_supervisor = supervisor.clone();
    let transition_db = db.clone();
    let transition_projection_registry = projection_registry.clone();
    let transition = tokio::spawn(async move {
        transition_supervisor
            .transition_lifecycle_if_current(
                &transition_db,
                transition_projection_registry.as_ref(),
                "racing-session",
                &expected,
                &SessionUpdate::ConnectionFailed {
                    session_id: "racing-session".to_string(),
                    attempt_id: 0,
                    error: "stale history repair".to_string(),
                    failure_reason: crate::acp::lifecycle::FailureReason::ResumeFailed,
                },
            )
            .await
    });

    hook.wait_until_reached().await;
    runtime_registry.restore_session_checkpoint(
        "racing-session".to_string(),
        LifecycleCheckpoint::new(
            11,
            LifecycleState::ready(),
            SessionGraphCapabilities {
                models: None,
                modes: None,
                available_commands: None,
                config_options: None,
                autonomous_enabled: Some(true),
            },
        ),
    );
    hook.resume();

    let result = transition
        .await
        .expect("conditional transition task should join")
        .expect("conditional transition should not fail");
    assert!(
        result.is_none(),
        "the stale transition must lose its final atomic checkpoint claim"
    );
    let current = supervisor
        .snapshot_for_session("racing-session")
        .expect("newer checkpoint should remain present");
    assert_eq!(current.graph_revision, 11);
    assert_eq!(current.lifecycle, LifecycleState::ready());
    assert_eq!(current.capabilities.autonomous_enabled, Some(true));
    assert_eq!(
        SessionJournalEventRepository::max_event_seq(&db, "racing-session")
            .await
            .expect("load journal frontier"),
        Some(1),
        "the attempted transition leaves its ordering barrier, but must not persist stale checkpoint facts",
    );
}

#[tokio::test]
async fn conditional_transition_restores_prior_checkpoint_when_persistence_fails() {
    let db = setup_db().await;
    seed_session_metadata(&db, "persistence-failure-session").await;
    let projection_registry = ProjectionRegistry::new();
    let supervisor = SessionSupervisor::new();
    let expected = LifecycleCheckpoint::new(
        10,
        LifecycleState::detached(crate::acp::lifecycle::DetachedReason::ReconnectExhausted),
        SessionGraphCapabilities {
            models: None,
            modes: None,
            available_commands: None,
            config_options: None,
            autonomous_enabled: Some(false),
        },
    );
    assert!(
        supervisor.seed_checkpoint("persistence-failure-session".to_string(), expected.clone(),)
    );
    supervisor.fail_next_checkpoint_persistence();

    let result = supervisor
        .transition_lifecycle_if_current(
            &db,
            &projection_registry,
            "persistence-failure-session",
            &expected,
            &SessionUpdate::ConnectionFailed {
                session_id: "persistence-failure-session".to_string(),
                attempt_id: 0,
                error: "failed repair".to_string(),
                failure_reason: crate::acp::lifecycle::FailureReason::ResumeFailed,
            },
        )
        .await;

    assert!(matches!(
        result,
        Err(crate::acp::lifecycle::SessionSupervisorError::Persistence { message })
            if message == "forced checkpoint persistence failure"
    ));
    let current = supervisor
        .snapshot_for_session("persistence-failure-session")
        .expect("prior checkpoint should be restored");
    assert_eq!(current.graph_revision, 10);
    assert_eq!(current.lifecycle, expected.lifecycle);
    assert_eq!(current.capabilities.autonomous_enabled, Some(false));
    assert_eq!(
        supervisor.checkpoint_version_for_session("persistence-failure-session"),
        Some(3),
        "rollback must restore facts without reusing the pre-transition checkpoint version",
    );
}

#[tokio::test]
async fn persistence_failure_rollback_cannot_overwrite_newer_checkpoint() {
    let db = setup_db().await;
    seed_session_metadata(&db, "rollback-racing-session").await;
    let projection_registry = Arc::new(ProjectionRegistry::new());
    let supervisor = Arc::new(SessionSupervisor::new());
    let runtime_registry = SessionGraphRuntimeRegistry::with_supervisor(supervisor.clone());
    let expected = LifecycleCheckpoint::new(
        10,
        LifecycleState::detached(crate::acp::lifecycle::DetachedReason::ReconnectExhausted),
        SessionGraphCapabilities::empty(),
    );
    runtime_registry
        .restore_session_checkpoint("rollback-racing-session".to_string(), expected.clone());
    let persistence_pause = SupervisorTestPause::new();
    supervisor.install_checkpoint_persistence_test_hook(persistence_pause.clone());
    supervisor.fail_next_checkpoint_persistence();

    let transition_supervisor = supervisor.clone();
    let transition_db = db.clone();
    let transition_projection_registry = projection_registry.clone();
    let transition = tokio::spawn(async move {
        transition_supervisor
            .transition_lifecycle_if_current(
                &transition_db,
                transition_projection_registry.as_ref(),
                "rollback-racing-session",
                &expected,
                &SessionUpdate::ConnectionFailed {
                    session_id: "rollback-racing-session".to_string(),
                    attempt_id: 0,
                    error: "stale repair".to_string(),
                    failure_reason: crate::acp::lifecycle::FailureReason::ResumeFailed,
                },
            )
            .await
    });

    persistence_pause.wait_until_reached().await;
    runtime_registry.restore_session_checkpoint(
        "rollback-racing-session".to_string(),
        LifecycleCheckpoint::new(
            11,
            LifecycleState::ready(),
            SessionGraphCapabilities {
                models: None,
                modes: None,
                available_commands: None,
                config_options: None,
                autonomous_enabled: Some(true),
            },
        ),
    );
    persistence_pause.resume();

    assert!(matches!(
        transition.await.expect("transition task should join"),
        Err(crate::acp::lifecycle::SessionSupervisorError::Persistence { .. })
    ));
    let current = supervisor
        .snapshot_for_session("rollback-racing-session")
        .expect("newer checkpoint should survive failed stale persistence");
    assert_eq!(current.graph_revision, 11);
    assert_eq!(current.lifecycle, LifecycleState::ready());
    assert_eq!(current.capabilities.autonomous_enabled, Some(true));
    assert_eq!(
        supervisor.checkpoint_version_for_session("rollback-racing-session"),
        Some(3),
        "the failed transition must not roll back over the concurrent writer",
    );
}

#[tokio::test]
async fn begin_activation_rejects_archived_session_without_advancing_frontier() {
    let db = setup_db().await;
    seed_session_metadata(&db, "archived-session").await;
    let projection_registry = ProjectionRegistry::new();
    let supervisor = SessionSupervisor::new();
    assert!(supervisor.seed_checkpoint(
        "archived-session".to_string(),
        LifecycleCheckpoint::new(
            9,
            LifecycleState::archived(),
            SessionGraphCapabilities::empty(),
        ),
    ));

    let result = supervisor
        .begin_activation(&db, &projection_registry, "archived-session")
        .await;

    assert!(matches!(
        result,
        Err(crate::acp::lifecycle::SessionSupervisorError::InvalidActivationState {
            session_id,
            status: crate::acp::lifecycle::LifecycleStatus::Archived,
        }) if session_id == "archived-session"
    ));
    assert_eq!(
        SessionJournalEventRepository::max_event_seq(&db, "archived-session")
            .await
            .expect("load archived session frontier"),
        None,
        "invalid activation must not append a lifecycle barrier",
    );
}

#[tokio::test]
async fn older_canonical_transition_cannot_overwrite_newer_lifecycle_checkpoint() {
    let db = setup_db().await;
    seed_session_metadata(&db, "session-1").await;
    let projection_registry = ProjectionRegistry::new();
    projection_registry.register_session(
        "session-1".to_string(),
        crate::acp::types::CanonicalAgentId::ClaudeCode,
    );
    let supervisor = Arc::new(SessionSupervisor::new());
    let runtime_registry = SessionGraphRuntimeRegistry::with_supervisor(supervisor.clone());
    runtime_registry.restore_session_checkpoint(
        "session-1".to_string(),
        LifecycleCheckpoint::new(
            10,
            LifecycleState::detached(crate::acp::lifecycle::DetachedReason::ReconnectExhausted),
            SessionGraphCapabilities::empty(),
        ),
    );

    supervisor
        .record_canonical_graph_transition(
            &db,
            &projection_registry,
            "session-1",
            9,
            crate::acp::session_state_engine::runtime_registry::SessionGraphRuntimeSnapshot {
                graph_revision: 9,
                lifecycle:
                    crate::acp::session_state_engine::selectors::SessionGraphLifecycle::ready(),
                capabilities: SessionGraphCapabilities::empty(),
            },
            true,
            true,
        )
        .await
        .expect("older canonical mirror should be ignored without failing");

    let current = supervisor
        .snapshot_for_session("session-1")
        .expect("checkpoint should remain present");
    assert_eq!(current.graph_revision, 10);
    assert_eq!(
        current.lifecycle,
        LifecycleState::detached(crate::acp::lifecycle::DetachedReason::ReconnectExhausted)
    );
}
