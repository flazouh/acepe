import type {
	AgentPanelActionDescriptor,
	AgentPanelCardModel,
	AgentPanelChromeModel,
	AgentPanelComposerModel,
	AgentPanelLifecycleModel,
	AgentPanelSceneEntryModel,
	AgentPanelSceneModel,
	AgentPanelSessionStatus,
	AgentPanelSidebarModel,
	AgentPanelStripModel,
	AgentToolEntry,
	AnyAgentEntry,
} from "@acepe/ui/agent-panel/types";
import { AGENT_PANEL_ACTION_IDS } from "@acepe/ui/agent-panel/types";
import type {
	InteractionSnapshot,
	OperationDegradationReason,
	OperationSnapshot,
	TranscriptEntry,
} from "../../services/acp-types.js";
import type { SessionEntry } from "../application/dto/session-entry.js";
import { mapSessionEntryToConversationEntry } from "../components/agent-panel/scene/desktop-agent-panel-scene.js";
import type { AgentPanelCanonicalSource } from "./agent-panel-canonical-source.js";
import {
	markAgentPanelSceneEntryArrayAppendPatch,
	markAgentPanelSceneEntryArrayPatch,
	markAgentPanelSceneEntryArraySplicePatch,
	markAgentPanelSceneEntryArrayTruncation,
} from "./agent-panel-scene-entry-array-patch.js";
import { getInteractionSnapshotArrayPatch } from "./interaction-snapshot-array-patch.js";
import { getTranscriptEntryArrayPatch } from "./transcript-entry-array-patch.js";
import {
	AGENT_PANEL_SCENE_TEXT_LIMITS,
	type AgentPanelGraphHeaderInput,
	type AgentPanelGraphMaterializerInput,
	type AgentPanelGraphMaterializerReadModel,
} from "./agent-panel-graph-materializer-types.js";
export { applySceneTextLimits } from "./scene-text-limits.js";
import {
	buildLifecycleActions,
	mapGraphStatus,
	materializeLifecycle,
} from "./graph-lifecycle.js";
import {
	areActiveStreamingTailsEquivalent,
	areActivitiesCompatibleForConversationPatch,
	areActivitiesEquivalent,
	areSceneEntriesEquivalent,
} from "./scene-equivalence.js";
import {
	addSceneEntryPatch,
	createAppendedSceneEntryArray,
	createInsertedSceneEntryArray,
	createPatchedSceneEntryArray,
	createSceneEntryArrayView,
	createTruncatedSceneEntryArray,
	toArrayIndex,
} from "./scene-entry-array.js";
import {
	buildOperationIndex,
	findOperationForTranscriptSourceEntry,
	type OperationIndex,
} from "./operation-index.js";
import { logUnresolvedToolDiagnostics } from "./unresolved-tool-diagnostics.js";
import {
	applyOperationIndexPatch,
	applyStableMarkedOperationIndexPatchInPlace,
	collectAffectedTranscriptEntryIds,
} from "./operation-index-patch.js";
import { createPatchedReadonlyMap } from "./patched-readonly-map.js";
import {
	buildInteractionIndex,
	buildTranscriptEntryIndex,
	createAppendedInteractionIndex,
	createTruncatedInteractionIndex,
} from "./transcript-interaction-index.js";
import {
	buildSceneEntryRowIndex,
	createAppendedSceneEntryRowIndex,
	createSplicedSceneEntryRowIndex,
	createTruncatedSceneEntryRowIndex,
} from "./scene-entry-row-index.js";
import {
	areSceneEntryListsEquivalent,
	collectAppendedInteractions,
	collectAppendedTranscriptEntries,
	collectStableTranscriptPatchedEntriesByIndex,
	isStableTranscriptAppend,
	isStableTranscriptPatchAndAppend,
	isStableTranscriptTruncation,
	materializeVisibleInteractionEntries,
} from "./conversation-stability.js";
import {
	createAppendedTranscriptEntryIndex,
	createPatchedInteractionIndex,
	createTruncatedTranscriptEntryIndex,
	resolveUpdatedInteractionIndex,
} from "./interaction-index-patch.js";
import type {
	CachedConversationInput,
	CachedConversationState,
} from "./conversation-cache-types.js";
import {
	collectTrailingSceneEntries,
	materializeStreamingStatePatchedConversation,
	materializeTranscriptAppendedConversation,
	materializeTranscriptArrayPatchedConversation,
	materializeTranscriptPatchedAndAppendedConversation,
	materializeTranscriptPatchedConversation,
	materializeTranscriptTruncatedConversation,
} from "./transcript-patch-conversations.js";
import {
	materializeBlockingInteractionRetargetConversation,
	materializeInteractionPatchedConversation,
	materializeMarkedInteractionPatchedConversation,
	materializeStableInteractionAppendedConversation,
	materializeStableInteractionPatchedConversation,
	materializeStableInteractionTruncatedConversation,
} from "./interaction-patch-conversations.js";
import {
	interactionSceneEntryId,
	materializeTranscriptEntry,
	questionInteractionToSceneEntry,
} from "./entry-materializers.js";

