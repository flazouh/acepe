import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";

import {
	findStableSceneEntryInsertion,
	isStableSceneEntryAppend,
	isStableSceneEntryTruncation,
} from "../components/agent-panel/logic/scene-entry-stability.js";
import type { SceneDisplayRow } from "../components/agent-panel/logic/scene-display-rows.js";
import { getSceneDisplayRowKey } from "../components/agent-panel/logic/scene-display-rows.js";
import { createAppendedSceneEntriesArray } from "../components/agent-panel/logic/scene-entry-array-view.js";
import type {
	AgentPanelSceneEntryArrayAppendPatch,
	AgentPanelSceneEntryArrayPatch,
	AgentPanelSceneEntryArraySplicePatch,
	AgentPanelSceneEntryArrayTruncation,
	RevealScenePatchPayload,
	ScenePatch,
	TokenRevealScenePatchPayload,
} from "../components/agent-panel/logic/scene-patch.js";
import { scenePatchStableIncremental } from "../components/agent-panel/logic/scene-patch.js";

export function findGraphSceneEntryForDisplayEntry(
	entry: SceneDisplayRow | undefined,
	sceneEntriesById: ReadonlyMap<string, AgentPanelSceneEntryModel> | undefined
): AgentPanelSceneEntryModel | undefined {
	if (
		entry === undefined ||
		entry.type === "thinking" ||
		entry.type === "assistant_merged" ||
		sceneEntriesById === undefined
	) {
		return undefined;
	}

	return sceneEntriesById.get(getSceneDisplayRowKey(entry));
}

export function createGraphSceneEntryIndex(
	sceneEntries: readonly AgentPanelSceneEntryModel[] | undefined
): ReadonlyMap<string, AgentPanelSceneEntryModel> | undefined {
	if (sceneEntries === undefined) {
		return undefined;
	}

	const entriesById = new Map<string, AgentPanelSceneEntryModel>();
	appendGraphSceneEntriesToIndex(entriesById, sceneEntries);
	return entriesById;
}

export interface GraphSceneEntryIndexReadModel {
	applyWithScenePatch(
		sceneEntries: readonly AgentPanelSceneEntryModel[],
		scenePatch: ScenePatch
	): ReadonlyMap<string, AgentPanelSceneEntryModel>;
	applySnapshot(
		sceneEntries: readonly AgentPanelSceneEntryModel[]
	): ReadonlyMap<string, AgentPanelSceneEntryModel>;
	applyAppendPatch(
		appendedSceneEntries: readonly AgentPanelSceneEntryModel[]
	): ReadonlyMap<string, AgentPanelSceneEntryModel>;
	selectIndex(): ReadonlyMap<string, AgentPanelSceneEntryModel>;
	selectEntryById(id: string | null | undefined): AgentPanelSceneEntryModel | undefined;
	selectEntryIndexById(id: string | null | undefined): number | undefined;
}

