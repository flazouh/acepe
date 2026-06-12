/**
 * Shared types for the agent-panel materializer's conversation cache: the input
 * to a materialization pass and the cached state snapshot threaded through the
 * incremental conversation-patch fast paths. Extracted so the patch-strategy
 * modules and the dispatcher share one contract. GOD-safe (types only).
 */
import type { InteractionSnapshot, TranscriptEntry } from "../../services/acp-types.js";
import type { AgentPanelSceneEntryModel } from "@acepe/ui/agent-panel/types";
import type { ScenePatch } from "../components/agent-panel/logic/scene-patch.js";
import type { AgentPanelCanonicalSource } from "./agent-panel-canonical-source.js";
import type { OperationIndex } from "./operation-index.js";

export interface CachedConversationInput {
	readonly graph: AgentPanelCanonicalSource;
}

/** Normalized patch-builder contract selected by the conversation dispatcher. */
export type ConversationPatchBuilder = (
	previous: CachedConversationState | null,
	input: CachedConversationInput
) => CachedConversationState | null;

export interface CachedConversationState {
	readonly transcriptEntries: AgentPanelCanonicalSource["transcriptSnapshot"]["entries"];
	readonly operations: AgentPanelCanonicalSource["operations"];
	readonly operationIndex: OperationIndex;
	readonly interactions: AgentPanelCanonicalSource["interactions"];
	readonly interactionById: ReadonlyMap<string, InteractionSnapshot>;
	readonly turnState: AgentPanelCanonicalSource["turnState"];
	readonly activeStreamingTail: AgentPanelCanonicalSource["activeStreamingTail"];
	readonly activity: AgentPanelCanonicalSource["activity"];
	readonly transcriptEntryById: ReadonlyMap<string, TranscriptEntry>;
	readonly conversation: {
		entries: readonly AgentPanelSceneEntryModel[];
		isStreaming: boolean;
		scenePatch: ScenePatch;
	};
	readonly sceneEntryRowIndex: ReadonlyMap<string, number>;
}
