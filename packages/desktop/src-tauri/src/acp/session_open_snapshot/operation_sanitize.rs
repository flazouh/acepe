use crate::acp::projections::{
    is_terminal_operation_state, InteractionSnapshot, InteractionState, OperationDegradationCode,
    OperationDegradationReason, OperationSnapshot, OperationSourceLink, OperationState,
};
use crate::acp::session_update::ToolCallStatus;
use crate::acp::transcript_projection::{TranscriptEntryRole, TranscriptSnapshot};
use crate::acp::types::CanonicalAgentId;

fn operation_can_be_restored_as_historical(operation: &OperationSnapshot) -> bool {
    is_terminal_operation_state(&operation.operation_state)
}

fn operation_has_active_provider_status(operation: &OperationSnapshot) -> bool {
    matches!(
        operation.provider_status,
        ToolCallStatus::Pending | ToolCallStatus::InProgress
    )
}

fn downgrade_stale_active_operation(mut operation: OperationSnapshot) -> OperationSnapshot {
    if operation_can_be_restored_as_historical(&operation)
        && !operation_has_active_provider_status(&operation)
    {
        return operation;
    }

    // The journal frontier proves this active operation is stale; keep the state
    // explicit instead of relying on provider_status fallback in the UI.
    operation.operation_state = OperationState::Degraded;
    if operation.degradation_reason.is_none() {
        operation.degradation_reason = Some(OperationDegradationReason {
			code: OperationDegradationCode::AbsentFromHistory,
			detail: Some(
				"Provider history is behind the canonical journal; stale active operation was not restored as running."
					.to_string(),
			),
		});
    }
    operation
}

fn cancel_historical_active_operation(mut operation: OperationSnapshot) -> OperationSnapshot {
    if operation_can_be_restored_as_historical(&operation) {
        return operation;
    }

    operation.operation_state = OperationState::Cancelled;
    operation
}

fn sanitize_operations_for_projection_frontier(
    operations: Vec<OperationSnapshot>,
    projection_is_behind_journal: bool,
) -> Vec<OperationSnapshot> {
    if !projection_is_behind_journal {
        return operations;
    }

    operations
        .into_iter()
        .map(downgrade_stale_active_operation)
        .collect()
}

pub(crate) fn sanitize_operations_for_historical_open(
    operations: Vec<OperationSnapshot>,
    projection_is_behind_journal: bool,
) -> Vec<OperationSnapshot> {
    if projection_is_behind_journal {
        return sanitize_operations_for_projection_frontier(
            operations,
            projection_is_behind_journal,
        );
    }

    operations
        .into_iter()
        .map(cancel_historical_active_operation)
        .collect()
}

pub(crate) fn sanitize_interactions_for_historical_open(
    interactions: Vec<InteractionSnapshot>,
) -> Vec<InteractionSnapshot> {
    interactions
        .into_iter()
        .map(|mut interaction| {
            if matches!(
                interaction.state,
                InteractionState::Pending | InteractionState::Unresolved
            ) {
                interaction.state = InteractionState::Unresolved;
                interaction.reply_handler = None;
            }
            interaction
        })
        .collect()
}

pub(super) fn warn_unresolved_tool_rows_in_open_graph(
    session_id: &str,
    agent_id: &CanonicalAgentId,
    transcript_snapshot: &TranscriptSnapshot,
    operations: &[OperationSnapshot],
) {
    let linked_entry_ids: std::collections::HashSet<&str> = operations
        .iter()
        .filter_map(|operation| match &operation.source_link {
            OperationSourceLink::TranscriptLinked { entry_id } => Some(entry_id.as_str()),
            OperationSourceLink::Synthetic { .. } | OperationSourceLink::Degraded { .. } => None,
        })
        .collect();
    let unresolved: Vec<&str> = transcript_snapshot
        .entries
        .iter()
        .filter(|entry| entry.role == TranscriptEntryRole::Tool)
        .map(|entry| entry.entry_id.as_str())
        .filter(|entry_id| !linked_entry_ids.contains(entry_id))
        .take(20)
        .collect();

    if unresolved.is_empty() {
        return;
    }

    tracing::warn!(
        session_id,
        agent_id = %agent_id,
        transcript_revision = transcript_snapshot.revision,
        operation_count = operations.len(),
        unresolved_count = unresolved.len(),
        unresolved_entry_ids = ?unresolved,
        "Restored session graph contains transcript tool rows without matching operations"
    );
}