export function createGraphSceneEntryIndexReadModel(): GraphSceneEntryIndexReadModel {
	let previousSceneEntries: readonly AgentPanelSceneEntryModel[] | null = null;
	let entriesById: ReadonlyMap<string, AgentPanelSceneEntryModel> = new Map();
	let baseEntriesByIdBeforeTokenReveal: ReadonlyMap<string, AgentPanelSceneEntryModel> | null =
		null;
	let entryIndexesById: Map<string, number> = new Map();

	function applyGraphScenePatch(
		sceneEntries: readonly AgentPanelSceneEntryModel[],
		graphScenePatch: AgentPanelSceneEntryArrayPatch
	): ReadonlyMap<string, AgentPanelSceneEntryModel> | null {
		if (graphScenePatch.baseSceneEntries !== previousSceneEntries) {
			return null;
		}
		const patchedEntriesById = patchSameLengthGraphSceneEntrySet(
			entriesById,
			entryIndexesById,
			graphScenePatch.entriesByIndex
		);
		if (patchedEntriesById === null) {
			return null;
		}
		baseEntriesByIdBeforeTokenReveal = null;
		entriesById = patchedEntriesById;
		previousSceneEntries = sceneEntries;
		return entriesById;
	}

	function applyGraphSceneAppendPatch(
		sceneEntries: readonly AgentPanelSceneEntryModel[],
		appendPatch: AgentPanelSceneEntryArrayAppendPatch
	): ReadonlyMap<string, AgentPanelSceneEntryModel> | null {
		if (appendPatch.baseSceneEntries !== previousSceneEntries) {
			return null;
		}
		if (appendPatch.appendedEntries.length === 0) {
			previousSceneEntries = sceneEntries;
			return entriesById;
		}

		if (entriesById instanceof Map) {
			appendGraphSceneEntriesToIndexes(
				entriesById,
				entryIndexesById,
				appendPatch.appendedEntries,
				appendPatch.baseSceneEntries.length
			);
		} else {
			entriesById = new AppendedSceneEntryMap(entriesById, appendPatch.appendedEntries);
			appendGraphSceneEntryIndexes(
				entryIndexesById,
				appendPatch.appendedEntries,
				appendPatch.baseSceneEntries.length
			);
		}
		previousSceneEntries = sceneEntries;
		return entriesById;
	}

	function applyGraphSceneTruncation(
		sceneEntries: readonly AgentPanelSceneEntryModel[],
		truncation: AgentPanelSceneEntryArrayTruncation
	): ReadonlyMap<string, AgentPanelSceneEntryModel> | null {
		if (
			truncation.baseSceneEntries !== previousSceneEntries ||
			truncation.length !== sceneEntries.length
		) {
			return null;
		}
		baseEntriesByIdBeforeTokenReveal = null;
		const mutableEntriesById = ensureMutableSceneEntryMap(entriesById);
		entriesById = mutableEntriesById;
		removeTruncatedGraphSceneEntries(
			mutableEntriesById,
			entryIndexesById,
			truncation.baseSceneEntries,
			truncation.length
		);
		previousSceneEntries = sceneEntries;
		return entriesById;
	}

	function applyGraphSceneSplice(
		sceneEntries: readonly AgentPanelSceneEntryModel[],
		splicePatch: AgentPanelSceneEntryArraySplicePatch
	): ReadonlyMap<string, AgentPanelSceneEntryModel> | null {
		if (
			splicePatch.baseSceneEntries !== previousSceneEntries ||
			splicePatch.startIndex < 0 ||
			splicePatch.startIndex > splicePatch.baseSceneEntries.length ||
			sceneEntries.length !==
				splicePatch.startIndex +
					splicePatch.insertedEntries.length +
					splicePatch.trailingEntries.length
		) {
			return null;
		}
		baseEntriesByIdBeforeTokenReveal = null;
		const mutableEntriesById = ensureMutableSceneEntryMap(entriesById);
		entriesById = mutableEntriesById;
		removeTruncatedGraphSceneEntries(
			mutableEntriesById,
			entryIndexesById,
			splicePatch.baseSceneEntries,
			splicePatch.startIndex
		);
		appendGraphSceneEntriesToIndexes(
			mutableEntriesById,
			entryIndexesById,
			sceneEntries,
			splicePatch.startIndex,
			splicePatch.startIndex
		);
		previousSceneEntries = sceneEntries;
		return entriesById;
	}

	function applyDisplayScenePatch(
		displayScenePatch: RevealScenePatchPayload
	): ReadonlyMap<string, AgentPanelSceneEntryModel> | null {
		if (displayScenePatch.baseSceneEntries !== previousSceneEntries) {
			return null;
		}
		baseEntriesByIdBeforeTokenReveal ??= entriesById;
		entriesById = new PatchedSceneEntryMap(
			baseEntriesByIdBeforeTokenReveal,
			displayScenePatch.entriesByIndex.values()
		);
		return entriesById;
	}

	function applyTokenRevealPatch(
		tokenRevealPatch: TokenRevealScenePatchPayload
	): ReadonlyMap<string, AgentPanelSceneEntryModel> | null {
		if (tokenRevealPatch.baseSceneEntries !== previousSceneEntries) {
			return null;
		}
		baseEntriesByIdBeforeTokenReveal ??= entriesById;
		entriesById = new PatchedSceneEntryMap(
			baseEntriesByIdBeforeTokenReveal,
			tokenRevealPatch.entriesByIndex.values()
		);
		return entriesById;
	}

	function applyFullRebuild(
		sceneEntries: readonly AgentPanelSceneEntryModel[]
	): ReadonlyMap<string, AgentPanelSceneEntryModel> {
		baseEntriesByIdBeforeTokenReveal = null;
		const nextEntriesById = new Map<string, AgentPanelSceneEntryModel>();
		entriesById = nextEntriesById;
		entryIndexesById = new Map();
		appendGraphSceneEntriesToIndexes(nextEntriesById, entryIndexesById, sceneEntries, 0);
		previousSceneEntries = sceneEntries;
		return entriesById;
	}

	function applyWithScenePatchInternal(
		sceneEntries: readonly AgentPanelSceneEntryModel[],
		scenePatch: ScenePatch
	): ReadonlyMap<string, AgentPanelSceneEntryModel> {
		switch (scenePatch.kind) {
			case "identity": {
				if (baseEntriesByIdBeforeTokenReveal !== null) {
					entriesById = baseEntriesByIdBeforeTokenReveal;
					baseEntriesByIdBeforeTokenReveal = null;
				}
				return entriesById;
			}
			case "graphScene": {
				const patchedIndex = applyGraphScenePatch(sceneEntries, scenePatch.patch);
				return patchedIndex ?? applyFullRebuild(sceneEntries);
			}
			case "graphSceneAppend": {
				const appendedIndex = applyGraphSceneAppendPatch(sceneEntries, scenePatch.patch);
				return appendedIndex ?? applyFullRebuild(sceneEntries);
			}
			case "graphSceneTruncation": {
				const truncatedIndex = applyGraphSceneTruncation(sceneEntries, scenePatch.patch);
				return truncatedIndex ?? applyFullRebuild(sceneEntries);
			}
			case "graphSceneSplice": {
				const splicedIndex = applyGraphSceneSplice(sceneEntries, scenePatch.patch);
				return splicedIndex ?? applyFullRebuild(sceneEntries);
			}
			case "displayScene": {
				const displaySceneIndex = applyDisplayScenePatch(scenePatch.patch);
				if (displaySceneIndex !== null) {
					previousSceneEntries = scenePatch.patch.baseSceneEntries;
					return displaySceneIndex;
				}
				return applyFullRebuild(sceneEntries);
			}
			case "tokenReveal": {
				const tokenRevealIndex = applyTokenRevealPatch(scenePatch.patch);
				if (tokenRevealIndex !== null) {
					previousSceneEntries = scenePatch.patch.baseSceneEntries;
					return tokenRevealIndex;
				}
				return applyFullRebuild(sceneEntries);
			}
			case "stableIncremental": {
				const stableIndex = applyStableIncrementalPatch(sceneEntries);
				if (stableIndex !== null) {
					return stableIndex;
				}
				if (sceneEntries === previousSceneEntries) {
					if (baseEntriesByIdBeforeTokenReveal !== null) {
						entriesById = baseEntriesByIdBeforeTokenReveal;
						baseEntriesByIdBeforeTokenReveal = null;
					}
					return entriesById;
				}
				if (
					previousSceneEntries !== null &&
					areSceneEntryListsEquivalent(previousSceneEntries, sceneEntries)
				) {
					previousSceneEntries = sceneEntries;
					return entriesById;
				}
				return applyFullRebuild(sceneEntries);
			}
			case "fullRebuild":
				return applyFullRebuild(sceneEntries);
		}
	}

	return {
		applyWithScenePatch(sceneEntries, scenePatch) {
			return applyWithScenePatchInternal(sceneEntries, scenePatch);
		},
		applySnapshot(sceneEntries) {
			return applyWithScenePatchInternal(sceneEntries, scenePatchStableIncremental());
		},
		applyAppendPatch(appendedSceneEntries) {
			if (appendedSceneEntries.length === 0) {
				return entriesById;
			}

			const startIndex = previousSceneEntries?.length ?? entriesById.size;
			if (entriesById instanceof Map) {
				appendGraphSceneEntriesToIndexes(
					entriesById,
					entryIndexesById,
					appendedSceneEntries,
					startIndex
				);
			} else {
				entriesById = new AppendedSceneEntryMap(entriesById, appendedSceneEntries);
				appendGraphSceneEntryIndexes(entryIndexesById, appendedSceneEntries, startIndex);
			}
			previousSceneEntries = createAppendedSceneEntriesArray(
				previousSceneEntries ?? [],
				appendedSceneEntries
			);
			return entriesById;
		},
		selectIndex() {
			return entriesById;
		},
		selectEntryById(id) {
			return id == null ? undefined : entriesById.get(id);
		},
		selectEntryIndexById(id) {
			return id == null ? undefined : entryIndexesById.get(id);
		},
	};

	function applyStableIncrementalPatch(
		sceneEntries: readonly AgentPanelSceneEntryModel[]
	): ReadonlyMap<string, AgentPanelSceneEntryModel> | null {
		const previousEntries = previousSceneEntries;
		if (previousEntries === null) {
			return null;
		}

		if (areSceneEntryListsEquivalent(previousEntries, sceneEntries)) {
			return null;
		}

		baseEntriesByIdBeforeTokenReveal = null;

		const patchedPrefixAppendIndex = patchStablePrefixAppendGraphSceneEntries(
			entriesById,
			previousEntries,
			sceneEntries
		);
		if (patchedPrefixAppendIndex !== null) {
			appendGraphSceneEntriesToIndexes(
				patchedPrefixAppendIndex,
				entryIndexesById,
				sceneEntries,
				previousEntries.length,
				previousEntries.length
			);
			entriesById = patchedPrefixAppendIndex;
			previousSceneEntries = sceneEntries;
			return entriesById;
		}

		if (isStableSceneEntryAppend(previousEntries, sceneEntries)) {
			const mutableEntriesById = ensureMutableSceneEntryMap(entriesById);
			entriesById = mutableEntriesById;
			appendGraphSceneEntriesToIndexes(
				mutableEntriesById,
				entryIndexesById,
				sceneEntries,
				previousEntries.length,
				previousEntries.length
			);
			previousSceneEntries = sceneEntries;
			return entriesById;
		}

		if (isStableSceneEntryTruncation(previousEntries, sceneEntries)) {
			const mutableEntriesById = ensureMutableSceneEntryMap(entriesById);
			entriesById = mutableEntriesById;
			removeTruncatedGraphSceneEntries(
				mutableEntriesById,
				entryIndexesById,
				previousEntries,
				sceneEntries.length
			);
			previousSceneEntries = sceneEntries;
			return entriesById;
		}

		if (previousEntries.length === sceneEntries.length) {
			const mutableEntriesById = patchSameLengthGraphSceneEntries(
				entriesById,
				previousEntries,
				sceneEntries
			);
			if (mutableEntriesById !== null) {
				entriesById = mutableEntriesById;
				previousSceneEntries = sceneEntries;
				return entriesById;
			}
		}

		const insertion = findStableSceneEntryInsertion(previousEntries, sceneEntries);
		if (insertion !== null) {
			const mutableEntriesById = ensureMutableSceneEntryMap(entriesById);
			entriesById = mutableEntriesById;
			patchInsertedGraphSceneEntries(
				mutableEntriesById,
				entryIndexesById,
				sceneEntries,
				insertion.startIndex,
				insertion.insertedCount
			);
			previousSceneEntries = sceneEntries;
			return entriesById;
		}

		return null;
	}
}

