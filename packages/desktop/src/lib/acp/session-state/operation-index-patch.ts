/**
 * Operation-index patching subsystem for the canonical agent-panel graph
 * materializer: incremental index patch strategies (marked / stable-in-place /
 * full), the lazy patched/appended Map views, and affected-transcript-entry
 * collection. Pure derivations over the canonical operation snapshots — no
 * mutation of canonical state. GOD-safe; extracted as a cohesive unit (entry
 * points: applyOperationIndexPatch, collectAffectedTranscriptEntryIds).
 */
import type { OperationSnapshot } from "../../services/acp-types.js";
import type { OperationIndex, OperationIndexPatchResult } from "./operation-index.js";
import { getOperationSnapshotArrayPatch } from "./operation-snapshot-array-patch.js";
import { areJsonLikeValuesEquivalent } from "./scene-equivalence.js";

export function applyOperationIndexPatch(
	previousOperations: readonly OperationSnapshot[],
	nextOperations: readonly OperationSnapshot[],
	previousIndex: OperationIndex
): OperationIndexPatchResult | null {
	if (nextOperations.length < previousOperations.length) {
		return null;
	}

	const operationArrayPatch = getOperationSnapshotArrayPatch(nextOperations);
	if (operationArrayPatch?.baseOperations === previousOperations) {
		return applyMarkedOperationIndexPatch(
			previousOperations,
			previousIndex,
			operationArrayPatch.patchedOperationsByIndex,
			operationArrayPatch.appendedOperations
		);
	}

	const stableInPlacePatch = applyStableOperationIndexPatchInPlace(
		previousOperations,
		nextOperations,
		previousIndex
	);
	if (stableInPlacePatch !== null) {
		return stableInPlacePatch;
	}

	let operationIndex: OperationIndex | null = null;
	const changedOperationIds = new Set<string>();

	for (let index = 0; index < previousOperations.length; index += 1) {
		const previousOperation = previousOperations[index];
		const nextOperation = nextOperations[index];
		if (previousOperation === undefined || nextOperation === undefined) {
			return null;
		}
		if (previousOperation.id !== nextOperation.id) {
			return null;
		}
		if (previousOperation === nextOperation) {
			continue;
		}

		operationIndex ??= cloneOperationIndex(previousIndex);
		replaceOperationInIndex(operationIndex, previousOperation, nextOperation);
		changedOperationIds.add(nextOperation.id);
	}

	if (nextOperations.length > previousOperations.length) {
		operationIndex ??= cloneOperationIndex(previousIndex);
		for (let index = previousOperations.length; index < nextOperations.length; index += 1) {
			const operation = nextOperations[index];
			if (operation === undefined) {
				return null;
			}
			addOperationToIndex(operationIndex, operation);
			changedOperationIds.add(operation.id);
		}
	}

	return {
		operationIndex: operationIndex ?? previousIndex,
		changedOperationIds,
	};
}

function applyStableOperationIndexPatchInPlace(
	previousOperations: readonly OperationSnapshot[],
	nextOperations: readonly OperationSnapshot[],
	previousIndex: OperationIndex
): OperationIndexPatchResult | null {
	if (nextOperations.length < previousOperations.length) {
		return null;
	}

	const changedOperationIds = new Set<string>();
	const patchedOperationIds = new Set<string>();
	const operationsToPatch: OperationSnapshot[] = [];
	for (let index = 0; index < previousOperations.length; index += 1) {
		const previousOperation = previousOperations[index];
		const nextOperation = nextOperations[index];
		if (
			previousOperation === undefined ||
			nextOperation === undefined ||
			previousOperation.id !== nextOperation.id
		) {
			return null;
		}
		if (previousOperation === nextOperation) {
			continue;
		}
		if (!canPatchOperationIndexInPlace(previousOperation, nextOperation)) {
			return null;
		}
		patchedOperationIds.add(nextOperation.id);
		changedOperationIds.add(nextOperation.id);
		operationsToPatch.push(nextOperation);
	}

	const affectedEntryIds = collectAffectedTranscriptEntryIds(
		previousIndex,
		previousIndex,
		patchedOperationIds
	);
	const patchedOperationById = createOperationPatchMap(operationsToPatch);
	const patchedOperationByTranscriptEntryId =
		createTranscriptLinkedOperationPatchMap(operationsToPatch);
	const hasPatchedOperations = changedOperationIds.size > 0;
	let operationIndex = hasPatchedOperations
		? createPatchedOperationIndex(
				previousIndex,
				patchedOperationById,
				patchedOperationByTranscriptEntryId
			)
		: previousIndex;

	if (nextOperations.length > previousOperations.length) {
		const appendedOperations: OperationSnapshot[] = [];
		const appendedOperationIds = new Set<string>();
		for (let index = previousOperations.length; index < nextOperations.length; index += 1) {
			const operation = nextOperations[index];
			if (operation === undefined) {
				return null;
			}
			appendedOperations.push(operation);
			appendedOperationIds.add(operation.id);
			changedOperationIds.add(operation.id);
		}
		operationIndex = appendOperationIndex(operationIndex, appendedOperations);
		const appendedAffectedEntryIds = collectAffectedTranscriptEntryIds(
			previousIndex,
			operationIndex,
			appendedOperationIds
		);
		for (const entryId of appendedAffectedEntryIds) {
			affectedEntryIds.add(entryId);
		}
	}

	if (changedOperationIds.size === 0) {
		return {
			operationIndex: previousIndex,
			changedOperationIds,
			affectedEntryIds,
		};
	}

	return {
		operationIndex,
		changedOperationIds,
		affectedEntryIds,
	};
}