// Re-export the public type surface (now owned by the -types module) so the
// materializer's existing consumers keep importing it from here.
export {
	AGENT_PANEL_SCENE_TEXT_LIMITS,
	type AgentPanelGraphHeaderInput,
	type AgentPanelGraphMaterializerInput,
	type AgentPanelGraphMaterializerReadModel,
};




export function findLatestLiveAssistantEntry(
	entries: readonly SessionEntry[]
): Extract<SessionEntry, { type: "assistant" }> | null {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (entry?.type === "user") {
			return null;
		}
		if (entry?.type === "assistant") {
			return entry;
		}
	}

	return null;
}

function materializeConversation(graph: AgentPanelCanonicalSource): {
	entries: readonly AgentPanelSceneEntryModel[];
	isStreaming: boolean;
} {
	const isRunning = graph.turnState === "Running";
	const index = buildOperationIndex(graph.operations);
	return materializeConversationWithOperationIndex(graph, index, isRunning);
}

function materializeConversationWithOperationIndex(
	graph: AgentPanelCanonicalSource,
	index: OperationIndex,
	isRunning = graph.turnState === "Running"
): {
	entries: readonly AgentPanelSceneEntryModel[];
	isStreaming: boolean;
} {
	const liveAssistantEntryId = isRunning ? (graph.activeStreamingTail?.rowId ?? null) : null;

	const entries: AgentPanelSceneEntryModel[] = [];
	const entryIds = new Set<string>();
	for (const entry of graph.transcriptSnapshot.entries) {
		const materializedEntry = materializeTranscriptEntry(
			entry,
			graph,
			index,
			isRunning && entry.entryId === liveAssistantEntryId
		);
		entries.push(materializedEntry);
		entryIds.add(materializedEntry.id);
	}

	for (const interaction of graph.interactions) {
		if (entryIds.has(interaction.id)) {
			continue;
		}
		const interactionEntry = questionInteractionToSceneEntry(interaction, graph);
		if (interactionEntry === null) {
			continue;
		}
		entries.push(interactionEntry);
		entryIds.add(interactionEntry.id);
	}

	return {
		entries,
		isStreaming: isRunning,
	};
}

function canReuseConversation(
	previous: CachedConversationState | null,
	input: CachedConversationInput
): previous is CachedConversationState {
	const graph = input.graph;
	return (
		previous !== null &&
		previous.transcriptEntries === graph.transcriptSnapshot.entries &&
		previous.operations === graph.operations &&
		previous.interactions === graph.interactions &&
		previous.turnState === graph.turnState &&
		areActiveStreamingTailsEquivalent(previous.activeStreamingTail, graph.activeStreamingTail) &&
		areActivitiesEquivalent(previous.activity, graph.activity)
	);
}

