import type { AgentPanelSceneEntryModel, TokenRevealCss } from "@acepe/ui/agent-panel";
import type { TokenRevealTiming } from "../../messages/token-reveal-motion.js";
import {
	createAppendedSceneEntriesArray,
	createPatchedSceneEntriesArray,
} from "./scene-entry-array-view.js";
import {
	isSceneEntryStable,
	isStableSceneEntryAppend,
	isStableSceneEntryTruncation,
} from "./scene-entry-stability.js";
import {
	scenePatchGraphScene,
	scenePatchGraphSceneAppend,
	scenePatchGraphSceneSplice,
	scenePatchGraphSceneTruncation,
	scenePatchIdentity,
	scenePatchTokenReveal,
	type AgentPanelSceneEntryArrayAppendPatch,
	type AgentPanelSceneEntryArrayPatch,
	type AgentPanelSceneEntryArraySplicePatch,
	type AgentPanelSceneEntryArrayTruncation,
	type RevealScenePatchPayload,
	type ScenePatch,
} from "./scene-patch.js";

export type TokenRevealSceneSnapshot = {
	readonly sceneEntries: readonly AgentPanelSceneEntryModel[];
	readonly scenePatch: ScenePatch;
	readonly sourceEntry: AgentPanelSceneEntryModel | undefined;
	readonly tailRowId: string | null;
	readonly tailRowIndex?: number | undefined;
	readonly tokenRevealCss: TokenRevealCss | undefined;
};

export type TokenRevealSceneResult = {
	readonly entries: readonly AgentPanelSceneEntryModel[];
	readonly scenePatch: ScenePatch;
};

export interface TokenRevealSceneReadModel {
	applyPatch(snapshot: TokenRevealSceneSnapshot): TokenRevealSceneResult | null;
	applySnapshot(snapshot: TokenRevealSceneSnapshot): TokenRevealSceneResult;
	selectEntries(): readonly AgentPanelSceneEntryModel[];
	selectSettlingTimings(): readonly TokenRevealTiming[];
}

export type TokenRevealScenePatch = {
	readonly baseSceneEntries: readonly AgentPanelSceneEntryModel[];
	readonly entries: readonly AgentPanelSceneEntryModel[];
	readonly entriesByIndex: ReadonlyMap<number, AgentPanelSceneEntryModel>;
};

function tokenRevealResult(
	entries: readonly AgentPanelSceneEntryModel[],
	scenePatch: ScenePatch
): TokenRevealSceneResult {
	return { entries, scenePatch };
}

function readGraphSceneAppendPatch(
	scenePatch: ScenePatch
): AgentPanelSceneEntryArrayAppendPatch | null {
	return scenePatch.kind === "graphSceneAppend" ? scenePatch.patch : null;
}

function readGraphScenePatch(scenePatch: ScenePatch): AgentPanelSceneEntryArrayPatch | null {
	return scenePatch.kind === "graphScene" ? scenePatch.patch : null;
}

function readDisplayScenePatch(scenePatch: ScenePatch): RevealScenePatchPayload | null {
	return scenePatch.kind === "displayScene" ? scenePatch.patch : null;
}

function readGraphSceneTruncation(
	scenePatch: ScenePatch
): AgentPanelSceneEntryArrayTruncation | null {
	return scenePatch.kind === "graphSceneTruncation" ? scenePatch.patch : null;
}

function readGraphSceneSplicePatch(
	scenePatch: ScenePatch
): AgentPanelSceneEntryArraySplicePatch | null {
	return scenePatch.kind === "graphSceneSplice" ? scenePatch.patch : null;
}

