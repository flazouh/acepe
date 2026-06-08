/**
 * Generic snapshot-merge-by-id infrastructure for the session store: merge a
 * patch array into a base snapshot array by id (patching in place + appending),
 * returning a lazy Proxy-backed merged array tagged with its patch shape so the
 * agent-panel materializer's fast paths can diff incrementally. Plus the typed
 * operation/interaction merge wrappers. Pure canonical-data transforms — no
 * projection state, no provider quirks, no order repair. GOD-safe.
 */
import type { InteractionSnapshot, OperationSnapshot } from "../../services/acp-types.js";
import { markInteractionSnapshotArrayPatch } from "../session-state/interaction-snapshot-array-patch.js";
import { markOperationSnapshotArrayPatch } from "../session-state/operation-snapshot-array-patch.js";
import { toArrayIndex } from "./array-index-utils.js";

export type SnapshotWithId = {
	readonly id: string;
};

export const operationSnapshotIndexes = new WeakMap<
	readonly OperationSnapshot[],
	ReadonlyMap<string, number>
>();
const interactionSnapshotIndexes = new WeakMap<
	readonly InteractionSnapshot[],
	ReadonlyMap<string, number>
>();

type MergedSnapshotArrayPatch<TSnapshot extends SnapshotWithId> = {
	readonly patchedIndexes: ReadonlyMap<number, TSnapshot> | null;
	readonly appendedSnapshots: readonly TSnapshot[] | null;
};

const mergedSnapshotArrayPatches = new WeakMap<
	readonly SnapshotWithId[],
	MergedSnapshotArrayPatch<SnapshotWithId>
>();

function getSnapshotIndex<TSnapshot extends SnapshotWithId>(
	snapshots: readonly TSnapshot[],
	indexes: WeakMap<readonly TSnapshot[], ReadonlyMap<string, number>>
): ReadonlyMap<string, number> {
	const existing = indexes.get(snapshots);
	if (existing !== undefined) {
		return existing;
	}

	const next = new Map<string, number>();
	for (let index = 0; index < snapshots.length; index += 1) {
		const snapshot = snapshots[index];
		if (snapshot !== undefined && !next.has(snapshot.id)) {
			next.set(snapshot.id, index);
		}
	}
	indexes.set(snapshots, next);
	return next;
}

function mergeSnapshotsById<TSnapshot extends SnapshotWithId>(
	current: readonly TSnapshot[],
	patches: readonly TSnapshot[],
	indexes: WeakMap<readonly TSnapshot[], ReadonlyMap<string, number>>
): TSnapshot[] {
	const currentIndex = getSnapshotIndex(current, indexes);
	const patchesById = new Map<string, TSnapshot>();
	for (const patch of patches) {
		patchesById.set(patch.id, patch);
	}

	let patchedIndexes: Map<number, TSnapshot> | null = null;
	for (const [id, patch] of patchesById) {
		const index = currentIndex.get(id);
		if (index !== undefined) {
			if (current[index] === patch) {
				continue;
			}
			patchedIndexes ??= new Map<number, TSnapshot>();
			patchedIndexes.set(index, patch);
		}
	}

	let appendedSnapshots: TSnapshot[] | null = null;
	const appendedIds = new Set<string>();
	for (const patch of patches) {
		if (currentIndex.has(patch.id) || appendedIds.has(patch.id)) {
			continue;
		}

		const appendedPatch = patchesById.get(patch.id);
		if (appendedPatch === undefined) {
			continue;
		}

		appendedSnapshots ??= [];
		appendedSnapshots.push(appendedPatch);
		appendedIds.add(patch.id);
	}

	if (patchedIndexes === null && appendedSnapshots === null) {
		return current as TSnapshot[];
	}

	const next = createMergedSnapshotArray(current, patchedIndexes, appendedSnapshots);
	indexes.set(
		next,
		appendedSnapshots === null
			? currentIndex
			: new AppendedSnapshotIndexMap(currentIndex, appendedSnapshots, current.length)
	);
	return next;
}