function canReuseConversationEntriesWithUpdatedActivity(
	previous: CachedConversationState | null,
	input: CachedConversationInput
): previous is CachedConversationState {
	const graph = input.graph;
	return (
		previous !== null &&
		previous.transcriptEntries === graph.transcriptSnapshot.entries &&
		previous.operations === graph.operations &&
		previous.interactions === graph.interactions &&
		previous.turnState === graph.turnState &&
		areActiveStreamingTailsEquivalent(previous.activeStreamingTail, graph.activeStreamingTail)
	);
}

function materializeCachedConversation(
	previous: CachedConversationState | null,
	input: CachedConversationInput
): CachedConversationState {
	if (canReuseConversation(previous, input)) {
		return previous;
	}

	if (canReuseConversationEntriesWithUpdatedActivity(previous, input)) {
		const blockingInteractionRetarget = materializeBlockingInteractionRetargetConversation(
			previous,
			input
		);
		if (blockingInteractionRetarget !== null) {
			return blockingInteractionRetarget;
		}
		const cachedConversation = previous as CachedConversationState;
		return {
			...cachedConversation,
			activity: input.graph.activity,
		};
	}

	const operationPatched = materializeOperationPatchedConversation(previous, input);
	if (operationPatched !== null) {
		return operationPatched;
	}

	const streamingStatePatched = materializeStreamingStatePatchedConversation(previous, input);
	if (streamingStatePatched !== null) {
		return streamingStatePatched;
	}

	const transcriptArrayPatched = materializeTranscriptArrayPatchedConversation(previous, input);
	if (transcriptArrayPatched !== null) {
		return transcriptArrayPatched;
	}

	const transcriptPatchedAndAppended = materializeTranscriptPatchedAndAppendedConversation(
		previous,
		input
	);
	if (transcriptPatchedAndAppended !== null) {
		return transcriptPatchedAndAppended;
	}

	const transcriptPatched = materializeTranscriptPatchedConversation(previous, input);
	if (transcriptPatched !== null) {
		return transcriptPatched;
	}

	const transcriptTruncated = materializeTranscriptTruncatedConversation(previous, input);
	if (transcriptTruncated !== null) {
		return transcriptTruncated;
	}

	const transcriptAppended = materializeTranscriptAppendedConversation(previous, input);
	if (transcriptAppended !== null) {
		return transcriptAppended;
	}

	const interactionPatched = materializeInteractionPatchedConversation(previous, input);
	if (interactionPatched !== null) {
		return interactionPatched;
	}

	const operationIndex = buildOperationIndex(input.graph.operations);
	const conversation = materializeConversationWithOperationIndex(input.graph, operationIndex);
	return {
		transcriptEntries: input.graph.transcriptSnapshot.entries,
		operations: input.graph.operations,
		operationIndex,
		interactions: input.graph.interactions,
		interactionById: buildInteractionIndex(input.graph.interactions),
		turnState: input.graph.turnState,
		activeStreamingTail: input.graph.activeStreamingTail,
		activity: input.graph.activity,
		transcriptEntryById: buildTranscriptEntryIndex(input.graph.transcriptSnapshot.entries),
		conversation,
		sceneEntryRowIndex: buildSceneEntryRowIndex(conversation.entries),
	};
}

