/**
 * Operation-patch conversation fast paths for the agent-panel materializer:
 * re-materialize when only the operation graph changed (tool state/results) or
 * when a blocking interaction's activity changed, reusing the prior transcript
 * projection. Pure; selected by the dispatcher.
 */
import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel/types";
import { scenePatchIdentity } from "../components/agent-panel/logic/scene-patch.js";
import type {
	CachedConversationInput,
	CachedConversationState,
} from "./conversation-cache-types.js";
import {
	materializeTranscriptEntry,
	questionInteractionToSceneEntry,
} from "./entry-materializers.js";
import type { OperationIndex } from "./operation-index.js";
import {
	applyOperationIndexPatch,
	applyStableMarkedOperationIndexPatchInPlace,
	collectAffectedTranscriptEntryIds,
} from "./operation-index-patch.js";
import {
	addSceneEntryPatch,
	conversationFromSceneEntryArrayResult,
	createAppendedSceneEntryArray,
	createInsertedSceneEntryArray,
	createPatchedSceneEntryArray,
} from "./scene-entry-array.js";
import {
	createAppendedSceneEntryRowIndex,
	createSplicedSceneEntryRowIndex,
} from "./scene-entry-row-index.js";
import {
	areActiveStreamingTailsEquivalent,
	areSceneEntriesEquivalent,
} from "./scene-equivalence.js";
import { collectTrailingSceneEntries } from "./transcript-patch-conversations.js";

export function materializeOperationPatchedConversation(
	previous: CachedConversationState | null,
	input: CachedConversationInput
): CachedConversationState | null {
	if (
		previous === null ||
		previous.transcriptEntries !== input.graph.transcriptSnapshot.entries ||
		previous.interactions !== input.graph.interactions ||
		previous.turnState !== input.graph.turnState ||
		!areActiveStreamingTailsEquivalent(
			previous.activeStreamingTail,
			input.graph.activeStreamingTail
		)
	) {
		return null;
	}

	const operationPatch =
		applyStableMarkedOperationIndexPatchInPlace(
			previous.operations,
			input.graph.operations,
			previous.operationIndex
		) ??
		applyOperationIndexPatch(previous.operations, input.graph.operations, previous.operationIndex);
	if (operationPatch === null) {
		return null;
	}
	const { operationIndex, changedOperationIds } = operationPatch;
	if (changedOperationIds.size === 0) {
		return {
			...previous,
			operations: input.graph.operations,
			operationIndex,
			activity: input.graph.activity,
		};
	}

	const affectedEntryIds =
		operationPatch.affectedEntryIds ??
		collectAffectedTranscriptEntryIds(previous.operationIndex, operationIndex, changedOperationIds);
	if (affectedEntryIds.size === 0) {
		return {
			...previous,
			operations: input.graph.operations,
			operationIndex,
			activity: input.graph.activity,
		};
	}

	let entryPatches: Map<number, AgentPanelSceneEntryModel> | null = null;
	const isRunning = input.graph.turnState === "Running";
	const liveAssistantEntryId = isRunning ? (input.graph.activeStreamingTail?.rowId ?? null) : null;
	for (const affectedEntryId of affectedEntryIds) {
		const transcriptEntry = previous.transcriptEntryById.get(affectedEntryId);
		if (transcriptEntry === undefined) {
			return null;
		}
		const rowIndex = previous.sceneEntryRowIndex.get(affectedEntryId);
		if (rowIndex === undefined) {
			return null;
		}
		const nextEntry = materializeTranscriptEntry(
			transcriptEntry,
			input.graph,
			operationIndex,
			isRunning && transcriptEntry.entryId === liveAssistantEntryId
		);
		const previousEntry = previous.conversation.entries[rowIndex];
		if (previousEntry !== undefined && areSceneEntriesEquivalent(previousEntry, nextEntry)) {
			continue;
		}
		entryPatches = addSceneEntryPatch(entryPatches, rowIndex, nextEntry);
	}

	if (entryPatches === null) {
		return {
			...previous,
			operations: input.graph.operations,
			operationIndex,
			activity: input.graph.activity,
		};
	}

	const blockingInteractionPatched = materializeBlockingInteractionActivityChange(
		previous,
		input,
		operationIndex,
		entryPatches
	);
	if (blockingInteractionPatched !== null) {
		return blockingInteractionPatched;
	}

	return {
		transcriptEntries: input.graph.transcriptSnapshot.entries,
		operations: input.graph.operations,
		operationIndex,
		interactions: input.graph.interactions,
		interactionById: previous.interactionById,
		turnState: input.graph.turnState,
		activeStreamingTail: input.graph.activeStreamingTail,
		activity: input.graph.activity,
		transcriptEntryById: previous.transcriptEntryById,
		conversation: conversationFromSceneEntryArrayResult(
			createPatchedSceneEntryArray(previous.conversation.entries, entryPatches),
			previous.conversation.isStreaming
		),
		sceneEntryRowIndex: previous.sceneEntryRowIndex,
	};
}

