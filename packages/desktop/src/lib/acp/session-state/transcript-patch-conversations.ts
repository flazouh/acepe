/**
 * Transcript-patch conversation fast paths for the agent-panel materializer:
 * given a prior CachedConversationState, incrementally re-materialize the
 * conversation when the transcript changed by array-patch / streaming-tail /
 * prefix-patch / append / patch+append / truncation — falling back to a full
 * rebuild when the shape isn't stable. Pure; selected by the dispatcher.
 */
import type { TranscriptEntry } from "../../services/acp-types.js";
import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel/types";
import type {
	CachedConversationInput,
	CachedConversationState,
} from "./conversation-cache-types.js";
import {
	addSceneEntryPatch,
	createAppendedSceneEntryArray,
	createInsertedSceneEntryArray,
	createPatchedSceneEntryArray,
	createTruncatedSceneEntryArray,

	conversationFromSceneEntryArrayResult,} from "./scene-entry-array.js";
import { scenePatchIdentity } from "../components/agent-panel/logic/scene-patch.js";
import {
	createAppendedSceneEntryRowIndex,
	createSplicedSceneEntryRowIndex,
	createTruncatedSceneEntryRowIndex,
} from "./scene-entry-row-index.js";
import { materializeTranscriptEntry } from "./entry-materializers.js";
import {
	createAppendedTranscriptEntryIndex,
	createTruncatedTranscriptEntryIndex,
} from "./interaction-index-patch.js";
import {
	collectAppendedTranscriptEntries,
	collectStableTranscriptPatchedEntriesByIndex,
	isStableTranscriptAppend,
	isStableTranscriptPatchAndAppend,
	isStableTranscriptTruncation,
} from "./conversation-stability.js";
import {
	areActiveStreamingTailsEquivalent,
	areActivitiesCompatibleForConversationPatch,
	areSceneEntriesEquivalent,
} from "./scene-equivalence.js";
import { getTranscriptEntryArrayPatch } from "./transcript-entry-array-patch.js";
import { createPatchedReadonlyMap } from "./patched-readonly-map.js";

export function materializeTranscriptArrayPatchedConversation(
	previous: CachedConversationState | null,
	input: CachedConversationInput
): CachedConversationState | null {
	if (
		previous === null ||
		previous.operations !== input.graph.operations ||
		previous.interactions !== input.graph.interactions ||
		previous.turnState !== input.graph.turnState ||
		!areActiveStreamingTailsEquivalent(
			previous.activeStreamingTail,
			input.graph.activeStreamingTail
		) ||
		!areActivitiesCompatibleForConversationPatch(previous.activity, input.graph.activity)
	) {
		return null;
	}

	const transcriptEntries = input.graph.transcriptSnapshot.entries;
	const transcriptPatch = getTranscriptEntryArrayPatch(transcriptEntries);
	if (
		transcriptPatch === undefined ||
		transcriptPatch.baseEntries !== previous.transcriptEntries ||
		transcriptPatch.appendedEntries !== null ||
		transcriptPatch.patchedEntriesByIndex === null
	) {
		return null;
	}

	let entryPatches: Map<number, AgentPanelSceneEntryModel> | null = null;
	let transcriptEntryPatches: Map<string, TranscriptEntry> | null = null;
	const isRunning = input.graph.turnState === "Running";
	const liveAssistantEntryId = isRunning ? (input.graph.activeStreamingTail?.rowId ?? null) : null;

	for (const [index, nextTranscriptEntry] of transcriptPatch.patchedEntriesByIndex) {
		const previousTranscriptEntry = previous.transcriptEntries[index];
		if (
			previousTranscriptEntry === undefined ||
			previousTranscriptEntry.entryId !== nextTranscriptEntry.entryId
		) {
			return null;
		}

		const rowIndex = previous.sceneEntryRowIndex.get(nextTranscriptEntry.entryId);
		if (rowIndex === undefined) {
			return null;
		}
		const previousSceneEntry = previous.conversation.entries[rowIndex];
		if (previousSceneEntry === undefined) {
			return null;
		}
		const nextSceneEntry = materializeTranscriptEntry(
			nextTranscriptEntry,
			input.graph,
			previous.operationIndex,
			isRunning && nextTranscriptEntry.entryId === liveAssistantEntryId
		);
		transcriptEntryPatches ??= new Map<string, TranscriptEntry>();
		transcriptEntryPatches.set(nextTranscriptEntry.entryId, nextTranscriptEntry);
		if (areSceneEntriesEquivalent(previousSceneEntry, nextSceneEntry)) {
			continue;
		}
		entryPatches = addSceneEntryPatch(entryPatches, rowIndex, nextSceneEntry);
	}

	if (entryPatches === null) {
		return {
			...previous,
			transcriptEntries,
			transcriptEntryById:
				transcriptEntryPatches === null
					? previous.transcriptEntryById
					: createPatchedReadonlyMap(previous.transcriptEntryById, transcriptEntryPatches),
			activity: input.graph.activity,
		};
	}

	return {
		transcriptEntries,
		operations: input.graph.operations,
		operationIndex: previous.operationIndex,
		interactions: input.graph.interactions,
		interactionById: previous.interactionById,
		turnState: input.graph.turnState,
		activeStreamingTail: input.graph.activeStreamingTail,
		activity: input.graph.activity,
		transcriptEntryById:
			transcriptEntryPatches === null
				? previous.transcriptEntryById
				: createPatchedReadonlyMap(previous.transcriptEntryById, transcriptEntryPatches),
		conversation: conversationFromSceneEntryArrayResult(createPatchedSceneEntryArray(previous.conversation.entries, entryPatches), previous.conversation.isStreaming),
		sceneEntryRowIndex: previous.sceneEntryRowIndex,
	};
}

