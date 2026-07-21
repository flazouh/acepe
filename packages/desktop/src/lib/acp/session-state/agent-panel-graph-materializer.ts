import type {
	AgentPanelLifecycleModel,
	AgentPanelSceneEntryModel,
	AgentPanelSceneModel,
} from "@acepe/ui/agent-panel/types";
import type { SessionEntry } from "../application/dto/session-entry.js";
import { scenePatchFullRebuild } from "../components/agent-panel/logic/scene-patch.js";
import { mapSessionEntryToConversationEntry } from "../components/agent-panel/scene/desktop-agent-panel-scene.js";
import {
	AGENT_PANEL_SCENE_TEXT_LIMITS,
	type AgentPanelGraphHeaderInput,
	type AgentPanelGraphMaterializerInput,
	type AgentPanelGraphMaterializerReadModel,
} from "./agent-panel-graph-materializer-types.js";

export { applySceneTextLimits } from "./scene-text-limits.js";

import type { CachedConversationState } from "./conversation-cache-types.js";
import { materializeCachedConversation } from "./conversation-dispatcher.js";
import { materializeConversation } from "./conversation-rebuild.js";
import { buildLifecycleActions, mapGraphStatus, materializeLifecycle } from "./graph-lifecycle.js";

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
		selectConversationScenePatch() {
			return previousConversation?.conversation.scenePatch ?? scenePatchFullRebuild();
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
