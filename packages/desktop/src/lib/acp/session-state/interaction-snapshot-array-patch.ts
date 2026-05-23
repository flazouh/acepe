import type { InteractionSnapshot } from "../../services/acp-types.js";

export type InteractionSnapshotArrayPatch = {
	readonly baseInteractions: readonly InteractionSnapshot[];
	readonly patchedInteractionsByIndex: ReadonlyMap<number, InteractionSnapshot> | null;
	readonly appendedInteractions: readonly InteractionSnapshot[] | null;
};

const interactionSnapshotArrayPatches = new WeakMap<
	readonly InteractionSnapshot[],
	InteractionSnapshotArrayPatch
>();

export function markInteractionSnapshotArrayPatch(
	interactions: readonly InteractionSnapshot[],
	patch: InteractionSnapshotArrayPatch
): void {
	interactionSnapshotArrayPatches.set(interactions, patch);
}

export function getInteractionSnapshotArrayPatch(
	interactions: readonly InteractionSnapshot[]
): InteractionSnapshotArrayPatch | undefined {
	return interactionSnapshotArrayPatches.get(interactions);
}
