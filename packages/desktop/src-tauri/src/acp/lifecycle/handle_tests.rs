use super::{LifecycleCheckpoint, LifecycleState, ReadyDispatchError, SessionSupervisor};
use crate::acp::session_state_engine::SessionGraphCapabilities;

#[test]
fn ready_dispatch_permit_requires_ready_lifecycle() {
    let supervisor = SessionSupervisor::new();
    let session_id = "session-activating";
    assert!(supervisor.seed_checkpoint(
        session_id.to_string(),
        LifecycleCheckpoint::new(
            1,
            LifecycleState::activating(),
            SessionGraphCapabilities::empty(),
        ),
    ));

    let error = supervisor
        .issue_ready_dispatch_permit(session_id)
        .expect_err("activating session should reject ready-only dispatch");

    assert_eq!(
        error,
        ReadyDispatchError::SessionNotReady {
            session_id: session_id.to_string(),
            status: crate::acp::lifecycle::LifecycleStatus::Activating,
        }
    );
}

#[test]
fn ready_dispatch_permit_rejects_runtime_epoch_changes() {
    let supervisor = SessionSupervisor::new();
    let session_id = "session-ready";
    assert!(supervisor.seed_checkpoint(
        session_id.to_string(),
        LifecycleCheckpoint::new(1, LifecycleState::ready(), SessionGraphCapabilities::empty()),
    ));

    let permit = supervisor
        .issue_ready_dispatch_permit(session_id)
        .expect("ready session should get dispatch permit");
    supervisor.replace_checkpoint_for_compat(
        session_id.to_string(),
        LifecycleCheckpoint::new(2, LifecycleState::ready(), SessionGraphCapabilities::empty()),
    );

    let error = supervisor
        .validate_ready_dispatch_permit(&permit)
        .expect_err("epoch drift should reject stale permit");

    assert_eq!(
        error,
        ReadyDispatchError::RuntimeEpochChanged {
            session_id: session_id.to_string(),
            expected_epoch: 1,
            actual_epoch: 2,
        }
    );
}
