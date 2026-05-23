import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel";

import {
	findStableSceneEntryInsertion,
	isStableSceneEntryAppend,
	isStableSceneEntryTruncation,
} from "./scene-entry-stability.js";
import type { SceneDisplayRow } from "./scene-display-rows.js";
import { getSceneDisplayRowKey } from "./scene-display-rows.js";
import { createAppendedSceneEntriesArray } from "./scene-entry-array-view.js";
import { getAgentPanelDisplayScenePatch } from "./agent-panel-display-model.js";
import { getTokenRevealScenePatch } from "./token-reveal-scene-read-model.js";
import {
	getAgentPanelSceneEntryArrayAppendPatch,
	getAgentPanelSceneEntryArrayPatch,
	getAgentPanelSceneEntryArraySplicePatch,
	getAgentPanelSceneEntryArrayTruncation,
} from "../../../session-state/agent-panel-scene-entry-array-patch.js";

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
	applySnapshot(
		sceneEntries: readonly AgentPanelSceneEntryModel[]
	): ReadonlyMap<string, AgentPanelSceneEntryModel>;
	applyAppendPatch(
		appendedSceneEntries: readonly AgentPanelSceneEntryModel[]
	): ReadonlyMap<string, AgentPanelSceneEntryModel>;
	applyPatch(
		sceneEntries: readonly AgentPanelSceneEntryModel[]
	): ReadonlyMap<string, AgentPanelSceneEntryModel> | null;
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
		sceneEntries: readonly AgentPanelSceneEntryModel[]
	): ReadonlyMap<string, AgentPanelSceneEntryModel> | null {
		const graphScenePatch = getAgentPanelSceneEntryArrayPatch(sceneEntries);
		if (
			graphScenePatch === undefined ||
			graphScenePatch.baseSceneEntries !== previousSceneEntries
		) {
			return null;
		}
		baseEntriesByIdBeforeTokenReveal = null;
		const patchedEntriesById = patchSameLengthGraphSceneEntrySet(
			entriesById,
			entryIndexesById,
			graphScenePatch.entriesByIndex
		);
		if (patchedEntriesById === null) {
			return null;
		}
		entriesById = patchedEntriesById;
		previousSceneEntries = sceneEntries;
		return entriesById;
	}

	function applyGraphSceneAppendPatch(
		sceneEntries: readonly AgentPanelSceneEntryModel[]
	): ReadonlyMap<string, AgentPanelSceneEntryModel> | null {
		const appendPatch = getAgentPanelSceneEntryArrayAppendPatch(sceneEntries);
		if (
			appendPatch === undefined ||
			appendPatch.baseSceneEntries !== previousSceneEntries
		) {
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
		sceneEntries: readonly AgentPanelSceneEntryModel[]
	): ReadonlyMap<string, AgentPanelSceneEntryModel> | null {
		const truncation = getAgentPanelSceneEntryArrayTruncation(sceneEntries);
		if (
			truncation === undefined ||
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
		sceneEntries: readonly AgentPanelSceneEntryModel[]
	): ReadonlyMap<string, AgentPanelSceneEntryModel> | null {
		const splicePatch = getAgentPanelSceneEntryArraySplicePatch(sceneEntries);
		if (
			splicePatch === undefined ||
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
		sceneEntries: readonly AgentPanelSceneEntryModel[]
	): ReadonlyMap<string, AgentPanelSceneEntryModel> | null {
		const displayScenePatch = getAgentPanelDisplayScenePatch(sceneEntries);
		if (
			displayScenePatch === undefined ||
			displayScenePatch.baseSceneEntries !== previousSceneEntries
		) {
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
		sceneEntries: readonly AgentPanelSceneEntryModel[]
	): ReadonlyMap<string, AgentPanelSceneEntryModel> | null {
		const tokenRevealPatch = getTokenRevealScenePatch(sceneEntries);
		if (
			tokenRevealPatch === undefined ||
			tokenRevealPatch.baseSceneEntries !== previousSceneEntries
		) {
			return null;
		}
		baseEntriesByIdBeforeTokenReveal ??= entriesById;
		entriesById = new PatchedSceneEntryMap(
			baseEntriesByIdBeforeTokenReveal,
			[tokenRevealPatch.entry]
		);
		return entriesById;
	}

	return {
		applySnapshot(sceneEntries) {
			const patchedIndex = applyGraphScenePatch(sceneEntries);
			if (patchedIndex !== null) {
				return patchedIndex;
			}

			const displaySceneIndex = applyDisplayScenePatch(sceneEntries);
			if (displaySceneIndex !== null) {
				return displaySceneIndex;
			}

			const tokenRevealIndex = applyTokenRevealPatch(sceneEntries);
			if (tokenRevealIndex !== null) {
				return tokenRevealIndex;
			}

			if (sceneEntries === previousSceneEntries) {
				if (baseEntriesByIdBeforeTokenReveal !== null) {
					entriesById = baseEntriesByIdBeforeTokenReveal;
					baseEntriesByIdBeforeTokenReveal = null;
				}
				return entriesById;
			}

			baseEntriesByIdBeforeTokenReveal = null;
			const truncatedIndex = applyGraphSceneTruncation(sceneEntries);
			if (truncatedIndex !== null) {
				return truncatedIndex;
			}

			const splicedIndex = applyGraphSceneSplice(sceneEntries);
			if (splicedIndex !== null) {
				return splicedIndex;
			}

			if (
				previousSceneEntries !== null &&
				isStableSceneEntryAppend(previousSceneEntries, sceneEntries)
			) {
				const mutableEntriesById = ensureMutableSceneEntryMap(entriesById);
				entriesById = mutableEntriesById;
				appendGraphSceneEntriesToIndexes(
					mutableEntriesById,
					entryIndexesById,
					sceneEntries,
					previousSceneEntries.length,
					previousSceneEntries.length
				);
				previousSceneEntries = sceneEntries;
				return entriesById;
			}

			if (
				previousSceneEntries !== null &&
				isStableSceneEntryTruncation(previousSceneEntries, sceneEntries)
			) {
				const mutableEntriesById = ensureMutableSceneEntryMap(entriesById);
				entriesById = mutableEntriesById;
				removeTruncatedGraphSceneEntries(
					mutableEntriesById,
					entryIndexesById,
					previousSceneEntries,
					sceneEntries.length
				);
				previousSceneEntries = sceneEntries;
				return entriesById;
			}

			if (
				previousSceneEntries !== null &&
				previousSceneEntries.length === sceneEntries.length
			) {
				const mutableEntriesById = patchSameLengthGraphSceneEntries(
					entriesById,
					previousSceneEntries,
					sceneEntries
				);
				if (mutableEntriesById !== null) {
					entriesById = mutableEntriesById;
					previousSceneEntries = sceneEntries;
					return entriesById;
				}
			}

			if (previousSceneEntries !== null) {
				const insertion = findStableSceneEntryInsertion(previousSceneEntries, sceneEntries);
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
			}

			const nextEntriesById = new Map<string, AgentPanelSceneEntryModel>();
			entriesById = nextEntriesById;
			entryIndexesById = new Map();
			appendGraphSceneEntriesToIndexes(nextEntriesById, entryIndexesById, sceneEntries, 0);
			previousSceneEntries = sceneEntries;
			return entriesById;
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
		applyPatch(sceneEntries) {
			return (
				applyGraphScenePatch(sceneEntries) ??
				applyGraphSceneAppendPatch(sceneEntries) ??
				applyGraphSceneTruncation(sceneEntries) ??
				applyGraphSceneSplice(sceneEntries) ??
				applyDisplayScenePatch(sceneEntries) ??
				applyTokenRevealPatch(sceneEntries)
			);
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
}

function patchSameLengthGraphSceneEntrySet(
	entriesById: ReadonlyMap<string, AgentPanelSceneEntryModel>,
	entryIndexesById: ReadonlyMap<string, number>,
	patchedEntriesByIndex: ReadonlyMap<number, AgentPanelSceneEntryModel>
): ReadonlyMap<string, AgentPanelSceneEntryModel> | null {
	let mutableEntriesById: Map<string, AgentPanelSceneEntryModel> | null = null;
	for (const [entryIndex, patchedEntry] of patchedEntriesByIndex) {
		if (
			!entriesById.has(patchedEntry.id) ||
			entryIndexesById.get(patchedEntry.id) !== entryIndex
		) {
			return null;
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