export function createTokenRevealSceneReadModel(): TokenRevealSceneReadModel {
	let previousSnapshot: TokenRevealSceneSnapshot | null = null;
	let previousResult: TokenRevealSceneResult = tokenRevealResult([], scenePatchIdentity());
	let previousTimings: readonly TokenRevealTiming[] = [];
	let previousTokenRevealEntryIndex = -1;

	return {
		applyPatch(snapshot) {
			if (isSameTokenRevealSnapshot(previousSnapshot, snapshot)) {
				return previousResult;
			}
			const previous = previousSnapshot;
			if (previous === null) {
				return null;
			}

			const revealStateUnchanged =
				previous.sourceEntry === snapshot.sourceEntry &&
				previous.tailRowId === snapshot.tailRowId &&
				previous.tailRowIndex === snapshot.tailRowIndex &&
				previous.tokenRevealCss === snapshot.tokenRevealCss;
			if (!revealStateUnchanged) {
				return null;
			}
			if (hasSameStableSceneEntries(previous.sceneEntries, snapshot.sceneEntries)) {
				previousSnapshot = snapshot;
				return previousResult;
			}

			const appendPatch = readGraphSceneAppendPatch(snapshot.scenePatch);
			if (
				appendPatch?.baseSceneEntries === previous.sceneEntries &&
				previousTokenRevealEntryIndex === -1
			) {
				previousSnapshot = snapshot;
				previousResult = tokenRevealResult(snapshot.sceneEntries, snapshot.scenePatch);
				return previousResult;
			}
			if (
				appendPatch?.baseSceneEntries === previous.sceneEntries &&
				previousTokenRevealEntryIndex !== -1
			) {
				const nextEntries = createAppendedSceneEntriesArray(
					previousResult.entries,
					appendPatch.appendedEntries
				);
				previousSnapshot = snapshot;
				previousResult = tokenRevealResult(
					nextEntries,
					scenePatchGraphSceneAppend({
						baseSceneEntries: previousResult.entries,
						appendedEntries: appendPatch.appendedEntries,
					})
				);
				return previousResult;
			}
			if (
				appendPatch === null &&
				isStableSceneEntryAppend(previous.sceneEntries, snapshot.sceneEntries)
			) {
				if (previousTokenRevealEntryIndex === -1) {
					previousSnapshot = snapshot;
					previousResult = tokenRevealResult(snapshot.sceneEntries, snapshot.scenePatch);
					return previousResult;
				}
				const appendedEntries = snapshot.sceneEntries.slice(previous.sceneEntries.length);
				const nextEntries = createAppendedSceneEntriesArray(
					previousResult.entries,
					appendedEntries
				);
				previousSnapshot = snapshot;
				previousResult = tokenRevealResult(
					nextEntries,
					scenePatchGraphSceneAppend({
						baseSceneEntries: previousResult.entries,
						appendedEntries,
					})
				);
				return previousResult;
			}

			const graphPatch = readGraphScenePatch(snapshot.scenePatch);
			if (graphPatch?.baseSceneEntries === previous.sceneEntries) {
				if (previousTokenRevealEntryIndex === -1) {
					previousSnapshot = snapshot;
					previousResult = tokenRevealResult(snapshot.sceneEntries, snapshot.scenePatch);
					return previousResult;
				}
				if (!graphPatch.entriesByIndex.has(previousTokenRevealEntryIndex)) {
					const nextEntries = createPatchedSceneEntriesArray(
						previousResult.entries,
						graphPatch.entriesByIndex
					);
					previousSnapshot = snapshot;
					previousResult = tokenRevealResult(
						nextEntries,
						scenePatchGraphScene({
							baseSceneEntries: previousResult.entries,
							entries: graphPatch.entries,
							entriesByIndex: graphPatch.entriesByIndex,
						})
					);
					return previousResult;
				}
			}

			const displayPatch = readDisplayScenePatch(snapshot.scenePatch);
			if (displayPatch?.baseSceneEntries === previous.sceneEntries) {
				if (previousTokenRevealEntryIndex === -1) {
					previousSnapshot = snapshot;
					previousResult = tokenRevealResult(snapshot.sceneEntries, snapshot.scenePatch);
					return previousResult;
				}
				if (!displayPatch.entriesByIndex.has(previousTokenRevealEntryIndex)) {
					const nextEntries = createPatchedSceneEntriesArray(
						previousResult.entries,
						displayPatch.entriesByIndex
					);
					previousSnapshot = snapshot;
					previousResult = tokenRevealResult(
						nextEntries,
						scenePatchGraphScene({
							baseSceneEntries: previousResult.entries,
							entries: displayPatch.entries,
							entriesByIndex: displayPatch.entriesByIndex,
						})
					);
					return previousResult;
				}
			}

			const truncation = readGraphSceneTruncation(snapshot.scenePatch);
			if (truncation?.baseSceneEntries === previous.sceneEntries) {
				if (previousTokenRevealEntryIndex === -1) {
					previousSnapshot = snapshot;
					previousResult = tokenRevealResult(snapshot.sceneEntries, snapshot.scenePatch);
					return previousResult;
				}
				if (previousTokenRevealEntryIndex < truncation.length) {
					const nextEntries = createTruncatedSceneEntriesArray(
						previousResult.entries,
						truncation.length
					);
					previousSnapshot = snapshot;
					previousResult = tokenRevealResult(
						nextEntries,
						scenePatchGraphSceneTruncation({
							baseSceneEntries: previousResult.entries,
							length: truncation.length,
						})
					);
					return previousResult;
				}
			}
			if (
				truncation === null &&
				isStableSceneEntryTruncation(previous.sceneEntries, snapshot.sceneEntries)
			) {
				if (previousTokenRevealEntryIndex === -1) {
					previousSnapshot = snapshot;
					previousResult = tokenRevealResult(snapshot.sceneEntries, snapshot.scenePatch);
					return previousResult;
				}
				if (previousTokenRevealEntryIndex < snapshot.sceneEntries.length) {
					const nextEntries = createTruncatedSceneEntriesArray(
						previousResult.entries,
						snapshot.sceneEntries.length
					);
					previousSnapshot = snapshot;
					previousResult = tokenRevealResult(
						nextEntries,
						scenePatchGraphSceneTruncation({
							baseSceneEntries: previousResult.entries,
							length: snapshot.sceneEntries.length,
						})
					);
					return previousResult;
				}
			}

			const splicePatch = readGraphSceneSplicePatch(snapshot.scenePatch);
			if (splicePatch?.baseSceneEntries === previous.sceneEntries) {
				if (previousTokenRevealEntryIndex === -1) {
					previousSnapshot = snapshot;
					previousResult = tokenRevealResult(snapshot.sceneEntries, snapshot.scenePatch);
					return previousResult;
				}
				if (previousTokenRevealEntryIndex < splicePatch.startIndex) {
					const replacementEntries = snapshot.sceneEntries.slice(splicePatch.startIndex);
					const nextEntries = createSplicedSceneEntriesArray(
						previousResult.entries,
						splicePatch.startIndex,
						replacementEntries
					);
					previousSnapshot = snapshot;
					previousResult = tokenRevealResult(
						nextEntries,
						scenePatchGraphSceneSplice({
							baseSceneEntries: previousResult.entries,
							startIndex: splicePatch.startIndex,
							insertedEntries: replacementEntries.slice(
								0,
								Math.max(0, replacementEntries.length - splicePatch.trailingEntries.length)
							),
							trailingEntries: splicePatch.trailingEntries,
						})
					);
					return previousResult;
				}
			}

			return null;
		},
		applySnapshot(snapshot) {
			if (isSameTokenRevealSnapshot(previousSnapshot, snapshot)) {
				return previousResult;
			}

			const tokenRevealEntryIndex = resolveTokenRevealEntryIndex(
				snapshot.sceneEntries,
				snapshot.tailRowId,
				snapshot.tokenRevealCss,
				previousTokenRevealEntryIndex,
				snapshot.tailRowIndex
			);
			if (tokenRevealEntryIndex === -1) {
				previousSnapshot = snapshot;
				previousResult = tokenRevealResult(snapshot.sceneEntries, snapshot.scenePatch);
				previousTimings = [];
				previousTokenRevealEntryIndex = -1;
				return previousResult;
			}

			const tokenRevealEntry = copyAssistantSceneEntryWithTokenReveal(
				snapshot.sceneEntries[tokenRevealEntryIndex],
				snapshot.sourceEntry,
				snapshot.tokenRevealCss
			);
			const patchedEntriesByIndex = new Map<number, AgentPanelSceneEntryModel>([
				[tokenRevealEntryIndex, tokenRevealEntry],
			]);
			const previousTailRowId =
				previousSnapshot?.tokenRevealCss === undefined ? null : (previousSnapshot?.tailRowId ?? null);
			if (previousTailRowId !== null && previousTailRowId !== snapshot.tailRowId) {
				const previousEntryIndex = resolvePreviousRevealEntryIndex(
					snapshot.sceneEntries,
					previousTailRowId,
					previousTokenRevealEntryIndex
				);
				const previousEntry = snapshot.sceneEntries[previousEntryIndex];
				if (previousEntry !== undefined) {
					patchedEntriesByIndex.set(previousEntryIndex, previousEntry);
				}
			}
			const nextEntries = createPatchedSceneEntryArray(snapshot.sceneEntries, patchedEntriesByIndex);
			const tokenRevealPatch = scenePatchTokenReveal({
				baseSceneEntries: snapshot.sceneEntries,
				entries: Array.from(patchedEntriesByIndex.values()),
				entriesByIndex: patchedEntriesByIndex,
			});

			previousSnapshot = snapshot;
			previousResult = tokenRevealResult(nextEntries, tokenRevealPatch);
			previousTimings = collectTokenRevealTiming(tokenRevealEntry);
			previousTokenRevealEntryIndex = tokenRevealEntryIndex;
			return previousResult;
		},
		selectEntries() {
			return previousResult.entries;
		},
		selectSettlingTimings() {
			return previousTimings;
		},
	};
}