function materializeOperationPatchedConversation(
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
		applyOperationIndexPatch(
			previous.operations,
			input.graph.operations,
			previous.operationIndex
		);
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
		conversation: {
			entries: createPatchedSceneEntryArray(previous.conversation.entries, entryPatches),
			isStreaming: previous.conversation.isStreaming,
		},
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
			: previous.interactionById.get(nextBlockingInteractionId) ?? null;
	if (nextBlockingInteractionId !== null && nextVisibleInteraction === null) {
		return null;
	}

	const nextVisibleEntry =
		nextVisibleInteraction === null
			? null
			: questionInteractionToSceneEntry(nextVisibleInteraction, input.graph);
	const baseEntries = createPatchedSceneEntryArray(previous.conversation.entries, entryPatches);

	let nextEntries: readonly AgentPanelSceneEntryModel[];
	let sceneEntryRowIndex: ReadonlyMap<string, number>;
	if (previousVisibleEntry === null && nextVisibleEntry === null) {
		return {
			...previous,
			operations: input.graph.operations,
			operationIndex,
			activity: input.graph.activity,
			conversation: {
				entries: baseEntries,
				isStreaming: previous.conversation.isStreaming,
			},
		};
	}
	if (previousVisibleEntry === null && nextVisibleEntry !== null) {
		nextEntries = createAppendedSceneEntryArray(baseEntries, [nextVisibleEntry]);
		sceneEntryRowIndex = createAppendedSceneEntryRowIndex(
			previous.sceneEntryRowIndex,
			[nextVisibleEntry],
			baseEntries.length
		);
	} else if (previousVisibleEntry !== null && nextVisibleEntry === null) {
		nextEntries = createInsertedSceneEntryArray(baseEntries, transcriptSceneEntryCount, [], []);
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
			baseEntries,
			new Map([[transcriptSceneEntryCount, nextVisibleEntry]])
		);
		sceneEntryRowIndex = previous.sceneEntryRowIndex;
	} else {
		nextEntries = createInsertedSceneEntryArray(
			baseEntries,
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
		conversation: {
			entries: nextEntries,
			isStreaming: previous.conversation.isStreaming,
		},
		sceneEntryRowIndex,
	};
}





function materializeAgentPanelSceneFromConversation(
	input: AgentPanelGraphMaterializerInput,
	conversation: {
		entries: readonly AgentPanelSceneEntryModel[];
		isStreaming: boolean;
	}
): AgentPanelSceneModel {
	if (input.graph === null) {
		return materializeAgentPanelSceneFromGraph(input);
	}

	const status = mapGraphStatus(input.graph);
	let conversationEntries: readonly AgentPanelSceneEntryModel[] = conversation.entries;
	if (input.optimistic?.pendingUserEntry != null) {
		const mapped = mapSessionEntryToConversationEntry(
			input.optimistic.pendingUserEntry,
			undefined,
			{ isOptimistic: true }
		);
		conversationEntries = insertOptimisticUserEntryAtTurnBoundary(conversationEntries, mapped);
	}

	return {
		panelId: input.panelId,
		status,
		lifecycle: materializeLifecycle(input.graph),
		header: {
			title: input.header.title,
			subtitle: input.header.subtitle ?? null,
			status,
			agentIconSrc: input.header.agentIconSrc ?? null,
			agentLabel: input.header.agentLabel ?? null,
			projectLabel: input.header.projectLabel ?? null,
			projectColor: input.header.projectColor ?? null,
			sequenceId: input.header.sequenceId ?? null,
			branchLabel: input.header.branchLabel ?? null,
			actions: input.header.actions ?? buildLifecycleActions(input.graph),
		},
		conversation: {
			entries: conversationEntries,
			isStreaming: conversation.isStreaming,
		},
		composer: input.composer ?? null,
		strips: input.strips ?? [],
		cards: input.cards ?? [],
		sidebars: input.sidebars ?? null,
		chrome: input.chrome ?? null,
	};
}

export function createAgentPanelGraphMaterializerReadModel(): AgentPanelGraphMaterializerReadModel {
	let previousConversation: CachedConversationState | null = null;

	return {
		apply(input) {
			if (input.graph === null) {
				previousConversation = null;
				return materializeAgentPanelSceneFromGraph(input);
			}

			previousConversation = materializeCachedConversation(previousConversation, {
				graph: input.graph,
			});
			return materializeAgentPanelSceneFromConversation(input, previousConversation.conversation);
		},
	};
}

