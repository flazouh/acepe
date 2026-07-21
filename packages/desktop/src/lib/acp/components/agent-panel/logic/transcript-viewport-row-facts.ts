import type {
	OperationSnapshot,
	OperationState,
	TranscriptViewportRow,
} from "$lib/services/acp-types.js";

export function hasTrailingCompletedTool(
	rows: readonly TranscriptViewportRow[],
	operations: readonly OperationSnapshot[] | null = null
): boolean {
	const trailingRow = rows[rows.length - 1];
	if (trailingRow?.kind !== "tool" || trailingRow.operationLinks.length === 0) {
		return false;
	}
	const operationStateById = operationStateByIdFrom(operations);
	for (const operationLink of trailingRow.operationLinks) {
		const state =
			operationStateById.get(operationLink.operationId) ??
			operationLink.operation?.operation_state ??
			operationLink.state;
		if (state !== "completed") {
			return false;
		}
	}
	return true;
}

function operationStateByIdFrom(
	operations: readonly OperationSnapshot[] | null
): ReadonlyMap<string, OperationState> {
	if (operations === null || operations.length === 0) {
		return new Map();
	}
	const states = new Map<string, OperationState>();
	for (const operation of operations) {
		states.set(operation.id, operation.operation_state);
	}
	return states;
}