function patchSameLengthGraphSceneEntrySet(
	entriesById: ReadonlyMap<string, AgentPanelSceneEntryModel>,
	entryIndexesById: ReadonlyMap<string, number>,
	patchedEntriesByIndex: ReadonlyMap<number, AgentPanelSceneEntryModel>
): ReadonlyMap<string, AgentPanelSceneEntryModel> | null {
	let mutableEntriesById: Map<string, AgentPanelSceneEntryModel> | null = null;
	for (const [entryIndex, patchedEntry] of patchedEntriesByIndex) {
		const currentIndexedEntry = entriesById.get(patchedEntry.id);
		if (currentIndexedEntry === undefined || entryIndexesById.get(patchedEntry.id) !== entryIndex) {
			return null;
		}
		if (areJsonLikeValuesEquivalent(currentIndexedEntry, patchedEntry)) {
			continue;
		}
		if (!(entriesById instanceof Map)) {
			continue;
		}
		mutableEntriesById ??= ensureMutableSceneEntryMap(entriesById);
		mutableEntriesById.set(patchedEntry.id, patchedEntry);
	}
	if (entriesById instanceof Map) {
		return mutableEntriesById ?? entriesById;
	}
	return new PatchedSceneEntryMap(entriesById, patchedEntriesByIndex.values());
}

