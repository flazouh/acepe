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
			const nextEntries = snapshot.sceneEntries.slice();
			nextEntries[tokenRevealEntryIndex] = tokenRevealEntry;
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
