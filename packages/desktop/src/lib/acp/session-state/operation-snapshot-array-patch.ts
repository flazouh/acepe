import type { OperationSnapshot } from "../../services/acp-types.js";

export type OperationSnapshotArrayPatch = {
	readonly baseOperations: readonly OperationSnapshot[];
	readonly patchedOperationsByIndex: ReadonlyMap<number, OperationSnapshot> | null;
	readonly appendedOperations: readonly OperationSnapshot[] | null;
};

const operationSnapshotArrayPatches = new WeakMap<
	readonly OperationSnapshot[],
	OperationSnapshotArrayPatch
>();

export function markOperationSnapshotArrayPatch(
	operations: readonly OperationSnapshot[],
	patch: OperationSnapshotArrayPatch
): void {
	operationSnapshotArrayPatches.set(operations, patch);
}

export function getOperationSnapshotArrayPatch(
	operations: readonly OperationSnapshot[]
): OperationSnapshotArrayPatch | undefined {
	return operationSnapshotArrayPatches.get(operations);
}
