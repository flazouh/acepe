use crate::acp::session_state_engine::revision::SessionGraphRevision;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FrontierFallbackReason {
    MissingFrontier,
    EventSeqRegression,
    RevisionRegression,
    TranscriptRevisionRegression,
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
    is_transcript_bearing: bool,
) -> SessionFrontierDecision {
    let Some(current_frontier) = frontier else {
        return SessionFrontierDecision::RequireSnapshot {
            reason: FrontierFallbackReason::MissingFrontier,
            frontier: None,
            candidate,
        };
    };

    if current_frontier.last_event_seq < retained_event_floor {
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

    if is_transcript_bearing && candidate.transcript_revision < current_frontier.transcript_revision
    {
        return SessionFrontierDecision::RequireSnapshot {
            reason: FrontierFallbackReason::TranscriptRevisionRegression,
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
        let candidate = SessionGraphRevision::new(7, 5, 9);
        let decision = decide_frontier_transition(None, candidate, 0, true);

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
        let frontier = SessionGraphRevision::new(8, 6, 12);
        let candidate = SessionGraphRevision::new(9, 6, 11);
        let decision = decide_frontier_transition(Some(frontier), candidate, 0, true);

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
    fn frontier_requires_snapshot_when_current_frontier_predates_retained_window() {
        let frontier = SessionGraphRevision::new(8, 3, 4);
        let candidate = SessionGraphRevision::new(13, 9, 12);
        let decision = decide_frontier_transition(Some(frontier), candidate, 5, true);

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
        let frontier = SessionGraphRevision::new(8, 8, 12);
        let candidate = SessionGraphRevision::new(9, 9, 13);
        let decision = decide_frontier_transition(Some(frontier), candidate, 4, true);

        assert_eq!(
            decision,
            SessionFrontierDecision::AcceptDelta {
                from_revision: frontier,
                to_revision: candidate,
            }
        );
    }

    #[test]
    fn frontier_requires_snapshot_when_transcript_revision_regresses_for_transcript_delta() {
        let frontier = SessionGraphRevision::new(9, 8, 12);
        let candidate = SessionGraphRevision::new(10, 7, 13);
        let decision = decide_frontier_transition(Some(frontier), candidate, 4, true);

        assert_eq!(
            decision,
            SessionFrontierDecision::RequireSnapshot {
                reason: FrontierFallbackReason::TranscriptRevisionRegression,
                frontier: Some(frontier),
                candidate,
            }
        );
    }

    #[test]
    fn frontier_accepts_graph_only_delta_without_transcript_progress() {
        let frontier = SessionGraphRevision::new(9, 8, 12);
        let candidate = SessionGraphRevision::new(10, 8, 13);
        let decision = decide_frontier_transition(Some(frontier), candidate, 4, false);

        assert_eq!(
            decision,
            SessionFrontierDecision::AcceptDelta {
                from_revision: frontier,
                to_revision: candidate,
            }
        );
    }
}
