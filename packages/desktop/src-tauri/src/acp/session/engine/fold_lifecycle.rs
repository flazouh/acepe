//! Turn-state lifecycle helpers for `engine::fold`.

use crate::acp::projections::helpers::is_terminal_operation_state;
use crate::acp::projections::{InteractionState, SessionTurnState};
use crate::acp::session::ingress::event::TurnOutcome;
use crate::acp::session_state_engine::graph::SessionStateGraph;

/// Apply explicit turn boundary outcome from ingress `TurnEnd` facts.
pub fn apply_turn_end(graph: &mut SessionStateGraph, outcome: TurnOutcome) {
    graph.turn_state = match outcome {
        TurnOutcome::Completed => SessionTurnState::Completed,
        TurnOutcome::Failed => SessionTurnState::Failed,
        TurnOutcome::Cancelled => SessionTurnState::Cancelled,
    };
}

/// Close historical session projection — mirrors `session_materialization` turn_state logic only.
pub fn apply_historical_close(graph: &mut SessionStateGraph) {
    let has_history = !graph.transcript_snapshot.entries.is_empty();
    let had_active_state = graph
        .operations
        .iter()
        .any(|operation| !is_terminal_operation_state(&operation.operation_state))
        || graph
            .interactions
            .iter()
            .any(|interaction| interaction.state == InteractionState::Pending);

    if graph.active_turn_failure.is_some() {
        graph.turn_state = SessionTurnState::Failed;
    } else if graph.turn_state == SessionTurnState::Running || had_active_state {
        graph.turn_state = if has_history {
            SessionTurnState::Completed
        } else {
            SessionTurnState::Idle
        };
    } else if has_history && graph.turn_state == SessionTurnState::Idle {
        graph.turn_state = SessionTurnState::Completed;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::session::engine::fold::{fold_full, FoldContext};
    use crate::acp::session::ingress::event::{ProviderEvent, ProviderEventKind};
    use crate::acp::types::CanonicalAgentId;

    #[test]
    fn fold_full_historical_close_sets_completed() {
        let ctx = FoldContext::new("sess-1", CanonicalAgentId::Cursor, "/tmp");
        let events = vec![ProviderEvent {
            source: CanonicalAgentId::Cursor,
            provider_seq: 1,
            provider_row_id: "user-hi".to_string(),
            timestamp_ms: None,
            kind: ProviderEventKind::UserText {
                text: "hi".to_string(),
            },
        }];

        let graph = fold_full(&events, &ctx);
        assert_eq!(graph.turn_state, SessionTurnState::Completed);
    }
}