export function applyStableMarkedOperationIndexPatchInPlace(
	previousOperations: readonly OperationSnapshot[],
	nextOperations: readonly OperationSnapshot[],
	previousIndex: OperationIndex
): OperationIndexPatchResult | null {
	const operationArrayPatch = getOperationSnapshotArrayPatch(nextOperations);
	if (
		operationArrayPatch?.baseOperations !== previousOperations ||
		operationArrayPatch.patchedOperationsByIndex === null
	) {
		return null;
	}

	const patchedOperationIds = new Set<string>();
	const changedOperationIds = new Set<string>();
	const operationsToPatch: OperationSnapshot[] = [];
	for (const [index, nextOperation] of operationArrayPatch.patchedOperationsByIndex) {
		const previousOperation = previousOperations[index];
		if (previousOperation === undefined || previousOperation.id !== nextOperation.id) {
			return null;
		}
		if (previousOperation === nextOperation) {
			continue;
		}
		if (!canPatchOperationIndexInPlace(previousOperation, nextOperation)) {
			return null;
		}
		patchedOperationIds.add(nextOperation.id);
		changedOperationIds.add(nextOperation.id);
		operationsToPatch.push(nextOperation);
	}

	const appendedOperations = operationArrayPatch.appendedOperations;
	const hasAppendedOperations = appendedOperations !== null && appendedOperations.length > 0;
	if (changedOperationIds.size === 0 && !hasAppendedOperations) {
		return {
			operationIndex: previousIndex,
			changedOperationIds,
			affectedEntryIds: new Set(),
		};
	}

	const affectedEntryIds = collectAffectedTranscriptEntryIds(
		previousIndex,
		previousIndex,
		patchedOperationIds
	);
	const patchedOperationById = createOperationPatchMap(operationsToPatch);
	const patchedOperationByTranscriptEntryId =
		createTranscriptLinkedOperationPatchMap(operationsToPatch);
	const patchedOperationIndex =
		changedOperationIds.size === 0
			? previousIndex
			: createPatchedOperationIndex(
					previousIndex,
					patchedOperationById,
					patchedOperationByTranscriptEntryId
				);

	let operationIndex = patchedOperationIndex;
	if (hasAppendedOperations) {
		operationIndex = appendOperationIndex(patchedOperationIndex, appendedOperations);
		const appendedOperationIds = new Set<string>();
		for (const operation of appendedOperations) {
			appendedOperationIds.add(operation.id);
			changedOperationIds.add(operation.id);
		}
		const appendedAffectedEntryIds = collectAffectedTranscriptEntryIds(
			previousIndex,
			operationIndex,
			appendedOperationIds
		);
		for (const entryId of appendedAffectedEntryIds) {
			affectedEntryIds.add(entryId);
		}
	}

	return {
		operationIndex,
		changedOperationIds,
		affectedEntryIds,
	};
}

function canPatchOperationIndexInPlace(
	previousOperation: OperationSnapshot,
	nextOperation: OperationSnapshot
): boolean {
	return (
		areJsonLikeValuesEquivalent(previousOperation.source_link, nextOperation.source_link) &&
		areStringListsEquivalent(
			previousOperation.child_operation_ids,
			nextOperation.child_operation_ids
		)
	);
}