export function materializeStreamingStatePatchedConversation(
	previous: CachedConversationState | null,
	input: CachedConversationInput
): CachedConversationState | null {
	if (
		previous === null ||
		previous.transcriptEntries !== input.graph.transcriptSnapshot.entries ||
		previous.operations !== input.graph.operations ||
		previous.interactions !== input.graph.interactions
	) {
		return null;
	}

	if (!areActivitiesCompatibleForConversationPatch(previous.activity, input.graph.activity)) {
		return null;
	}

	const previousIsRunning = previous.turnState === "Running";
	const nextIsRunning = input.graph.turnState === "Running";
	const previousTailRowId = previousIsRunning ? (previous.activeStreamingTail?.rowId ?? null) : null;
	const nextTailRowId = nextIsRunning ? (input.graph.activeStreamingTail?.rowId ?? null) : null;
	const rowIdsToPatch = new Set<string>();
	if (previousTailRowId !== null) {
		rowIdsToPatch.add(previousTailRowId);
	}
	if (nextTailRowId !== null) {
		rowIdsToPatch.add(nextTailRowId);
	}

	let entryPatches: Map<number, AgentPanelSceneEntryModel> | null = null;
	for (const rowId of rowIdsToPatch) {
		const transcriptEntry = previous.transcriptEntryById.get(rowId);
		if (transcriptEntry === undefined) {
			return null;
		}
		const rowIndex = previous.sceneEntryRowIndex.get(rowId);
		if (rowIndex === undefined) {
			return null;
		}
		const previousEntry = previous.conversation.entries[rowIndex];
		if (previousEntry === undefined) {
			return null;
		}
		const nextEntry = materializeTranscriptEntry(
			transcriptEntry,
			input.graph,
			previous.operationIndex,
			nextIsRunning && transcriptEntry.entryId === nextTailRowId
		);
		if (areSceneEntriesEquivalent(previousEntry, nextEntry)) {
			continue;
		}
		entryPatches = addSceneEntryPatch(entryPatches, rowIndex, nextEntry);
	}

	const nextConversationIsStreaming = nextIsRunning;
	if (entryPatches === null && previous.conversation.isStreaming === nextConversationIsStreaming) {
		return {
			...previous,
			turnState: input.graph.turnState,
			activeStreamingTail: input.graph.activeStreamingTail,
			activity: input.graph.activity,
		};
	}

	return {
		transcriptEntries: input.graph.transcriptSnapshot.entries,
		operations: input.graph.operations,
		operationIndex: previous.operationIndex,
		interactions: input.graph.interactions,
		interactionById: previous.interactionById,
		turnState: input.graph.turnState,
		activeStreamingTail: input.graph.activeStreamingTail,
		activity: input.graph.activity,
		transcriptEntryById: previous.transcriptEntryById,
		conversation:
			entryPatches === null
				? {
						entries: previous.conversation.entries,
						isStreaming: nextConversationIsStreaming,
						scenePatch: scenePatchIdentity(),
					}
				: conversationFromSceneEntryArrayResult(
						createPatchedSceneEntryArray(previous.conversation.entries, entryPatches),
						nextConversationIsStreaming
					),
		sceneEntryRowIndex: previous.sceneEntryRowIndex,
	};
}

