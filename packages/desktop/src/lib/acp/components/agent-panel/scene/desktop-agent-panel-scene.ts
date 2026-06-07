// Spine for the desktop agent-panel scene projection. Composes the focused
// scene modules into a single AgentPanelSceneModel and re-exports the
// historical module surface so the four importers
// (activity-entry-projection, permission-bar, agent-panel-graph-materializer,
// virtual-session-list) and the scene tests keep consuming it from here.
//
// Reads as a table of contents: scene-input-types (public input contract),
// tool/* (tool-call projection), conversation-model (entry projection),
// strips / cards / plan-sidebar / composer-model (chrome builders).
import {
	AGENT_PANEL_ACTION_IDS,
	type AgentPanelCardModel,
	type AgentPanelSceneModel,
	type AgentPanelSidebarModel,
	type AgentPanelStripModel,
} from "@acepe/ui/agent-panel/types";
import type { BuildDesktopAgentPanelSceneOptions } from "./scene-input-types.js";
import {
	mapSessionEntriesToConversationModel,
	mapSessionStatusToSceneStatus,
} from "./conversation-model.js";
import { buildDesktopComposerModel } from "./composer-model.js";
import { buildDesktopPlanSidebar } from "./plan-sidebar.js";
import { buildModifiedFilesStrip, buildPlanHeaderStrip } from "./strips.js";
import {
	buildDesktopErrorCard,
	buildDesktopInstallCard,
	buildDesktopPrCard,
	buildDesktopWorktreeCard,
} from "./cards.js";

export type {
	BuildDesktopAgentPanelSceneOptions,
	DesktopAgentPanelHeaderInput,
	DesktopComposerInput,
	DesktopErrorCardInput,
	DesktopInstallCardInput,
	DesktopPrCardInput,
	DesktopWorktreeCardInput,
} from "./scene-input-types.js";
export { mapToolCallToSceneEntry } from "./tool/tool-call-entry.js";
export {
	mapSessionEntriesToConversationModel,
	mapSessionEntryToConversationEntry,
	mapSessionStatusToSceneStatus,
	mapVirtualizedDisplayEntryToConversationEntry,
} from "./conversation-model.js";
export { buildDesktopPlanSidebar } from "./plan-sidebar.js";
export { buildDesktopComposerModel } from "./composer-model.js";
export { buildModifiedFilesStrip, buildPlanHeaderStrip } from "./strips.js";
export {
	buildDesktopErrorCard,
	buildDesktopInstallCard,
	buildDesktopPrCard,
	buildDesktopWorktreeCard,
} from "./cards.js";

export function buildDesktopAgentPanelScene(
	options: BuildDesktopAgentPanelSceneOptions
): AgentPanelSceneModel {
	const status = mapSessionStatusToSceneStatus(options.sessionStatus, options.entries.length);
	const conversation = mapSessionEntriesToConversationModel(options.entries, options.turnState);
	const strips: AgentPanelStripModel[] = [];
	const cards: AgentPanelCardModel[] = [];

	const planHeader = buildPlanHeaderStrip(options.plan, options.showPlanSidebar);
	if (planHeader) {
		strips.push(planHeader);
	}

	const modifiedFilesStrip = buildModifiedFilesStrip(options.modifiedFilesState);
	if (modifiedFilesStrip) {
		strips.push(modifiedFilesStrip);
	}

	const prCard = buildDesktopPrCard(options.prCard);
	if (prCard) {
		cards.push(prCard);
	}

	const worktreeCard = buildDesktopWorktreeCard(options.worktreeCard);
	if (worktreeCard) {
		cards.push(worktreeCard);
	}

	const installCard = buildDesktopInstallCard(options.installCard);
	if (installCard) {
		cards.push(installCard);
	}

	const errorCard = buildDesktopErrorCard(options.errorCard);
	if (errorCard) {
		cards.push(errorCard);
	}

	const sidebars: AgentPanelSidebarModel = {
		plan: options.showPlanSidebar ? buildDesktopPlanSidebar(options.plan) : null,
	};

	return {
		panelId: options.panelId,
		status,
		header: {
			title: options.header.title,
			subtitle: options.header.subtitle ?? null,
			status,
			agentLabel: options.header.agentLabel ?? null,
			projectLabel: options.header.projectLabel ?? null,
			projectColor: options.header.projectColor ?? null,
			branchLabel: options.header.branchLabel ?? null,
			badges: options.header.badges ?? [],
			actions: options.header.actions ?? [
				{
					id: AGENT_PANEL_ACTION_IDS.header.copySessionMarkdown,
					label: "Copy",
					state: "enabled",
				},
			],
		},
		conversation,
		composer: options.composer ? buildDesktopComposerModel(options.composer) : null,
		strips,
		cards,
		sidebars,
		chrome: options.chrome ?? null,
	};
}
