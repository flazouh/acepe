use crate::acp::session_state_engine::revision::SessionGraphRevision;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FrontierFallbackReason {
    MissingFrontier,
    EventSeqRegression,
    RevisionRegression,
    StaleDeltaWindow,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(tag = "decision", rename_all = "camelCase")]
pub enum SessionFrontierDecision {
    AcceptDelta {
        from_revision: SessionGraphRevision,
        to_revision: SessionGraphRevision,
    },
    RequireSnapshot {
        reason: FrontierFallbackReason,
        frontier: Option<SessionGraphRevision>,
        candidate: SessionGraphRevision,
    },
}

#[must_use]
pub fn decide_frontier_transition(
    frontier: Option<SessionGraphRevision>,
    candidate: SessionGraphRevision,
    retained_event_floor: i64,
) -> SessionFrontierDecision {
    let Some(current_frontier) = frontier else {
        return SessionFrontierDecision::RequireSnapshot {
            reason: FrontierFallbackReason::MissingFrontier,
            frontier: None,
            candidate,
        };
    };

    if candidate.last_event_seq < retained_event_floor {
        return SessionFrontierDecision::RequireSnapshot {
            reason: FrontierFallbackReason::StaleDeltaWindow,
            frontier: Some(current_frontier),
            candidate,
        };
    }

    if candidate.last_event_seq < current_frontier.last_event_seq {
        return SessionFrontierDecision::RequireSnapshot {
            reason: FrontierFallbackReason::EventSeqRegression,
            frontier: Some(current_frontier),
            candidate,
        };
    }

    if candidate.graph_revision < current_frontier.graph_revision {
        return SessionFrontierDecision::RequireSnapshot {
            reason: FrontierFallbackReason::RevisionRegression,
            frontier: Some(current_frontier),
            candidate,
        };
    }

    SessionFrontierDecision::AcceptDelta {
        from_revision: current_frontier,
        to_revision: candidate,
    }
}

#[cfg(test)]
mod tests {
    use super::{decide_frontier_transition, FrontierFallbackReason, SessionFrontierDecision};
    use crate::acp::session_state_engine::revision::SessionGraphRevision;

    #[test]
    fn frontier_requires_snapshot_when_missing() {
        let candidate = SessionGraphRevision::new(7, 9);
        let decision = decide_frontier_transition(None, candidate, 0);

        assert_eq!(
            decision,
            SessionFrontierDecision::RequireSnapshot {
                reason: FrontierFallbackReason::MissingFrontier,
                frontier: None,
                candidate,
            }
        );
    }

    #[test]
    fn frontier_requires_snapshot_when_event_seq_regresses() {
        let frontier = SessionGraphRevision::new(8, 12);
        let candidate = SessionGraphRevision::new(9, 11);
        let decision = decide_frontier_transition(Some(frontier), candidate, 0);

        assert_eq!(
            decision,
            SessionFrontierDecision::RequireSnapshot {
                reason: FrontierFallbackReason::EventSeqRegression,
                frontier: Some(frontier),
                candidate,
            }
        );
    }

    #[test]
    fn frontier_requires_snapshot_when_candidate_predates_retained_window() {
        let frontier = SessionGraphRevision::new(8, 12);
        let candidate = SessionGraphRevision::new(13, 3);
        let decision = decide_frontier_transition(Some(frontier), candidate, 5);

        assert_eq!(
            decision,
            SessionFrontierDecision::RequireSnapshot {
                reason: FrontierFallbackReason::StaleDeltaWindow,
                frontier: Some(frontier),
                candidate,
            }
        );
    }

    #[test]
    fn frontier_accepts_monotonic_delta() {
        let frontier = SessionGraphRevision::new(8, 12);
        let candidate = SessionGraphRevision::new(9, 13);
        let decision = decide_frontier_transition(Some(frontier), candidate, 4);

        assert_eq!(
            decision,
            SessionFrontierDecision::AcceptDelta {
                from_revision: frontier,
                to_revision: candidate,
            }
        );
    }
}