class AppendedSnapshotIndexMap<TSnapshot extends SnapshotWithId>
	implements ReadonlyMap<string, number>
{
	readonly [Symbol.toStringTag] = "AppendedSnapshotIndexMap";

	constructor(
		private readonly base: ReadonlyMap<string, number>,
		private readonly appendedSnapshots: readonly TSnapshot[],
		private readonly baseLength: number
	) {}

	get size(): number {
		let appendedCount = 0;
		for (const snapshot of this.appendedSnapshots) {
			if (snapshot !== undefined && !this.base.has(snapshot.id)) {
				appendedCount += 1;
			}
		}
		return this.base.size + appendedCount;
	}

	get(key: string): number | undefined {
		for (let index = 0; index < this.appendedSnapshots.length; index += 1) {
			const snapshot = this.appendedSnapshots[index];
			if (snapshot?.id === key) {
				return this.baseLength + index;
			}
		}
		return this.base.get(key);
	}

	has(key: string): boolean {
		return this.get(key) !== undefined;
	}

	forEach(
		callbackfn: (value: number, key: string, map: ReadonlyMap<string, number>) => void,
		thisArg?: unknown
	): void {
		for (const [key, value] of this.entries()) {
			callbackfn.call(thisArg, value, key, this);
		}
	}

	private *entryIterator(): IterableIterator<[string, number]> {
		const appendedKeys = new Set<string>();
		for (let index = 0; index < this.appendedSnapshots.length; index += 1) {
			const snapshot = this.appendedSnapshots[index];
			if (snapshot !== undefined) {
				appendedKeys.add(snapshot.id);
			}
		}
		for (const [key, value] of this.base.entries()) {
			if (!appendedKeys.has(key)) {
				yield [key, value];
			}
		}
		for (let index = 0; index < this.appendedSnapshots.length; index += 1) {
			const snapshot = this.appendedSnapshots[index];
			if (snapshot !== undefined) {
				yield [snapshot.id, this.baseLength + index];
			}
		}
	}

	entries(): MapIterator<[string, number]> {
		return this.entryIterator() as unknown as MapIterator<[string, number]>;
	}

	private *keyIterator(): IterableIterator<string> {
		for (const [key] of this.entries()) {
			yield key;
		}
	}

	keys(): MapIterator<string> {
		return this.keyIterator() as unknown as MapIterator<string>;
	}

	private *valueIterator(): IterableIterator<number> {
		for (const [, value] of this.entries()) {
			yield value;
		}
	}

	values(): MapIterator<number> {
		return this.valueIterator() as unknown as MapIterator<number>;
	}

	[Symbol.iterator](): MapIterator<[string, number]> {
		return this.entries();
	}
}

function createMergedSnapshotArray<TSnapshot extends SnapshotWithId>(
	base: readonly TSnapshot[],
	patchedIndexes: ReadonlyMap<number, TSnapshot> | null,
	appendedSnapshots: readonly TSnapshot[] | null
): TSnapshot[] {
	const appended = appendedSnapshots ?? [];
	const target = new Array<TSnapshot>(base.length + appended.length);
	const snapshots = new Proxy(target, {
		get(targetArray, property, receiver) {
			if (property === Symbol.iterator) {
				return function* () {
					for (let index = 0; index < targetArray.length; index += 1) {
						yield selectMergedSnapshot(base, patchedIndexes, appended, index);
					}
				};
			}
			if (typeof property === "string") {
				const index = toArrayIndex(property);
				if (index !== null) {
					return selectMergedSnapshot(base, patchedIndexes, appended, index);
				}
				if (property === "slice") {
					return (start?: number, end?: number) =>
						Array.prototype.slice.call(receiver, start, end);
				}
			}
			const value = Reflect.get(targetArray, property, receiver);
			return typeof value === "function" ? value.bind(receiver) : value;
		},
		has(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null) {
				return index >= 0 && index < targetArray.length;
			}
			return property in targetArray;
		},
		getOwnPropertyDescriptor(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null && index >= 0 && index < targetArray.length) {
				return {
					configurable: true,
					enumerable: true,
					value: selectMergedSnapshot(base, patchedIndexes, appended, index),
					writable: false,
				};
			}
			return Reflect.getOwnPropertyDescriptor(targetArray, property);
		},
	});
	mergedSnapshotArrayPatches.set(snapshots, { patchedIndexes, appendedSnapshots });
	return snapshots;
}

function getMergedSnapshotArrayPatch<TSnapshot extends SnapshotWithId>(
	snapshots: readonly TSnapshot[]
): MergedSnapshotArrayPatch<TSnapshot> | undefined {
	return mergedSnapshotArrayPatches.get(snapshots) as
		| MergedSnapshotArrayPatch<TSnapshot>
		| undefined;
}

function selectMergedSnapshot<TSnapshot extends SnapshotWithId>(
	base: readonly TSnapshot[],
	patchedIndexes: ReadonlyMap<number, TSnapshot> | null,
	appended: readonly TSnapshot[],
	index: number
): TSnapshot | undefined {
	if (index < base.length) {
		return patchedIndexes?.get(index) ?? base[index];
	}
	return appended[index - base.length];
}

export function mergeOperationSnapshots(
	current: readonly OperationSnapshot[],
	patches: readonly OperationSnapshot[]
): OperationSnapshot[] {
	const next = mergeSnapshotsById(current, patches, operationSnapshotIndexes);
	if (next !== current) {
		const patch = getMergedSnapshotArrayPatch(next);
		if (patch !== undefined) {
			markOperationSnapshotArrayPatch(next, {
				baseOperations: current,
				patchedOperationsByIndex: patch.patchedIndexes,
				appendedOperations: patch.appendedSnapshots,
			});
		}
	}
	return next;
}

export function mergeInteractionSnapshots(
	current: readonly InteractionSnapshot[],
	patches: readonly InteractionSnapshot[]
): InteractionSnapshot[] {
	const next = mergeSnapshotsById(current, patches, interactionSnapshotIndexes);
	if (next !== current) {
		const patch = getMergedSnapshotArrayPatch(next);
		if (patch !== undefined) {
			markInteractionSnapshotArrayPatch(next, {
				baseInteractions: current,
				patchedInteractionsByIndex: patch.patchedIndexes,
				appendedInteractions: patch.appendedSnapshots,
			});
		}
	}
	return next;
}

