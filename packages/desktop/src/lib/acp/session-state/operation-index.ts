/**
 * Operation index for the canonical agent-panel graph materializer: lookup maps
 * from operation id / transcript-source-entry id / child→parent, plus the
 * builder and a transcript-source resolver. Pure derivations over the canonical
 * operation snapshots — no mutation of canonical state. GOD-safe foundation
 * shared by the materializer's conversation builders.
 */
import type { OperationSnapshot } from "../../services/acp-types.js";

export interface OperationIndex {
	readonly byOperationId: Map<string, OperationSnapshot>;
	readonly byTranscriptSourceEntryId: Map<string, OperationSnapshot>;
	readonly parentsByChildOperationId: Map<string, OperationSnapshot[]>;
}

export type OperationIndexPatchResult = {
	readonly operationIndex: OperationIndex;
	readonly changedOperationIds: Set<string>;
	readonly affectedEntryIds?: Set<string>;
};

export function buildOperationIndex(operations: readonly OperationSnapshot[]): OperationIndex {
	const byOperationId = new Map<string, OperationSnapshot>();
	const byTranscriptSourceEntryId = new Map<string, OperationSnapshot>();
	const parentsByChildOperationId = new Map<string, OperationSnapshot[]>();

	for (const operation of operations) {
		byOperationId.set(operation.id, operation);
		if (operation.source_link.kind === "transcript_linked") {
			byTranscriptSourceEntryId.set(operation.source_link.entry_id, operation);
		}
		for (const childOperationId of operation.child_operation_ids) {
			let parents = parentsByChildOperationId.get(childOperationId);
			if (parents === undefined) {
				parents = [];
				parentsByChildOperationId.set(childOperationId, parents);
			}
			parents.push(operation);
		}
	}

	return {
		byOperationId,
		byTranscriptSourceEntryId,
		parentsByChildOperationId,
	};
}

export function findOperationForTranscriptSourceEntry(
	entryId: string,
	index: OperationIndex
): OperationSnapshot | null {
	const linkedOperation = index.byTranscriptSourceEntryId.get(entryId);
	if (linkedOperation !== undefined) {
		return linkedOperation;
	}
	return null;
}
