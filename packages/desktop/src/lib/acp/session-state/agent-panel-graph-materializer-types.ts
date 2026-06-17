/**
 * Public types + constants for the canonical agent-panel graph materializer,
 * extracted from agent-panel-graph-materializer.ts so the materializer file
 * itself shrinks toward its orchestration core. Pure type/const relocation —
 * the materializer re-exports these for its existing consumers. GOD note: these
 * describe canonical agent-panel scene inputs; no behavior lives here.
 */
import type {
	AgentPanelActionDescriptor,
	AgentPanelCardModel,
	AgentPanelChromeModel,
	AgentPanelComposerModel,
	AgentPanelSceneModel,
	AgentPanelSidebarModel,
	AgentPanelStripModel,
} from "@acepe/ui/agent-panel/types";
import type { SessionEntry } from "../application/dto/session-entry.js";
import type { ScenePatch } from "../components/agent-panel/logic/scene-patch.js";
import type { AgentPanelCanonicalSource } from "./agent-panel-canonical-source.js";

export const AGENT_PANEL_SCENE_TEXT_LIMITS = {
	output: 12000,
	result: 12000,
	details: 8000,
};

export interface AgentPanelGraphHeaderInput {
	readonly title: string;
	readonly subtitle?: string | null;
	readonly agentIconSrc?: string | null;
	readonly agentLabel?: string | null;
	readonly projectLabel?: string | null;
	readonly projectColor?: string | null;
	readonly sequenceId?: number | null;
	readonly branchLabel?: string | null;
	readonly actions?: readonly AgentPanelActionDescriptor[];
}

export interface AgentPanelGraphMaterializerInput {
	readonly panelId: string;
	readonly graph: AgentPanelCanonicalSource | null;
	readonly header: AgentPanelGraphHeaderInput;
	readonly composer?: AgentPanelComposerModel | null;
	readonly strips?: readonly AgentPanelStripModel[];
	readonly cards?: readonly AgentPanelCardModel[];
	readonly sidebars?: AgentPanelSidebarModel | null;
	readonly chrome?: AgentPanelChromeModel | null;
	readonly optimistic?: {
		readonly pendingUserEntry?: SessionEntry | null;
	} | null;
}

export interface AgentPanelGraphMaterializerReadModel {
	apply(input: AgentPanelGraphMaterializerInput): AgentPanelSceneModel;
	selectConversationScenePatch(): ScenePatch;
}
