import type { AgentPanelSceneEntryModel, TokenRevealCss } from "@acepe/ui/agent-panel";
import type { TokenRevealTiming } from "../../messages/token-reveal-motion.js";
import {
	createAppendedSceneEntriesArray,
	createPatchedSceneEntriesArray,
} from "./scene-entry-array-view.js";
import {
	getAgentPanelSceneEntryArrayAppendPatch,
	getAgentPanelSceneEntryArrayPatch,
	markAgentPanelSceneEntryArrayAppendPatch,
	markAgentPanelSceneEntryArrayPatch,
} from "../../../session-state/agent-panel-scene-entry-array-patch.js";

export type TokenRevealSceneSnapshot = {
	readonly sceneEntries: readonly AgentPanelSceneEntryModel[];
	readonly sourceEntry: AgentPanelSceneEntryModel | undefined;
	readonly tailRowId: string | null;
	readonly tailRowIndex?: number | undefined;
	readonly tokenRevealCss: TokenRevealCss | undefined;
};

export interface TokenRevealSceneReadModel {
	applyPatch(snapshot: TokenRevealSceneSnapshot): readonly AgentPanelSceneEntryModel[] | null;
	applySnapshot(snapshot: TokenRevealSceneSnapshot): readonly AgentPanelSceneEntryModel[];
	selectEntries(): readonly AgentPanelSceneEntryModel[];
	selectSettlingTimings(): readonly TokenRevealTiming[];
}

export type TokenRevealScenePatch = {
	readonly baseSceneEntries: readonly AgentPanelSceneEntryModel[];
	readonly entries: readonly AgentPanelSceneEntryModel[];
	readonly entriesByIndex: ReadonlyMap<number, AgentPanelSceneEntryModel>;
};

const tokenRevealScenePatches = new WeakMap<
	readonly AgentPanelSceneEntryModel[],
	TokenRevealScenePatch
>();

export function getTokenRevealScenePatch(
	sceneEntries: readonly AgentPanelSceneEntryModel[]
): TokenRevealScenePatch | undefined {
	return tokenRevealScenePatches.get(sceneEntries);
}

export function createTokenRevealSceneReadModel(): TokenRevealSceneReadModel {
	let previousSnapshot: TokenRevealSceneSnapshot | null = null;
	let previousEntries: readonly AgentPanelSceneEntryModel[] = [];
	let previousTimings: readonly TokenRevealTiming[] = [];
	let previousTokenRevealEntryIndex = -1;

	return {
		applyPatch(snapshot) {
			if (isSameTokenRevealSnapshot(previousSnapshot, snapshot)) {
				return previousEntries;
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

			const appendPatch = getAgentPanelSceneEntryArrayAppendPatch(snapshot.sceneEntries);
			if (
				appendPatch?.baseSceneEntries === previous.sceneEntries &&
				previousTokenRevealEntryIndex === -1
			) {
				previousSnapshot = snapshot;
				previousEntries = snapshot.sceneEntries;
				return previousEntries;
			}
			if (
				appendPatch?.baseSceneEntries === previous.sceneEntries &&
				previousTokenRevealEntryIndex !== -1
			) {
				const nextEntries = createAppendedSceneEntriesArray(
					previousEntries,
					appendPatch.appendedEntries
				);
				markAgentPanelSceneEntryArrayAppendPatch(nextEntries, {
					baseSceneEntries: previousEntries,
					appendedEntries: appendPatch.appendedEntries,
				});
				previousSnapshot = snapshot;
				previousEntries = nextEntries;
				return previousEntries;
			}

			const graphPatch = getAgentPanelSceneEntryArrayPatch(snapshot.sceneEntries);
			if (
				graphPatch?.baseSceneEntries === previous.sceneEntries &&
				previousTokenRevealEntryIndex !== -1 &&
				!graphPatch.entriesByIndex.has(previousTokenRevealEntryIndex)
			) {
				const nextEntries = createPatchedSceneEntriesArray(
					previousEntries,
					graphPatch.entriesByIndex
				);
				markAgentPanelSceneEntryArrayPatch(nextEntries, {
					baseSceneEntries: previousEntries,
					entries: graphPatch.entries,
					entriesByIndex: graphPatch.entriesByIndex,
				});
				previousSnapshot = snapshot;
				previousEntries = nextEntries;
				return previousEntries;
			}

			return null;
		},
		applySnapshot(snapshot) {
			if (isSameTokenRevealSnapshot(previousSnapshot, snapshot)) {
				return previousEntries;
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
				previousEntries = snapshot.sceneEntries;
				previousTimings = [];
				previousTokenRevealEntryIndex = -1;
				return previousEntries;
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
			tokenRevealScenePatches.set(nextEntries, {
				baseSceneEntries: snapshot.sceneEntries,
				entries: Array.from(patchedEntriesByIndex.values()),
				entriesByIndex: patchedEntriesByIndex,
			});

			previousSnapshot = snapshot;
			previousEntries = nextEntries;
			previousTimings = collectTokenRevealTiming(tokenRevealEntry);
			previousTokenRevealEntryIndex = tokenRevealEntryIndex;
			return previousEntries;
		},
		selectEntries() {
			return previousEntries;
		},
		selectSettlingTimings() {
			return previousTimings;
		},
	};
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