export function materializeTranscriptPatchedConversation(
	previous: CachedConversationState | null,
	input: CachedConversationInput
): CachedConversationState | null {
	if (
		previous === null ||
		previous.operations !== input.graph.operations ||
		previous.interactions !== input.graph.interactions ||
		previous.turnState !== input.graph.turnState ||
		!areActiveStreamingTailsEquivalent(
			previous.activeStreamingTail,
			input.graph.activeStreamingTail
		) ||
		!areActivitiesCompatibleForConversationPatch(previous.activity, input.graph.activity) ||
		previous.transcriptEntries.length !== input.graph.transcriptSnapshot.entries.length
	) {
		return null;
	}

	const transcriptEntries = input.graph.transcriptSnapshot.entries;
	let entryPatches: Map<number, AgentPanelSceneEntryModel> | null = null;
	let transcriptEntryPatches: Map<string, TranscriptEntry> | null = null;
	const isRunning = input.graph.turnState === "Running";
	const liveAssistantEntryId = isRunning ? (input.graph.activeStreamingTail?.rowId ?? null) : null;

	for (let index = 0; index < transcriptEntries.length; index += 1) {
		const previousTranscriptEntry = previous.transcriptEntries[index];
		const nextTranscriptEntry = transcriptEntries[index];
		if (previousTranscriptEntry === undefined || nextTranscriptEntry === undefined) {
			return null;
		}
		if (previousTranscriptEntry.entryId !== nextTranscriptEntry.entryId) {
			return null;
		}
		if (previousTranscriptEntry === nextTranscriptEntry) {
			continue;
		}

		const rowIndex = previous.sceneEntryRowIndex.get(nextTranscriptEntry.entryId);
		if (rowIndex === undefined) {
			return null;
		}
		const previousSceneEntry = previous.conversation.entries[rowIndex];
		if (previousSceneEntry === undefined) {
			return null;
		}
		const nextSceneEntry = materializeTranscriptEntry(
			nextTranscriptEntry,
			input.graph,
			previous.operationIndex,
			isRunning && nextTranscriptEntry.entryId === liveAssistantEntryId
		);
		transcriptEntryPatches ??= new Map<string, TranscriptEntry>();
		transcriptEntryPatches.set(nextTranscriptEntry.entryId, nextTranscriptEntry);
		if (areSceneEntriesEquivalent(previousSceneEntry, nextSceneEntry)) {
			continue;
		}
		entryPatches = addSceneEntryPatch(entryPatches, rowIndex, nextSceneEntry);
	}

	if (entryPatches === null) {
		return {
			...previous,
			transcriptEntries,
			transcriptEntryById:
				transcriptEntryPatches === null
					? previous.transcriptEntryById
					: createPatchedReadonlyMap(previous.transcriptEntryById, transcriptEntryPatches),
			activity: input.graph.activity,
		};
	}

	return {
		transcriptEntries,
		operations: input.graph.operations,
		operationIndex: previous.operationIndex,
		interactions: input.graph.interactions,
		interactionById: previous.interactionById,
		turnState: input.graph.turnState,
		activeStreamingTail: input.graph.activeStreamingTail,
		activity: input.graph.activity,
		transcriptEntryById:
			transcriptEntryPatches === null
				? previous.transcriptEntryById
				: createPatchedReadonlyMap(previous.transcriptEntryById, transcriptEntryPatches),
		conversation: conversationFromSceneEntryArrayResult(createPatchedSceneEntryArray(previous.conversation.entries, entryPatches), previous.conversation.isStreaming),
		sceneEntryRowIndex: previous.sceneEntryRowIndex,
	};
}