function patchSameLengthGraphSceneEntries(
	entriesById: ReadonlyMap<string, AgentPanelSceneEntryModel>,
	previousSceneEntries: readonly AgentPanelSceneEntryModel[],
	sceneEntries: readonly AgentPanelSceneEntryModel[]
): Map<string, AgentPanelSceneEntryModel> | null {
	let mutableEntriesById: Map<string, AgentPanelSceneEntryModel> | null = null;
	for (let index = 0; index < sceneEntries.length; index += 1) {
		const previousEntry = previousSceneEntries[index];
		const nextEntry = sceneEntries[index];
		if (previousEntry === nextEntry) {
			continue;
		}
		if (
			previousEntry === undefined ||
			nextEntry === undefined ||
			previousEntry.id !== nextEntry.id ||
			!entriesById.has(nextEntry.id)
		) {
			return null;
		}
		const currentIndexedEntry = entriesById.get(nextEntry.id);
		if (currentIndexedEntry !== undefined && areJsonLikeValuesEquivalent(currentIndexedEntry, nextEntry)) {
			continue;
		}
		mutableEntriesById ??= ensureMutableSceneEntryMap(entriesById);
		mutableEntriesById.set(nextEntry.id, nextEntry);
	}

	return mutableEntriesById ?? ensureMutableSceneEntryMap(entriesById);
}