function insertOptimisticUserEntryAtTurnBoundary(
	entries: readonly AgentPanelSceneEntryModel[],
	entry: AgentPanelSceneEntryModel
): readonly AgentPanelSceneEntryModel[] {
	const nextEntries: AgentPanelSceneEntryModel[] = Array.from(entries);
	let lastUserIndex = -1;
	for (let index = nextEntries.length - 1; index >= 0; index -= 1) {
		if (nextEntries[index]?.type === "user") {
			lastUserIndex = index;
			break;
		}
	}
	if (lastUserIndex !== -1) {
		nextEntries.push(entry);
		return nextEntries;
	}

	const firstToolIndex = nextEntries.findIndex((candidate) => candidate.type === "tool_call");
	if (firstToolIndex === -1) {
		nextEntries.push(entry);
		return nextEntries;
	}

	nextEntries.splice(firstToolIndex, 0, entry);
	return nextEntries;
}

export function materializeAgentPanelSceneFromGraph(
	input: AgentPanelGraphMaterializerInput
): AgentPanelSceneModel {
	if (input.graph === null) {
		const preSesssionLifecycle: AgentPanelLifecycleModel = {
			status: "activating",
			detachedReason: null,
			failureReason: null,
			errorMessage: null,
			actionability: {
				canSend: false,
				canResume: false,
				canRetry: false,
				canArchive: false,
				canConfigure: false,
				recommendedAction: "wait",
				recoveryPhase: "none",
				compactStatus: "activating",
			},
		};

		const optimisticEntries: AgentPanelSceneEntryModel[] = [];
		if (input.optimistic?.pendingUserEntry != null) {
			const mapped = mapSessionEntryToConversationEntry(
				input.optimistic.pendingUserEntry,
				undefined,
				{ isOptimistic: true }
			);
			optimisticEntries.push(mapped);
		}

		return {
			panelId: input.panelId,
			status: "warming",
			lifecycle: preSesssionLifecycle,
			header: {
				title: input.header.title,
				subtitle: input.header.subtitle ?? null,
				status: "warming",
				agentIconSrc: input.header.agentIconSrc ?? null,
				agentLabel: input.header.agentLabel ?? null,
				projectLabel: input.header.projectLabel ?? null,
				projectColor: input.header.projectColor ?? null,
				sequenceId: input.header.sequenceId ?? null,
				branchLabel: input.header.branchLabel ?? null,
				actions: input.header.actions ?? [],
			},
			conversation: {
				entries: optimisticEntries,
				isStreaming: false,
			},
			composer: input.composer ?? null,
			strips: input.strips ?? [],
			cards: input.cards ?? [],
			sidebars: input.sidebars ?? null,
			chrome: input.chrome ?? null,
		};
	}

	const status = mapGraphStatus(input.graph);
	const conversation = materializeConversation(input.graph);

	let conversationEntries: readonly AgentPanelSceneEntryModel[] = conversation.entries;
	if (input.optimistic?.pendingUserEntry != null) {
		const mapped = mapSessionEntryToConversationEntry(
			input.optimistic.pendingUserEntry,
			undefined,
			{ isOptimistic: true }
		);
		conversationEntries = insertOptimisticUserEntryAtTurnBoundary(conversationEntries, mapped);
	}
	return {
		panelId: input.panelId,
		status,
		lifecycle: materializeLifecycle(input.graph),
		header: {
			title: input.header.title,
			subtitle: input.header.subtitle ?? null,
			status,
			agentIconSrc: input.header.agentIconSrc ?? null,
			agentLabel: input.header.agentLabel ?? null,
			projectLabel: input.header.projectLabel ?? null,
			projectColor: input.header.projectColor ?? null,
			sequenceId: input.header.sequenceId ?? null,
			branchLabel: input.header.branchLabel ?? null,
			actions: input.header.actions ?? buildLifecycleActions(input.graph),
		},
		conversation: {
			entries: conversationEntries,
			isStreaming: conversation.isStreaming,
		},
		composer: input.composer ?? null,
		strips: input.strips ?? [],
		cards: input.cards ?? [],
		sidebars: input.sidebars ?? null,
		chrome: input.chrome ?? null,
	};
}