function materializeBlockingInteractionActivityChange(
	previous: CachedConversationState,
	input: CachedConversationInput,
	operationIndex: OperationIndex,
	entryPatches: ReadonlyMap<number, AgentPanelSceneEntryModel>
): CachedConversationState | null {
	const previousBlockingInteractionId = previous.activity.blockingInteractionId ?? null;
	const nextBlockingInteractionId = input.graph.activity.blockingInteractionId ?? null;
	if (previousBlockingInteractionId === nextBlockingInteractionId) {
		return null;
	}

	const transcriptSceneEntryCount = previous.transcriptEntries.length;
	const previousVisibleEntries = collectTrailingSceneEntries(
		previous.conversation.entries,
		transcriptSceneEntryCount
	);
	if (previousVisibleEntries.length > 1) {
		return null;
	}

	const previousVisibleEntry = previousVisibleEntries[0] ?? null;
	const nextVisibleInteraction =
		nextBlockingInteractionId === null
			? null
			: (previous.interactionById.get(nextBlockingInteractionId) ?? null);
	if (nextBlockingInteractionId !== null && nextVisibleInteraction === null) {
		return null;
	}

	const nextVisibleEntry =
		nextVisibleInteraction === null
			? null
			: questionInteractionToSceneEntry(nextVisibleInteraction, input.graph);
	const baseEntries = createPatchedSceneEntryArray(previous.conversation.entries, entryPatches);

	let nextEntries: import("./scene-entry-array.js").SceneEntryArrayResult;
	let sceneEntryRowIndex: ReadonlyMap<string, number>;
	if (previousVisibleEntry === null && nextVisibleEntry === null) {
		return {
			...previous,
			operations: input.graph.operations,
			operationIndex,
			activity: input.graph.activity,
			conversation: conversationFromSceneEntryArrayResult(
				baseEntries,
				previous.conversation.isStreaming
			),
		};
	}
	if (previousVisibleEntry === null && nextVisibleEntry !== null) {
		nextEntries = createAppendedSceneEntryArray(baseEntries.entries, [nextVisibleEntry]);
		sceneEntryRowIndex = createAppendedSceneEntryRowIndex(
			previous.sceneEntryRowIndex,
			[nextVisibleEntry],
			baseEntries.entries.length
		);
	} else if (previousVisibleEntry !== null && nextVisibleEntry === null) {
		nextEntries = createInsertedSceneEntryArray(
			baseEntries.entries,
			transcriptSceneEntryCount,
			[],
			[]
		);
		sceneEntryRowIndex = createSplicedSceneEntryRowIndex(
			previous.sceneEntryRowIndex,
			[previousVisibleEntry],
			[],
			transcriptSceneEntryCount
		);
	} else if (
		previousVisibleEntry !== null &&
		nextVisibleEntry !== null &&
		previousVisibleEntry.id === nextVisibleEntry.id
	) {
		nextEntries = createPatchedSceneEntryArray(
			baseEntries.entries,
			new Map([[transcriptSceneEntryCount, nextVisibleEntry]])
		);
		sceneEntryRowIndex = previous.sceneEntryRowIndex;
	} else {
		nextEntries = createInsertedSceneEntryArray(
			baseEntries.entries,
			transcriptSceneEntryCount,
			nextVisibleEntry === null ? [] : [nextVisibleEntry],
			[]
		);
		sceneEntryRowIndex = createSplicedSceneEntryRowIndex(
			previous.sceneEntryRowIndex,
			previousVisibleEntry === null ? [] : [previousVisibleEntry],
			nextVisibleEntry === null ? [] : [nextVisibleEntry],
			transcriptSceneEntryCount
		);
	}

	return {
		transcriptEntries: input.graph.transcriptSnapshot.entries,
		operations: input.graph.operations,
		operationIndex,
		interactions: input.graph.interactions,
		interactionById: previous.interactionById,
		turnState: input.graph.turnState,
		activeStreamingTail: input.graph.activeStreamingTail,
		activity: input.graph.activity,
		transcriptEntryById: previous.transcriptEntryById,
		conversation: conversationFromSceneEntryArrayResult(
			nextEntries,
			previous.conversation.isStreaming
		),
		sceneEntryRowIndex,
	};
}
