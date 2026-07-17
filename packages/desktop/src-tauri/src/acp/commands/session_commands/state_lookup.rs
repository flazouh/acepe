//! State-lookup helpers for session commands.
//! Extracted verbatim from session_commands.rs.

use crate::acp::projections::{
    is_terminal_operation_state, InteractionSnapshot, InteractionState, OperationSnapshot,
    OperationSourceLink, ProjectionRegistry, SessionProjectionSnapshot, SessionTurnState,
    TurnFailureSnapshot,
};
use crate::acp::session_open_snapshot::{
    sanitize_interactions_for_historical_open, sanitize_operations_for_historical_open,
};
use crate::acp::session_state_engine::runtime_registry::{
    SessionGraphRuntimeRegistry, SessionGraphRuntimeSnapshot,
};
use crate::acp::transcript_projection::{TranscriptEntryRole, TranscriptSnapshot};

pub(super) fn runtime_snapshot_for_refresh(
    runtime_registry: Option<&SessionGraphRuntimeRegistry>,
    session_id: &str,
) -> SessionGraphRuntimeSnapshot {
    runtime_registry
        .map(|registry| registry.snapshot_for_session(session_id))
        .unwrap_or_default()
}

pub(super) struct StateLookupAuthority {
    pub(super) operations: Vec<OperationSnapshot>,
    pub(super) interactions: Vec<InteractionSnapshot>,
    pub(super) turn_state: SessionTurnState,
    pub(super) active_turn_failure: Option<TurnFailureSnapshot>,
}

pub(super) fn resolve_state_lookup_authority(
    has_live_active_turn_evidence: bool,
    transcript_has_entries: bool,
    raw_turn_state: SessionTurnState,
    raw_operations: Vec<OperationSnapshot>,
    raw_interactions: Vec<InteractionSnapshot>,
    raw_active_turn_failure: Option<TurnFailureSnapshot>,
) -> StateLookupAuthority {
    if has_live_active_turn_evidence {
        return StateLookupAuthority {
            operations: raw_operations,
            interactions: raw_interactions,
            turn_state: raw_turn_state,
            active_turn_failure: raw_active_turn_failure,
        };
    }

    let had_stale_active_projection = raw_turn_state == SessionTurnState::Running
        || raw_operations
            .iter()
            .any(|operation| !is_terminal_operation_state(&operation.operation_state))
        || raw_interactions
            .iter()
            .any(|interaction| interaction.state == InteractionState::Pending);
    let turn_state = if raw_turn_state != SessionTurnState::Failed && had_stale_active_projection {
        if transcript_has_entries {
            SessionTurnState::Completed
        } else {
            SessionTurnState::Idle
        }
    } else {
        raw_turn_state
    };
    let active_turn_failure = if turn_state == SessionTurnState::Failed {
        raw_active_turn_failure
    } else {
        None
    };

    StateLookupAuthority {
        operations: sanitize_operations_for_historical_open(raw_operations, false),
        interactions: sanitize_interactions_for_historical_open(raw_interactions),
        turn_state,
        active_turn_failure,
    }
}

pub(super) fn has_live_active_turn_evidence(
    has_live_runtime_state: bool,
    raw_turn_state: &SessionTurnState,
    raw_operations: &[OperationSnapshot],
    raw_interactions: &[InteractionSnapshot],
    transcript_snapshot: &TranscriptSnapshot,
) -> bool {
    if !has_live_runtime_state || raw_turn_state != &SessionTurnState::Running {
        return false;
    }

    raw_operations
        .iter()
        .any(|operation| !is_terminal_operation_state(&operation.operation_state))
        || raw_interactions
            .iter()
            .any(|interaction| interaction.state == InteractionState::Pending)
        || transcript_snapshot
            .entries
            .last()
            .is_some_and(|entry| entry.role == TranscriptEntryRole::User)
}

pub(super) fn projection_snapshot_with_runtime(
    projection_registry: &ProjectionRegistry,
    runtime_registry: &SessionGraphRuntimeRegistry,
    session_id: &str,
) -> SessionProjectionSnapshot {
    let mut projection_snapshot = projection_registry.session_projection(session_id);
    let runtime_snapshot = runtime_registry.snapshot_for_session(session_id);
    if runtime_snapshot.graph_revision > 0 {
        projection_snapshot.runtime = Some(runtime_snapshot.into_checkpoint());
    }
    projection_snapshot
}

pub(super) fn warn_unresolved_tool_rows_in_state_lookup(
    session_id: &str,
    transcript_snapshot: &TranscriptSnapshot,
    operations: &[OperationSnapshot],
) {
    let unresolved = unresolved_tool_entry_ids(transcript_snapshot, operations);

    if unresolved.is_empty() {
        return;
    }

    tracing::warn!(
        session_id,
        transcript_revision = transcript_snapshot.revision,
        operation_count = operations.len(),
        unresolved_count = unresolved.len(),
        unresolved_entry_ids = ?unresolved,
        "Session state lookup graph contains transcript tool rows without matching operations"
    );
}

pub(super) fn unresolved_tool_entry_ids(
    transcript_snapshot: &TranscriptSnapshot,
    operations: &[OperationSnapshot],
) -> Vec<String> {
    let linked_entry_ids: std::collections::HashSet<&str> = operations
        .iter()
        .filter_map(|operation| match &operation.source_link {
            OperationSourceLink::TranscriptLinked { entry_id } => Some(entry_id.as_str()),
            OperationSourceLink::Synthetic { .. } | OperationSourceLink::Degraded { .. } => None,
        })
        .collect();

    transcript_snapshot
        .entries
        .iter()
        .filter(|entry| entry.role == TranscriptEntryRole::Tool)
        .map(|entry| entry.entry_id.as_str())
        .filter(|entry_id| !linked_entry_ids.contains(entry_id))
        .map(str::to_string)
        .take(20)
        .collect()
}