function areSceneEntryListsEquivalent(
	previousSceneEntries: readonly AgentPanelSceneEntryModel[],
	sceneEntries: readonly AgentPanelSceneEntryModel[]
): boolean {
	if (previousSceneEntries.length !== sceneEntries.length) {
		return false;
	}
	for (let index = 0; index < sceneEntries.length; index += 1) {
		const previousEntry = previousSceneEntries[index];
		const nextEntry = sceneEntries[index];
		if (
			previousEntry !== nextEntry &&
			(previousEntry === undefined ||
				nextEntry === undefined ||
				!areJsonLikeValuesEquivalent(previousEntry, nextEntry))
		) {
			return false;
		}
	}
	return true;
}

function patchStablePrefixAppendGraphSceneEntries(
	entriesById: ReadonlyMap<string, AgentPanelSceneEntryModel>,
	previousSceneEntries: readonly AgentPanelSceneEntryModel[],
	sceneEntries: readonly AgentPanelSceneEntryModel[]
): Map<string, AgentPanelSceneEntryModel> | null {
	if (sceneEntries.length <= previousSceneEntries.length) {
		return null;
	}

	let mutableEntriesById: Map<string, AgentPanelSceneEntryModel> | null = null;
	for (let index = 0; index < previousSceneEntries.length; index += 1) {
		const previousEntry = previousSceneEntries[index];
		const nextEntry = sceneEntries[index];
		if (previousEntry === nextEntry) {
			continue;
		}
		if (
			previousEntry === undefined ||
			nextEntry === undefined ||
			previousEntry.id !== nextEntry.id ||
			!entriesById.has(nextEntry.id)
		) {
			return null;
		}
		const currentIndexedEntry = entriesById.get(nextEntry.id);
		if (currentIndexedEntry !== undefined && areJsonLikeValuesEquivalent(currentIndexedEntry, nextEntry)) {
			continue;
		}
		mutableEntriesById ??= ensureMutableSceneEntryMap(entriesById);
		mutableEntriesById.set(nextEntry.id, nextEntry);
	}

	return mutableEntriesById ?? ensureMutableSceneEntryMap(entriesById);
}

function patchInsertedGraphSceneEntries(
	entriesById: Map<string, AgentPanelSceneEntryModel>,
	entryIndexesById: Map<string, number>,
	sceneEntries: readonly AgentPanelSceneEntryModel[],
	startIndex: number,
	insertedCount: number
): void {
	for (let index = startIndex; index < sceneEntries.length; index += 1) {
		const entry = sceneEntries[index];
		if (entry === undefined) {
			continue;
		}
		if (index < startIndex + insertedCount) {
			entriesById.set(entry.id, entry);
		}
		entryIndexesById.set(entry.id, index);
	}
}

function removeTruncatedGraphSceneEntries(
	entriesById: Map<string, AgentPanelSceneEntryModel>,
	entryIndexesById: Map<string, number>,
	previousSceneEntries: readonly AgentPanelSceneEntryModel[],
	startIndex: number
): void {
	for (let index = startIndex; index < previousSceneEntries.length; index += 1) {
		const entry = previousSceneEntries[index];
		if (entry === undefined) {
			continue;
		}
		entriesById.delete(entry.id);
		entryIndexesById.delete(entry.id);
	}
}