function areStringListsEquivalent(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function applyMarkedOperationIndexPatch(
	previousOperations: readonly OperationSnapshot[],
	previousIndex: OperationIndex,
	patchedOperationsByIndex: ReadonlyMap<number, OperationSnapshot> | null,
	appendedOperations: readonly OperationSnapshot[] | null
): OperationIndexPatchResult | null {
	let operationIndex: OperationIndex | null = null;
	const changedOperationIds = new Set<string>();

	if (patchedOperationsByIndex !== null) {
		for (const [index, nextOperation] of patchedOperationsByIndex) {
			const previousOperation = previousOperations[index];
			if (previousOperation === undefined || previousOperation.id !== nextOperation.id) {
				return null;
			}
			if (previousOperation === nextOperation) {
				continue;
			}

			operationIndex ??= cloneOperationIndex(previousIndex);
			replaceOperationInIndex(operationIndex, previousOperation, nextOperation);
			changedOperationIds.add(nextOperation.id);
		}
	}

	if (appendedOperations !== null && appendedOperations.length > 0) {
		if (operationIndex === null) {
			operationIndex = appendOperationIndex(previousIndex, appendedOperations);
		} else {
			for (const operation of appendedOperations) {
				addOperationToIndex(operationIndex, operation);
			}
		}
		for (const operation of appendedOperations) {
			changedOperationIds.add(operation.id);
		}
	}

	return {
		operationIndex: operationIndex ?? previousIndex,
		changedOperationIds,
	};
}

function cloneOperationIndex(index: OperationIndex): OperationIndex {
	return {
		byOperationId: new Map(index.byOperationId),
		byTranscriptSourceEntryId: new Map(index.byTranscriptSourceEntryId),
		parentsByChildOperationId: new Map(index.parentsByChildOperationId),
	};
}

function appendOperationIndex(
	index: OperationIndex,
	appendedOperations: readonly OperationSnapshot[]
): OperationIndex {
	return {
		byOperationId: new AppendedOperationByIdMap(index.byOperationId, appendedOperations),
		byTranscriptSourceEntryId: new AppendedOperationByTranscriptEntryMap(
			index.byTranscriptSourceEntryId,
			appendedOperations
		),
		parentsByChildOperationId: new AppendedParentsByChildOperationMap(
			index.parentsByChildOperationId,
			appendedOperations
		),
	};
}

function createOperationPatchMap(
	operations: readonly OperationSnapshot[]
): ReadonlyMap<string, OperationSnapshot> {
	const patches = new Map<string, OperationSnapshot>();
	for (const operation of operations) {
		patches.set(operation.id, operation);
	}
	return patches;
}

function createTranscriptLinkedOperationPatchMap(
	operations: readonly OperationSnapshot[]
): ReadonlyMap<string, OperationSnapshot> {
	const patches = new Map<string, OperationSnapshot>();
	for (const operation of operations) {
		if (operation.source_link.kind === "transcript_linked") {
			patches.set(operation.source_link.entry_id, operation);
		}
	}
	return patches;
}

function createPatchedOperationIndex(
	index: OperationIndex,
	operationPatchesById: ReadonlyMap<string, OperationSnapshot>,
	operationPatchesByTranscriptEntryId: ReadonlyMap<string, OperationSnapshot>
): OperationIndex {
	return {
		byOperationId: new PatchedOperationMap(index.byOperationId, operationPatchesById),
		byTranscriptSourceEntryId: new PatchedOperationMap(
			index.byTranscriptSourceEntryId,
			operationPatchesByTranscriptEntryId
		),
		parentsByChildOperationId: index.parentsByChildOperationId,
	};
}

class PatchedOperationMap extends Map<string, OperationSnapshot> {
	constructor(
		private readonly base: Map<string, OperationSnapshot>,
		private readonly patches: ReadonlyMap<string, OperationSnapshot>
	) {
		super();
	}

	override get size(): number {
		let size = this.base.size;
		for (const key of this.patches.keys()) {
			if (!this.base.has(key) && !super.has(key)) {
				size += 1;
			}
		}
		return size + super.size;
	}

	override get(key: string): OperationSnapshot | undefined {
		const local = super.get(key);
		if (local !== undefined) {
			return local;
		}
		return this.patches.get(key) ?? this.base.get(key);
	}

	override has(key: string): boolean {
		return this.get(key) !== undefined;
	}

	override *entries(): MapIterator<[string, OperationSnapshot]> {
		const yieldedKeys = new Set<string>();
		for (const [key, value] of this.patches.entries()) {
			if (!super.has(key)) {
				yieldedKeys.add(key);
				yield [key, value];
			}
		}
		for (const [key, value] of this.base.entries()) {
			if (!yieldedKeys.has(key) && !super.has(key)) {
				yieldedKeys.add(key);
				yield [key, value];
			}
		}
		for (const [key, value] of super.entries()) {
			if (!yieldedKeys.has(key)) {
				yield [key, value];
			}
		}
	}

	override [Symbol.iterator](): MapIterator<[string, OperationSnapshot]> {
		return this.entries();
	}
}

class AppendedOperationByIdMap extends Map<string, OperationSnapshot> {
	constructor(
		private readonly base: Map<string, OperationSnapshot>,
		private readonly appendedOperations: readonly OperationSnapshot[]
	) {
		super();
	}

	override get size(): number {
		let size = this.base.size;
		for (const operation of this.appendedOperations) {
			if (!this.base.has(operation.id) && !super.has(operation.id)) {
				size += 1;
			}
		}
		return size + super.size;
	}

	override get(key: string): OperationSnapshot | undefined {
		const local = super.get(key);
		if (local !== undefined) {
			return local;
		}
		for (const operation of this.appendedOperations) {
			if (operation.id === key) {
				return operation;
			}
		}
		return this.base.get(key);
	}

	override has(key: string): boolean {
		return this.get(key) !== undefined;
	}

	override *entries(): MapIterator<[string, OperationSnapshot]> {
		const yieldedKeys = new Set<string>();
		for (const [key, value] of this.base.entries()) {
			if (!super.has(key)) {
				yieldedKeys.add(key);
				yield [key, value];
			}
		}
		for (const operation of this.appendedOperations) {
			if (!yieldedKeys.has(operation.id) && !super.has(operation.id)) {
				yieldedKeys.add(operation.id);
				yield [operation.id, operation];
			}
		}
		for (const [key, value] of super.entries()) {
			if (!yieldedKeys.has(key)) {
				yield [key, value];
			}
		}
	}

	override [Symbol.iterator](): MapIterator<[string, OperationSnapshot]> {
		return this.entries();
	}
}

class AppendedOperationByTranscriptEntryMap extends Map<string, OperationSnapshot> {
	constructor(
		private readonly base: Map<string, OperationSnapshot>,
		private readonly appendedOperations: readonly OperationSnapshot[]
	) {
		super();
	}

	override get size(): number {
		let size = this.base.size;
		for (const operation of this.appendedOperations) {
			if (
				operation.source_link.kind === "transcript_linked" &&
				!this.base.has(operation.source_link.entry_id) &&
				!super.has(operation.source_link.entry_id)
			) {
				size += 1;
			}
		}
		return size + super.size;
	}

	override get(key: string): OperationSnapshot | undefined {
		const local = super.get(key);
		if (local !== undefined) {
			return local;
		}
		for (const operation of this.appendedOperations) {
			if (
				operation.source_link.kind === "transcript_linked" &&
				operation.source_link.entry_id === key
			) {
				return operation;
			}
		}
		return this.base.get(key);
	}

	override has(key: string): boolean {
		return this.get(key) !== undefined;
	}

	override *entries(): MapIterator<[string, OperationSnapshot]> {
		const yieldedKeys = new Set<string>();
		for (const [key, value] of this.base.entries()) {
			if (!super.has(key)) {
				yieldedKeys.add(key);
				yield [key, value];
			}
		}
		for (const operation of this.appendedOperations) {
			if (
				operation.source_link.kind === "transcript_linked" &&
				!yieldedKeys.has(operation.source_link.entry_id) &&
				!super.has(operation.source_link.entry_id)
			) {
				yieldedKeys.add(operation.source_link.entry_id);
				yield [operation.source_link.entry_id, operation];
			}
		}
		for (const [key, value] of super.entries()) {
			if (!yieldedKeys.has(key)) {
				yield [key, value];
			}
		}
	}

	override [Symbol.iterator](): MapIterator<[string, OperationSnapshot]> {
		return this.entries();
	}
}

class AppendedParentsByChildOperationMap extends Map<string, OperationSnapshot[]> {
	private appendedParentsByChildOperationId: Map<string, OperationSnapshot[]> | null = null;

	constructor(
		private readonly base: Map<string, OperationSnapshot[]>,
		private readonly appendedOperations: readonly OperationSnapshot[]
	) {
		super();
	}

	override get(key: string): OperationSnapshot[] | undefined {
		const local = super.get(key);
		const baseParents = this.base.get(key);
		const appendedParents = this.getAppendedParentsByChildOperationId().get(key) ?? [];
		if (local === undefined && appendedParents.length === 0) {
			return baseParents;
		}
		return [...(baseParents ?? []), ...(local ?? []), ...appendedParents];
	}

	override has(key: string): boolean {
		return this.get(key) !== undefined;
	}

	override *entries(): MapIterator<[string, OperationSnapshot[]]> {
		const yieldedKeys = new Set<string>();
		for (const [key] of this.base.entries()) {
			const parents = this.get(key);
			if (parents !== undefined) {
				yieldedKeys.add(key);
				yield [key, parents];
			}
		}
		for (const operation of this.appendedOperations) {
			for (const childOperationId of operation.child_operation_ids) {
				if (!yieldedKeys.has(childOperationId)) {
					const parents = this.get(childOperationId);
					if (parents !== undefined) {
						yieldedKeys.add(childOperationId);
						yield [childOperationId, parents];
					}
				}
			}
		}
		for (const [key, value] of super.entries()) {
			if (!yieldedKeys.has(key)) {
				yield [key, value];
			}
		}
	}

	override [Symbol.iterator](): MapIterator<[string, OperationSnapshot[]]> {
		return this.entries();
	}

	private getAppendedParentsByChildOperationId(): Map<string, OperationSnapshot[]> {
		if (this.appendedParentsByChildOperationId !== null) {
			return this.appendedParentsByChildOperationId;
		}

		const next = new Map<string, OperationSnapshot[]>();
		for (const operation of this.appendedOperations) {
			for (const childOperationId of operation.child_operation_ids) {
				const parents = next.get(childOperationId);
				if (parents === undefined) {
					next.set(childOperationId, [operation]);
					continue;
				}
				parents.push(operation);
			}
		}
		this.appendedParentsByChildOperationId = next;
		return next;
	}
}

function replaceOperationInIndex(
	index: OperationIndex,
	previousOperation: OperationSnapshot,
	nextOperation: OperationSnapshot
): void {
	removeOperationFromIndex(index, previousOperation);
	addOperationToIndex(index, nextOperation);
}

function addOperationToIndex(index: OperationIndex, operation: OperationSnapshot): void {
	index.byOperationId.set(operation.id, operation);
	if (operation.source_link.kind === "transcript_linked") {
		index.byTranscriptSourceEntryId.set(operation.source_link.entry_id, operation);
	}
	for (const childOperationId of operation.child_operation_ids) {
		const parents = index.parentsByChildOperationId.get(childOperationId);
		if (parents === undefined) {
			index.parentsByChildOperationId.set(childOperationId, [operation]);
			continue;
		}
		index.parentsByChildOperationId.set(childOperationId, [...parents, operation]);
	}
}

function removeOperationFromIndex(index: OperationIndex, operation: OperationSnapshot): void {
	index.byOperationId.delete(operation.id);
	if (operation.source_link.kind === "transcript_linked") {
		const linkedOperation = index.byTranscriptSourceEntryId.get(operation.source_link.entry_id);
		if (linkedOperation?.id === operation.id) {
			index.byTranscriptSourceEntryId.delete(operation.source_link.entry_id);
		}
	}
	for (const childOperationId of operation.child_operation_ids) {
		const parents = index.parentsByChildOperationId.get(childOperationId);
		if (parents === undefined) {
			continue;
		}
		const nextParents = parents.filter((parent) => parent.id !== operation.id);
		if (nextParents.length === 0) {
			index.parentsByChildOperationId.delete(childOperationId);
			continue;
		}
		index.parentsByChildOperationId.set(childOperationId, nextParents);
	}
}

export function collectAffectedTranscriptEntryIds(
	previousOperationIndex: OperationIndex,
	operationIndex: OperationIndex,
	changedOperationIds: ReadonlySet<string>
): Set<string> {
	const affectedEntryIds = new Set<string>();
	collectAffectedTranscriptEntryIdsFromIndex(
		previousOperationIndex,
		changedOperationIds,
		affectedEntryIds
	);
	collectAffectedTranscriptEntryIdsFromIndex(operationIndex, changedOperationIds, affectedEntryIds);
	return affectedEntryIds;
}

function collectAffectedTranscriptEntryIdsFromIndex(
	operationIndex: OperationIndex,
	changedOperationIds: ReadonlySet<string>,
	affectedEntryIds: Set<string>
): void {
	for (const operationId of changedOperationIds) {
		const operation = operationIndex.byOperationId.get(operationId);
		if (operation?.source_link.kind === "transcript_linked") {
			affectedEntryIds.add(operation.source_link.entry_id);
		}

		const parents = operationIndex.parentsByChildOperationId.get(operationId);
		if (parents === undefined) {
			continue;
		}
		for (const parentOperation of parents) {
			if (parentOperation.source_link.kind === "transcript_linked") {
				affectedEntryIds.add(parentOperation.source_link.entry_id);
			}
		}
	}
}
