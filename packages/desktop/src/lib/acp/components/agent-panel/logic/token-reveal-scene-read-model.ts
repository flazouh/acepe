import type { AgentPanelSceneEntryModel, TokenRevealCss } from "@acepe/ui/agent-panel";
import type { TokenRevealTiming } from "../../messages/token-reveal-motion.js";

export type TokenRevealSceneSnapshot = {
	readonly sceneEntries: readonly AgentPanelSceneEntryModel[];
	readonly sourceEntry: AgentPanelSceneEntryModel | undefined;
	readonly tailRowId: string | null;
	readonly tailRowIndex?: number | undefined;
	readonly tokenRevealCss: TokenRevealCss | undefined;
};

export interface TokenRevealSceneReadModel {
	applySnapshot(snapshot: TokenRevealSceneSnapshot): readonly AgentPanelSceneEntryModel[];
	selectEntries(): readonly AgentPanelSceneEntryModel[];
	selectSettlingTimings(): readonly TokenRevealTiming[];
}

export type TokenRevealScenePatch = {
	readonly baseSceneEntries: readonly AgentPanelSceneEntryModel[];
	readonly entry: AgentPanelSceneEntryModel;
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
			const nextEntries = createPatchedSceneEntryArray(
				snapshot.sceneEntries,
				tokenRevealEntryIndex,
				tokenRevealEntry
			);
			tokenRevealScenePatches.set(nextEntries, {
				baseSceneEntries: snapshot.sceneEntries,
				entry: tokenRevealEntry,
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
	patchedIndex: number,
	patchedEntry: AgentPanelSceneEntryModel
): readonly AgentPanelSceneEntryModel[] {
	const target = new Array<AgentPanelSceneEntryModel>(baseEntries.length);
	return new Proxy(target, {
		get(targetArray, property, receiver) {
			if (property === Symbol.iterator) {
				return function* () {
					for (let index = 0; index < baseEntries.length; index += 1) {
						yield index === patchedIndex ? patchedEntry : baseEntries[index];
					}
				};
			}
			if (typeof property === "string") {
				const index = toArrayIndex(property);
				if (index !== null) {
					return index === patchedIndex ? patchedEntry : baseEntries[index];
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
						return resolvedIndex === patchedIndex ? patchedEntry : baseEntries[resolvedIndex];
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
					value: index === patchedIndex ? patchedEntry : baseEntries[index],
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