function ensureMutableSceneEntryMap(
	entriesById: ReadonlyMap<string, AgentPanelSceneEntryModel>
): Map<string, AgentPanelSceneEntryModel> {
	return entriesById instanceof Map ? entriesById : new Map(entriesById);
}

class PatchedSceneEntryMap implements ReadonlyMap<string, AgentPanelSceneEntryModel> {
	readonly [Symbol.toStringTag] = "PatchedSceneEntryMap";
	private readonly patchedEntriesById: ReadonlyMap<string, AgentPanelSceneEntryModel>;

	constructor(
		private readonly base: ReadonlyMap<string, AgentPanelSceneEntryModel>,
		patchedEntries: Iterable<AgentPanelSceneEntryModel>
	) {
		const patchedEntriesById = new Map<string, AgentPanelSceneEntryModel>();
		for (const entry of patchedEntries) {
			patchedEntriesById.set(entry.id, entry);
		}
		this.patchedEntriesById = patchedEntriesById;
	}

	get size(): number {
		let size = this.base.size;
		for (const key of this.patchedEntriesById.keys()) {
			if (!this.base.has(key)) {
				size += 1;
			}
		}
		return size;
	}

	get(key: string): AgentPanelSceneEntryModel | undefined {
		return this.patchedEntriesById.get(key) ?? this.base.get(key);
	}

	has(key: string): boolean {
		return this.patchedEntriesById.has(key) || this.base.has(key);
	}

	forEach(
		callbackfn: (
			value: AgentPanelSceneEntryModel,
			key: string,
			map: ReadonlyMap<string, AgentPanelSceneEntryModel>
		) => void,
		thisArg?: unknown
	): void {
		for (const [key, value] of this.entries()) {
			callbackfn.call(thisArg, value, key, this);
		}
	}

	private *entryIterator(): IterableIterator<[string, AgentPanelSceneEntryModel]> {
		const yieldedPatchKeys = new Set<string>();
		for (const [key, value] of this.base.entries()) {
			const patchedEntry = this.patchedEntriesById.get(key);
			if (patchedEntry !== undefined) {
				yield [key, patchedEntry];
				yieldedPatchKeys.add(key);
				continue;
			}
			yield [key, value];
		}
		for (const [key, value] of this.patchedEntriesById.entries()) {
			if (!yieldedPatchKeys.has(key)) {
				yield [key, value];
			}
		}
	}

	entries(): MapIterator<[string, AgentPanelSceneEntryModel]> {
		return this.entryIterator() as unknown as MapIterator<
			[string, AgentPanelSceneEntryModel]
		>;
	}

	private *keyIterator(): IterableIterator<string> {
		for (const [key] of this.entries()) {
			yield key;
		}
	}

	keys(): MapIterator<string> {
		return this.keyIterator() as unknown as MapIterator<string>;
	}

	private *valueIterator(): IterableIterator<AgentPanelSceneEntryModel> {
		for (const [, value] of this.entries()) {
			yield value;
		}
	}

	values(): MapIterator<AgentPanelSceneEntryModel> {
		return this.valueIterator() as unknown as MapIterator<AgentPanelSceneEntryModel>;
	}

	[Symbol.iterator](): MapIterator<[string, AgentPanelSceneEntryModel]> {
		return this.entries();
	}
}

class AppendedSceneEntryMap implements ReadonlyMap<string, AgentPanelSceneEntryModel> {
	readonly [Symbol.toStringTag] = "AppendedSceneEntryMap";
	private readonly appendedEntriesById: ReadonlyMap<string, AgentPanelSceneEntryModel>;

	constructor(
		private readonly base: ReadonlyMap<string, AgentPanelSceneEntryModel>,
		appendedEntries: readonly AgentPanelSceneEntryModel[]
	) {
		const appendedEntriesById = new Map<string, AgentPanelSceneEntryModel>();
		for (const entry of appendedEntries) {
			appendedEntriesById.set(entry.id, entry);
		}
		this.appendedEntriesById = appendedEntriesById;
	}

	get size(): number {
		let size = this.base.size;
		for (const key of this.appendedEntriesById.keys()) {
			if (!this.base.has(key)) {
				size += 1;
			}
		}
		return size;
	}

	get(key: string): AgentPanelSceneEntryModel | undefined {
		return this.appendedEntriesById.get(key) ?? this.base.get(key);
	}