export function materializeTranscriptPatchedAndAppendedConversation(
	previous: CachedConversationState | null,
	input: CachedConversationInput
): CachedConversationState | null {
	if (
		previous === null ||
		previous.operations !== input.graph.operations ||
		previous.interactions !== input.graph.interactions ||
		previous.turnState !== input.graph.turnState ||
		!areActiveStreamingTailsEquivalent(
			previous.activeStreamingTail,
			input.graph.activeStreamingTail
		) ||
		!areActivitiesCompatibleForConversationPatch(previous.activity, input.graph.activity)
	) {
		return null;
	}

	const transcriptEntries = input.graph.transcriptSnapshot.entries;
	const transcriptPatch = getTranscriptEntryArrayPatch(transcriptEntries);
	const hasMarkedAppendOnly =
		transcriptPatch?.baseEntries === previous.transcriptEntries &&
		transcriptPatch.patchedEntriesByIndex === null &&
		transcriptPatch.appendedEntries !== null;
	const hasMarkedPatchAndAppend =
		transcriptPatch?.baseEntries === previous.transcriptEntries &&
		transcriptPatch.patchedEntriesByIndex !== null &&
		transcriptPatch.appendedEntries !== null;
	const hasStablePatchAndAppend =
		!hasMarkedAppendOnly &&
		!hasMarkedPatchAndAppend &&
		transcriptEntries.length > previous.transcriptEntries.length &&
		isStableTranscriptPatchAndAppend(previous.transcriptEntries, transcriptEntries);
	if (
		!hasMarkedPatchAndAppend &&
		!hasStablePatchAndAppend
	) {
		return null;
	}

	const appendStartIndex = previous.transcriptEntries.length;
	const isRunning = input.graph.turnState === "Running";
	const liveAssistantEntryId = isRunning ? (input.graph.activeStreamingTail?.rowId ?? null) : null;
	const patchedEntriesByIndex =
		hasMarkedPatchAndAppend
			? transcriptPatch.patchedEntriesByIndex
			: collectStableTranscriptPatchedEntriesByIndex(previous.transcriptEntries, transcriptEntries);
	const appendedTranscriptEntries =
		hasMarkedPatchAndAppend
			? transcriptPatch.appendedEntries
			: collectAppendedTranscriptEntries(transcriptEntries, appendStartIndex);
	if (patchedEntriesByIndex === null || appendedTranscriptEntries.length === 0) {
		return null;
	}
	let entryPatches: Map<number, AgentPanelSceneEntryModel> | null = null;
	let transcriptEntryPatches: Map<string, TranscriptEntry> | null = null;
	let firstChangedRowIndex = Number.POSITIVE_INFINITY;

	for (const [index, nextTranscriptEntry] of patchedEntriesByIndex) {
		if (index < 0 || index >= appendStartIndex) {
			return null;
		}
		const previousTranscriptEntry = previous.transcriptEntries[index];
		if (
			previousTranscriptEntry === undefined ||
			previousTranscriptEntry.entryId !== nextTranscriptEntry.entryId
		) {
			return null;
		}

		const rowIndex = previous.sceneEntryRowIndex.get(nextTranscriptEntry.entryId);
		if (rowIndex === undefined) {
			return null;
		}
		const previousSceneEntry = previous.conversation.entries[rowIndex];
		if (previousSceneEntry === undefined) {
			return null;
		}
		const nextSceneEntry = materializeTranscriptEntry(
			nextTranscriptEntry,
			input.graph,
			previous.operationIndex,
			isRunning && nextTranscriptEntry.entryId === liveAssistantEntryId
		);
		transcriptEntryPatches ??= new Map<string, TranscriptEntry>();
		transcriptEntryPatches.set(nextTranscriptEntry.entryId, nextTranscriptEntry);
		if (areSceneEntriesEquivalent(previousSceneEntry, nextSceneEntry)) {
			continue;
		}
		entryPatches = addSceneEntryPatch(entryPatches, rowIndex, nextSceneEntry);
		firstChangedRowIndex = Math.min(firstChangedRowIndex, rowIndex);
	}

	const appendedSceneEntries: AgentPanelSceneEntryModel[] = [];
	for (const nextTranscriptEntry of appendedTranscriptEntries) {
		transcriptEntryPatches ??= new Map<string, TranscriptEntry>();
		transcriptEntryPatches.set(nextTranscriptEntry.entryId, nextTranscriptEntry);
		appendedSceneEntries.push(
			materializeTranscriptEntry(
				nextTranscriptEntry,
				input.graph,
				previous.operationIndex,
				isRunning && nextTranscriptEntry.entryId === liveAssistantEntryId
			)
		);
	}

	const transcriptEntryById =
		transcriptEntryPatches === null
			? previous.transcriptEntryById
			: createPatchedReadonlyMap(previous.transcriptEntryById, transcriptEntryPatches);

	if (entryPatches === null) {
		const transcriptSceneEntryCount = previous.transcriptEntries.length;
		const hasTrailingInteractionEntries =
			previous.conversation.entries.length > transcriptSceneEntryCount;
		const previousTrailingEntries = hasTrailingInteractionEntries
			? collectTrailingSceneEntries(previous.conversation.entries, transcriptSceneEntryCount)
			: [];
		const nextEntries = hasTrailingInteractionEntries
			? appendTranscriptEntriesBeforeTrailingInteractions(
					previous.conversation.entries,
					transcriptSceneEntryCount,
					appendedSceneEntries,
					previousTrailingEntries
				)
			: createAppendedSceneEntryArray(previous.conversation.entries, appendedSceneEntries);
		const sceneEntryRowIndex = hasTrailingInteractionEntries
			? createSplicedSceneEntryRowIndex(
					previous.sceneEntryRowIndex,
					previousTrailingEntries,
					createAppendedInteractionTail(previousTrailingEntries, appendedSceneEntries),
					transcriptSceneEntryCount
				)
			: createAppendedSceneEntryRowIndex(
					previous.sceneEntryRowIndex,
					appendedSceneEntries,
					transcriptSceneEntryCount
				);
		return {
			transcriptEntries,
			operations: input.graph.operations,
			operationIndex: previous.operationIndex,
			interactions: input.graph.interactions,
			interactionById: previous.interactionById,
			turnState: input.graph.turnState,
			activeStreamingTail: input.graph.activeStreamingTail,
			activity: input.graph.activity,
			transcriptEntryById,
			conversation: conversationFromSceneEntryArrayResult(nextEntries, previous.conversation.isStreaming),
			sceneEntryRowIndex,
		};
	}

	const previousSuffixEntries = collectTrailingSceneEntries(
		previous.conversation.entries,
		firstChangedRowIndex
	);
	const nextTrailingEntries =
		previous.conversation.entries.length > previous.transcriptEntries.length
			? filterTrailingEntriesAfterAppends(
					collectTrailingSceneEntries(
						previous.conversation.entries,
						previous.transcriptEntries.length
					),
					appendedSceneEntries
				)
			: [];
	const replacementEntries: AgentPanelSceneEntryModel[] = [];
	for (let index = firstChangedRowIndex; index < transcriptEntries.length; index += 1) {
		const nextTranscriptEntry = transcriptEntries[index];
		if (nextTranscriptEntry === undefined) {
			continue;
		}
		replacementEntries.push(
			materializeTranscriptEntry(
				nextTranscriptEntry,
				input.graph,
				previous.operationIndex,
				isRunning && nextTranscriptEntry.entryId === liveAssistantEntryId
			)
		);
	}
	for (const trailingEntry of nextTrailingEntries) {
		replacementEntries.push(trailingEntry);
	}

	return {
		transcriptEntries,
		operations: input.graph.operations,
		operationIndex: previous.operationIndex,
		interactions: input.graph.interactions,
		interactionById: previous.interactionById,
		turnState: input.graph.turnState,
		activeStreamingTail: input.graph.activeStreamingTail,
		activity: input.graph.activity,
		transcriptEntryById,
		conversation: conversationFromSceneEntryArrayResult(createInsertedSceneEntryArray(
				previous.conversation.entries,
				firstChangedRowIndex,
				replacementEntries,
				[]
			), previous.conversation.isStreaming),
		sceneEntryRowIndex: createSplicedSceneEntryRowIndex(
			previous.sceneEntryRowIndex,
			previousSuffixEntries,
			replacementEntries,
			firstChangedRowIndex
		),
	};
}

