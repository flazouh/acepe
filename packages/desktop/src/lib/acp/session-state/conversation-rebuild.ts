/**
 * Full-rebuild + cache-reuse paths for the agent-panel materializer's
 * conversation: build a conversation from scratch over the canonical graph, and
 * the reuse predicates the dispatcher uses to short-circuit. Pure. GOD-safe.
 */
import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel/types";
import { scenePatchFullRebuild } from "../components/agent-panel/logic/scene-patch.js";
import {
	flattenUserChunkText,
	mergeAdjacentUserCommandChunks,
} from "../logic/user-row-scene-model.js";
import type { AgentPanelCanonicalSource } from "./agent-panel-canonical-source.js";
import type {
	CachedConversationInput,
	CachedConversationState,
} from "./conversation-cache-types.js";
import {
	materializeTranscriptEntry,
	questionInteractionToSceneEntry,
} from "./entry-materializers.js";
import { buildOperationIndex, type OperationIndex } from "./operation-index.js";
import { areActiveStreamingTailsEquivalent, areActivitiesEquivalent } from "./scene-equivalence.js";

function mergeAdjacentUserCommandEntries(
	entries: AgentPanelSceneEntryModel[]
): AgentPanelSceneEntryModel[] {
	const merged: AgentPanelSceneEntryModel[] = [];

	for (const entry of entries) {
		if (entry.type !== "user") {
			merged.push(entry);
			continue;
		}

		const previous = merged[merged.length - 1];
		if (
			previous !== undefined &&
			previous.type === "user" &&
			previous.chunks !== undefined &&
			entry.chunks !== undefined
		) {
			const combinedChunks = mergeAdjacentUserCommandChunks(previous.chunks, entry.chunks);
			if (combinedChunks !== null) {
				merged[merged.length - 1] = {
					id: previous.id,
					type: "user",
					text: flattenUserChunkText(combinedChunks),
					chunks: combinedChunks,
					isOptimistic: previous.isOptimistic ?? entry.isOptimistic,
					timestampMs: previous.timestampMs ?? entry.timestampMs,
				};
				continue;
			}
		}

		merged.push(entry);
	}

	return merged;
}

export function materializeConversation(graph: AgentPanelCanonicalSource): {
	entries: readonly AgentPanelSceneEntryModel[];
	isStreaming: boolean;
	scenePatch: ReturnType<typeof scenePatchFullRebuild>;
} {
	const isRunning = graph.turnState === "Running";
	const index = buildOperationIndex(graph.operations);
	return materializeConversationWithOperationIndex(graph, index, isRunning);
}

export function materializeConversationWithOperationIndex(
	graph: AgentPanelCanonicalSource,
	index: OperationIndex,
	isRunning = graph.turnState === "Running"
): {
	entries: readonly AgentPanelSceneEntryModel[];
	isStreaming: boolean;
	scenePatch: ReturnType<typeof scenePatchFullRebuild>;
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
		entries: mergeAdjacentUserCommandEntries(entries),
		isStreaming: isRunning,
		scenePatch: scenePatchFullRebuild(),
	};
}

export function canReuseConversation(
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

export function canReuseConversationEntriesWithUpdatedActivity(
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