	has(key: string): boolean {
		return this.appendedEntriesById.has(key) || this.base.has(key);
	}

	forEach(
		callbackfn: (
			value: AgentPanelSceneEntryModel,
			key: string,
			map: ReadonlyMap<string, AgentPanelSceneEntryModel>
		) => void,
		thisArg?: unknown
	): void {
		for (const [key, value] of this.entries()) {
			callbackfn.call(thisArg, value, key, this);
		}
	}

	private *entryIterator(): IterableIterator<[string, AgentPanelSceneEntryModel]> {
		for (const [key, value] of this.base.entries()) {
			if (!this.appendedEntriesById.has(key)) {
				yield [key, value];
			}
		}
		for (const [key, value] of this.appendedEntriesById.entries()) {
			yield [key, value];
		}
	}

	entries(): MapIterator<[string, AgentPanelSceneEntryModel]> {
		return this.entryIterator() as unknown as MapIterator<
			[string, AgentPanelSceneEntryModel]
		>;
	}

	private *keyIterator(): IterableIterator<string> {
		for (const [key] of this.entries()) {
			yield key;
		}
	}

	keys(): MapIterator<string> {
		return this.keyIterator() as unknown as MapIterator<string>;
	}

	private *valueIterator(): IterableIterator<AgentPanelSceneEntryModel> {
		for (const [, value] of this.entries()) {
			yield value;
		}
	}

	values(): MapIterator<AgentPanelSceneEntryModel> {
		return this.valueIterator() as unknown as MapIterator<AgentPanelSceneEntryModel>;
	}

	[Symbol.iterator](): MapIterator<[string, AgentPanelSceneEntryModel]> {
		return this.entries();
	}
}

function appendGraphSceneEntriesToIndex(
	entriesById: Map<string, AgentPanelSceneEntryModel>,
	sceneEntries: readonly AgentPanelSceneEntryModel[]
): void {
	appendGraphSceneEntriesToIndexes(entriesById, undefined, sceneEntries, 0);
}

function appendGraphSceneEntriesToIndexes(
	entriesById: Map<string, AgentPanelSceneEntryModel>,
	entryIndexesById: Map<string, number> | undefined,
	sceneEntries: readonly AgentPanelSceneEntryModel[],
	startIndex: number,
	entryIndexStart: number = 0
): void {
	let index = startIndex;
	for (
		let sceneEntryIndex = entryIndexStart;
		sceneEntryIndex < sceneEntries.length;
		sceneEntryIndex += 1
	) {
		const sceneEntry = sceneEntries[sceneEntryIndex];
		if (sceneEntry === undefined) {
			continue;
		}
		if (!entriesById.has(sceneEntry.id)) {
			entriesById.set(sceneEntry.id, sceneEntry);
			entryIndexesById?.set(sceneEntry.id, index);
		}
		index += 1;
	}
}

function appendGraphSceneEntryIndexes(
	entryIndexesById: Map<string, number>,
	sceneEntries: readonly AgentPanelSceneEntryModel[],
	startIndex: number
): void {
	for (let sceneEntryIndex = 0; sceneEntryIndex < sceneEntries.length; sceneEntryIndex += 1) {
		const sceneEntry = sceneEntries[sceneEntryIndex];
		if (sceneEntry !== undefined && !entryIndexesById.has(sceneEntry.id)) {
			entryIndexesById.set(sceneEntry.id, startIndex + sceneEntryIndex);
		}
	}
}

function areJsonLikeValuesEquivalent(left: unknown, right: unknown): boolean {
	if (Object.is(left, right)) {
		return true;
	}
	if (typeof left !== typeof right) {
		return false;
	}
	if (left === null || right === null) {
		return false;
	}
	if (typeof left !== "object" || typeof right !== "object") {
		return false;
	}
	if (Array.isArray(left) || Array.isArray(right)) {
		if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
			return false;
		}
		return left.every((item, index) => areJsonLikeValuesEquivalent(item, right[index]));
	}

	const leftEntries = Object.entries(left);
	const rightRecord = right as Record<string, unknown>;
	if (leftEntries.length !== Object.keys(rightRecord).length) {
		return false;
	}
	return leftEntries.every(([key, value]) =>
		areJsonLikeValuesEquivalent(value, rightRecord[key])
	);
}