export function materializeTranscriptAppendedConversation(
	previous: CachedConversationState | null,
	input: CachedConversationInput
): CachedConversationState | null {
	const transcriptEntries = input.graph.transcriptSnapshot.entries;
	const transcriptPatch = getTranscriptEntryArrayPatch(transcriptEntries);
	const hasMarkedAppend =
		transcriptPatch !== undefined &&
		transcriptPatch.baseEntries === previous?.transcriptEntries &&
		transcriptPatch.appendedEntries !== null &&
		transcriptPatch.patchedEntriesByIndex === null;
	if (
		previous === null ||
		previous.operations !== input.graph.operations ||
		previous.interactions !== input.graph.interactions ||
		previous.turnState !== input.graph.turnState ||
		!areActiveStreamingTailsEquivalent(
			previous.activeStreamingTail,
			input.graph.activeStreamingTail
		) ||
		!areActivitiesCompatibleForConversationPatch(previous.activity, input.graph.activity) ||
		(!hasMarkedAppend && !isStableTranscriptAppend(previous.transcriptEntries, transcriptEntries))
	) {
		return null;
	}

	const appendStartIndex = previous.transcriptEntries.length;
	if (appendStartIndex === transcriptEntries.length) {
		return {
			...previous,
			transcriptEntries,
			transcriptEntryById: previous.transcriptEntryById,
			activity: input.graph.activity,
		};
	}

	const isRunning = input.graph.turnState === "Running";
	const liveAssistantEntryId = isRunning ? (input.graph.activeStreamingTail?.rowId ?? null) : null;
	const appendedSceneEntries: AgentPanelSceneEntryModel[] = [];
	for (let index = appendStartIndex; index < transcriptEntries.length; index += 1) {
		const entry = transcriptEntries[index];
		if (entry === undefined) {
			continue;
		}
		appendedSceneEntries.push(
			materializeTranscriptEntry(
				entry,
				input.graph,
				previous.operationIndex,
				isRunning && entry.entryId === liveAssistantEntryId
			)
		);
	}
	const transcriptEntryById = createAppendedTranscriptEntryIndex(
		previous.transcriptEntryById,
		transcriptEntries,
		appendStartIndex
	);

	const transcriptSceneEntryCount = previous.transcriptEntries.length;
	const hasTrailingInteractionEntries =
		previous.conversation.entries.length > transcriptSceneEntryCount;
	const previousTrailingEntries = hasTrailingInteractionEntries
		? collectTrailingSceneEntries(previous.conversation.entries, transcriptSceneEntryCount)
		: [];
	const nextEntries = hasTrailingInteractionEntries
		? appendTranscriptEntriesBeforeTrailingInteractions(
				previous.conversation.entries,
				transcriptSceneEntryCount,
				appendedSceneEntries,
				previousTrailingEntries
			)
		: createAppendedSceneEntryArray(previous.conversation.entries, appendedSceneEntries);
	const sceneEntryRowIndex = hasTrailingInteractionEntries
		? createSplicedSceneEntryRowIndex(
				previous.sceneEntryRowIndex,
				previousTrailingEntries,
				createAppendedInteractionTail(previousTrailingEntries, appendedSceneEntries),
				transcriptSceneEntryCount
			)
		: createAppendedSceneEntryRowIndex(
				previous.sceneEntryRowIndex,
				appendedSceneEntries,
				transcriptSceneEntryCount
			);

	return {
		transcriptEntries,
		operations: input.graph.operations,
		operationIndex: previous.operationIndex,
		interactions: input.graph.interactions,
		interactionById: previous.interactionById,
		turnState: input.graph.turnState,
		activeStreamingTail: input.graph.activeStreamingTail,
		activity: input.graph.activity,
		transcriptEntryById,
		conversation: conversationFromSceneEntryArrayResult(nextEntries, previous.conversation.isStreaming),
		sceneEntryRowIndex,
	};
}

