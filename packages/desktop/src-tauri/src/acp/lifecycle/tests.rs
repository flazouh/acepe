use crate::acp::lifecycle::{
    DetachedReason, FailureReason, LifecycleCheckpoint, LifecycleState, LifecycleStatus,
    LifecycleTransition, LifecycleTransitionError,
};
use crate::acp::session_state_engine::selectors::SessionGraphCapabilities;

#[test]
fn all_lifecycle_states_round_trip_through_checkpoint_serialization() {
    let cases = vec![
        LifecycleState::reserved(),
        LifecycleState::activating(),
        LifecycleState::ready(),
        LifecycleState::reconnecting(),
        LifecycleState::detached(DetachedReason::RestoredRequiresAttach),
        LifecycleState::failed(
            FailureReason::DeterministicRestoreFault,
            Some("boom".to_string()),
        ),
        LifecycleState::archived(),
    ];

    for lifecycle in cases {
        let checkpoint =
            LifecycleCheckpoint::new(7, lifecycle.clone(), SessionGraphCapabilities::empty());
        let json = serde_json::to_string(&checkpoint).expect("serialize checkpoint");
        let restored: LifecycleCheckpoint =
            serde_json::from_str(&json).expect("deserialize checkpoint");
        assert_eq!(restored.graph_revision, 7);
        assert_eq!(restored.lifecycle, lifecycle);
    }
}

#[test]
fn illegal_transition_is_rejected() {
    let error = LifecycleTransition::validate(LifecycleStatus::Reserved, LifecycleStatus::Ready)
        .expect_err("reserved to ready should be illegal");

    assert_eq!(
        error,
        LifecycleTransitionError::IllegalTransition {
            from: LifecycleStatus::Reserved,
            to: LifecycleStatus::Ready,
        }
    );
}
