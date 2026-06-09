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
	materializeBlockingInteractionActivityChange,
	materializeOperationPatchedConversation,
} from "./operation-patch-conversations.js";
import {
	canReuseConversation,
	canReuseConversationEntriesWithUpdatedActivity,
	materializeConversation,
	materializeConversationWithOperationIndex,
} from "./conversation-rebuild.js";
import { materializeCachedConversation } from "./conversation-dispatcher.js";
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
	conversationEntries = appendThinkingEntryWhenAwaiting(conversationEntries, input.graph);

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

// Project the canonical "working but not yet producing output" state into a
// synthetic thinking display entry at the tail ("Planning next moves..."). The
// truth is canonical (activity.kind === "awaiting_model", Rust-owned); this is a
// pure display projection with an Acepe-owned synthetic id — the same transient-
// affordance pattern as insertOptimisticUserEntryAtTurnBoundary. It disappears
// the moment the agent streams text (activeStreamingTail) or runs a tool
// (activity flips to running_operation).
function appendThinkingEntryWhenAwaiting(
	entries: readonly AgentPanelSceneEntryModel[],
	graph: AgentPanelCanonicalSource | null
): readonly AgentPanelSceneEntryModel[] {
	if (graph === null || graph.activity.kind !== "awaiting_model" || graph.activeStreamingTail !== null) {
		return entries;
	}
	const thinkingEntry: AgentPanelSceneEntryModel = {
		id: `${graph.canonicalSessionId}:awaiting-thinking`,
		type: "thinking",
		label: null,
	};
	const next = Array.from(entries);
	next.push(thinkingEntry);
	return next;
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
	conversationEntries = appendThinkingEntryWhenAwaiting(conversationEntries, input.graph);
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