export function materializeTranscriptTruncatedConversation(
	previous: CachedConversationState | null,
	input: CachedConversationInput
): CachedConversationState | null {
	if (
		previous === null ||
		previous.operations !== input.graph.operations ||
		previous.interactions !== input.graph.interactions ||
		previous.turnState !== input.graph.turnState ||
		!areActiveStreamingTailsEquivalent(
			previous.activeStreamingTail,
			input.graph.activeStreamingTail
		) ||
		!areActivitiesCompatibleForConversationPatch(previous.activity, input.graph.activity)
	) {
		return null;
	}

	const transcriptEntries = input.graph.transcriptSnapshot.entries;
	if (
		transcriptEntries.length >= previous.transcriptEntries.length ||
		!isStableTranscriptTruncation(previous.transcriptEntries, transcriptEntries)
	) {
		return null;
	}

	const nextTranscriptSceneEntryCount = transcriptEntries.length;
	const previousTranscriptSceneEntryCount = previous.transcriptEntries.length;
	const previousTrailingEntries =
		previous.conversation.entries.length > previousTranscriptSceneEntryCount
			? collectTrailingSceneEntries(
					previous.conversation.entries,
					previousTranscriptSceneEntryCount
				)
			: [];
	const transcriptEntryById = createTruncatedTranscriptEntryIndex(
		previous.transcriptEntryById,
		previous.transcriptEntries,
		nextTranscriptSceneEntryCount
	);
	const conversationEntries =
		previousTrailingEntries.length === 0
			? createTruncatedSceneEntryArray(
					previous.conversation.entries,
					nextTranscriptSceneEntryCount
				)
			: createInsertedSceneEntryArray(
					previous.conversation.entries,
					nextTranscriptSceneEntryCount,
					[],
					previousTrailingEntries
				);
	const deletedSceneEntries = collectTrailingSceneEntries(
		previous.conversation.entries,
		nextTranscriptSceneEntryCount
	);
	const sceneEntryRowIndex =
		previousTrailingEntries.length === 0
			? createTruncatedSceneEntryRowIndex(
					previous.sceneEntryRowIndex,
					deletedSceneEntries
				)
			: createSplicedSceneEntryRowIndex(
					previous.sceneEntryRowIndex,
					deletedSceneEntries,
					previousTrailingEntries,
					nextTranscriptSceneEntryCount
				);

	return {
		transcriptEntries,
		operations: input.graph.operations,
		operationIndex: previous.operationIndex,
		interactions: input.graph.interactions,
		interactionById: previous.interactionById,
		turnState: input.graph.turnState,
		activeStreamingTail: input.graph.activeStreamingTail,
		activity: input.graph.activity,
		transcriptEntryById,
		conversation: conversationFromSceneEntryArrayResult(
			conversationEntries,
			previous.conversation.isStreaming
		),
		sceneEntryRowIndex,
	};
}