function hasSameStableSceneEntries(
	previous: readonly AgentPanelSceneEntryModel[],
	next: readonly AgentPanelSceneEntryModel[]
): boolean {
	if (previous.length !== next.length) {
		return false;
	}

	for (let index = 0; index < previous.length; index += 1) {
		if (!isSceneEntryStable(previous[index], next[index])) {
			return false;
		}
	}

	return true;
}

function createTruncatedSceneEntriesArray(
	baseEntries: readonly AgentPanelSceneEntryModel[],
	length: number
): readonly AgentPanelSceneEntryModel[] {
	if (length >= baseEntries.length) {
		return baseEntries;
	}

	const target = new Array<AgentPanelSceneEntryModel>(length);
	return new Proxy(target, {
		get(targetArray, property, receiver) {
			if (property === Symbol.iterator) {
				return function* () {
					for (let index = 0; index < targetArray.length; index += 1) {
						yield baseEntries[index];
					}
				};
			}
			if (typeof property === "string") {
				const index = toArrayIndex(property);
				if (index !== null) {
					return index < targetArray.length ? baseEntries[index] : undefined;
				}
				if (property === "slice") {
					return (start?: number, end?: number) =>
						Array.prototype.slice.call(receiver, start, end);
				}
				if (property === "at") {
					return (index: number) => {
						const resolvedIndex = index < 0 ? targetArray.length + index : index;
						if (resolvedIndex < 0 || resolvedIndex >= targetArray.length) {
							return undefined;
						}
						return baseEntries[resolvedIndex];
					};
				}
			}
			if (property === "length") {
				return targetArray.length;
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
		ownKeys() {
			return Reflect.ownKeys(target);
		},
		getOwnPropertyDescriptor(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null && index >= 0 && index < targetArray.length) {
				return {
					configurable: true,
					enumerable: true,
					value: baseEntries[index],
					writable: false,
				};
			}
			return (
				Reflect.getOwnPropertyDescriptor(targetArray, property) ??
				Reflect.getOwnPropertyDescriptor(baseEntries, property)
			);
		},
	});
}

function createSplicedSceneEntriesArray(
	baseEntries: readonly AgentPanelSceneEntryModel[],
	startIndex: number,
	replacementEntries: readonly AgentPanelSceneEntryModel[]
): readonly AgentPanelSceneEntryModel[] {
	const target = new Array<AgentPanelSceneEntryModel>(startIndex + replacementEntries.length);
	return new Proxy(target, {
		get(targetArray, property, receiver) {
			if (property === Symbol.iterator) {
				return function* () {
					for (let index = 0; index < targetArray.length; index += 1) {
						yield index < startIndex ? baseEntries[index] : replacementEntries[index - startIndex];
					}
				};
			}
			if (typeof property === "string") {
				const index = toArrayIndex(property);
				if (index !== null) {
					return index < startIndex ? baseEntries[index] : replacementEntries[index - startIndex];
				}
				if (property === "slice") {
					return (start?: number, end?: number) =>
						Array.prototype.slice.call(receiver, start, end);
				}
				if (property === "at") {
					return (index: number) => {
						const resolvedIndex = index < 0 ? targetArray.length + index : index;
						if (resolvedIndex < 0 || resolvedIndex >= targetArray.length) {
							return undefined;
						}
						return resolvedIndex < startIndex
							? baseEntries[resolvedIndex]
							: replacementEntries[resolvedIndex - startIndex];
					};
				}
			}
			if (property === "length") {
				return targetArray.length;
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
		ownKeys() {
			return Reflect.ownKeys(target);
		},
		getOwnPropertyDescriptor(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null && index >= 0 && index < targetArray.length) {
				return {
					configurable: true,
					enumerable: true,
					value:
						index < startIndex ? baseEntries[index] : replacementEntries[index - startIndex],
					writable: false,
				};
			}
			return (
				Reflect.getOwnPropertyDescriptor(targetArray, property) ??
				Reflect.getOwnPropertyDescriptor(baseEntries, property)
			);
		},
	});
}

function createPatchedSceneEntryArray(
	baseEntries: readonly AgentPanelSceneEntryModel[],
	patchedEntriesByIndex: ReadonlyMap<number, AgentPanelSceneEntryModel>
): readonly AgentPanelSceneEntryModel[] {
	const target = new Array<AgentPanelSceneEntryModel>(baseEntries.length);
	return new Proxy(target, {
		get(targetArray, property, receiver) {
			if (property === Symbol.iterator) {
				return function* () {
					for (let index = 0; index < baseEntries.length; index += 1) {
						yield patchedEntriesByIndex.get(index) ?? baseEntries[index];
					}
				};
			}
			if (typeof property === "string") {
				const index = toArrayIndex(property);
				if (index !== null) {
					return patchedEntriesByIndex.get(index) ?? baseEntries[index];
				}
				if (property === "slice") {
					return (start?: number, end?: number) =>
						Array.prototype.slice.call(receiver, start, end);
				}
				if (property === "at") {
					return (index: number) => {
						const resolvedIndex = index < 0 ? baseEntries.length + index : index;
						if (resolvedIndex < 0 || resolvedIndex >= baseEntries.length) {
							return undefined;
						}
						return patchedEntriesByIndex.get(resolvedIndex) ?? baseEntries[resolvedIndex];
					};
				}
			}
			if (property === "length") {
				return baseEntries.length;
			}
			const value = Reflect.get(targetArray, property, receiver);
			return typeof value === "function" ? value.bind(receiver) : value;
		},
		has(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null) {
				return index >= 0 && index < baseEntries.length;
			}
			return property in targetArray;
		},
		ownKeys() {
			return Reflect.ownKeys(baseEntries);
		},
		getOwnPropertyDescriptor(targetArray, property) {
			const index = typeof property === "string" ? toArrayIndex(property) : null;
			if (index !== null && index >= 0 && index < baseEntries.length) {
				return {
					configurable: true,
					enumerable: true,
					value: patchedEntriesByIndex.get(index) ?? baseEntries[index],
					writable: false,
				};
			}
			return (
				Reflect.getOwnPropertyDescriptor(baseEntries, property) ??
				Reflect.getOwnPropertyDescriptor(targetArray, property)
			);
		},
	});
}

function resolvePreviousRevealEntryIndex(
	sceneEntries: readonly AgentPanelSceneEntryModel[],
	previousTailRowId: string,
	previousIndex: number
): number {
	const previousEntry = sceneEntries[previousIndex];
	if (previousEntry?.type === "assistant" && previousEntry.id === previousTailRowId) {
		return previousIndex;
	}

	for (let index = sceneEntries.length - 1; index >= 0; index -= 1) {
		const entry = sceneEntries[index];
		if (entry?.type === "assistant" && entry.id === previousTailRowId) {
			return index;
		}
	}

	return -1;
}

function toArrayIndex(property: string): number | null {
	if (property === "") {
		return null;
	}
	const index = Number(property);
	return Number.isInteger(index) && index >= 0 && String(index) === property ? index : null;
}

function isSameTokenRevealSnapshot(
	previous: TokenRevealSceneSnapshot | null,
	next: TokenRevealSceneSnapshot
): boolean {
	return (
		previous !== null &&
		previous.sceneEntries === next.sceneEntries &&
		previous.sourceEntry === next.sourceEntry &&
		previous.tailRowId === next.tailRowId &&
		previous.tailRowIndex === next.tailRowIndex &&
		previous.tokenRevealCss === next.tokenRevealCss
	);
}

function resolveTokenRevealEntryIndex(
	sceneEntries: readonly AgentPanelSceneEntryModel[],
	tailRowId: string | null,
	tokenRevealCss: TokenRevealCss | undefined,
	previousIndex: number,
	tailRowIndex: number | undefined
): number {
	if (tailRowId === null || tokenRevealCss === undefined) {
		return -1;
	}

	const indexedEntry = sceneEntries[tailRowIndex ?? -1];
	if (indexedEntry?.type === "assistant" && indexedEntry.id === tailRowId) {
		return tailRowIndex ?? -1;
	}

	const previousEntry = sceneEntries[previousIndex];
	if (previousEntry?.type === "assistant" && previousEntry.id === tailRowId) {
		return previousIndex;
	}

	return findTokenRevealEntryIndex(sceneEntries, tailRowId, tokenRevealCss);
}

function findTokenRevealEntryIndex(
	sceneEntries: readonly AgentPanelSceneEntryModel[],
	tailRowId: string | null,
	tokenRevealCss: TokenRevealCss | undefined
): number {
	if (tailRowId === null || tokenRevealCss === undefined) {
		return -1;
	}

	for (let index = sceneEntries.length - 1; index >= 0; index -= 1) {
		const entry = sceneEntries[index];
		if (entry?.type === "assistant" && entry.id === tailRowId) {
			return index;
		}
	}

	return -1;
}

function copyAssistantSceneEntryWithTokenReveal(
	entry: AgentPanelSceneEntryModel | undefined,
	sourceEntry: AgentPanelSceneEntryModel | undefined,
	tokenRevealCss: TokenRevealCss | undefined
): AgentPanelSceneEntryModel {
	if (entry?.type !== "assistant") {
		throw new Error("Token reveal can only be applied to assistant scene entries");
	}

	const sourceAssistantEntry = sourceEntry?.type === "assistant" ? sourceEntry : undefined;

	return {
		id: entry.id,
		type: "assistant",
		markdown: sourceAssistantEntry?.markdown ?? entry.markdown,
		message: sourceAssistantEntry?.message ?? entry.message,
		isStreaming: entry.isStreaming,
		tokenRevealCss,
		timestampMs: entry.timestampMs,
	};
}

function collectTokenRevealTiming(
	entry: AgentPanelSceneEntryModel
): readonly TokenRevealTiming[] {
	if (entry.type !== "assistant" || entry.isStreaming === true) {
		return [];
	}

	const tokenRevealCss = entry.tokenRevealCss;
	if (tokenRevealCss === undefined) {
		return [];
	}

	return [
		{
			revealCount: tokenRevealCss.revealCount,
			baselineMs: tokenRevealCss.baselineMs,
			tokStepMs: tokenRevealCss.tokStepMs,
			tokFadeDurMs: tokenRevealCss.tokFadeDurMs,
			mode: tokenRevealCss.mode,
		},
	];
}