function appendTranscriptEntriesBeforeTrailingInteractions(
	previousEntries: readonly AgentPanelSceneEntryModel[],
	transcriptSceneEntryCount: number,
	appendedSceneEntries: readonly AgentPanelSceneEntryModel[],
	previousTrailingEntries: readonly AgentPanelSceneEntryModel[]
): import("./scene-entry-array.js").SceneEntryArrayResult {
	const nextTrailingEntries = filterTrailingEntriesAfterAppends(
		previousTrailingEntries,
		appendedSceneEntries
	);
	return createInsertedSceneEntryArray(
		previousEntries,
		transcriptSceneEntryCount,
		appendedSceneEntries,
		nextTrailingEntries
	);
}

export function collectTrailingSceneEntries(
	entries: readonly AgentPanelSceneEntryModel[],
	startIndex: number
): readonly AgentPanelSceneEntryModel[] {
	const trailingEntries: AgentPanelSceneEntryModel[] = [];
	for (let index = startIndex; index < entries.length; index += 1) {
		const entry = entries[index];
		if (entry !== undefined) {
			trailingEntries.push(entry);
		}
	}
	return trailingEntries;
}

function createAppendedInteractionTail(
	previousTrailingEntries: readonly AgentPanelSceneEntryModel[],
	appendedSceneEntries: readonly AgentPanelSceneEntryModel[]
): readonly AgentPanelSceneEntryModel[] {
	const nextTrailingEntries = filterTrailingEntriesAfterAppends(
		previousTrailingEntries,
		appendedSceneEntries
	);
	return createAppendedSceneEntryArray(appendedSceneEntries, nextTrailingEntries).entries;
}

function filterTrailingEntriesAfterAppends(
	previousTrailingEntries: readonly AgentPanelSceneEntryModel[],
	appendedSceneEntries: readonly AgentPanelSceneEntryModel[]
): readonly AgentPanelSceneEntryModel[] {
	if (previousTrailingEntries.length === 0) {
		return previousTrailingEntries;
	}

	const appendedIds = new Set<string>();
	for (const entry of appendedSceneEntries) {
		appendedIds.add(entry.id);
	}

	if (appendedIds.size === 0) {
		return previousTrailingEntries;
	}

	const trailingEntries: AgentPanelSceneEntryModel[] = [];
	for (const entry of previousTrailingEntries) {
		if (!appendedIds.has(entry.id)) {
			trailingEntries.push(entry);
		}
	}
	return trailingEntries;
}

