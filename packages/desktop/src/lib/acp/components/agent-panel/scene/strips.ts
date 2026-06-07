import { AGENT_PANEL_ACTION_IDS, type AgentPanelStripModel } from "@acepe/ui/agent-panel/types";
import type { SessionPlanResponse } from "../../../../services/claude-history.js";
import type { ModifiedFilesState } from "../../../types/modified-files-state.js";

export function buildModifiedFilesStrip(
	modifiedFilesState: ModifiedFilesState | null | undefined
): AgentPanelStripModel | null {
	if (!modifiedFilesState || modifiedFilesState.fileCount === 0) {
		return null;
	}

	return {
		id: "modified-files",
		kind: "modified_files",
		title: "Modified files",
		description: `${modifiedFilesState.fileCount} files changed`,
		items: [
			{
				id: "files",
				label: "Files",
				value: String(modifiedFilesState.fileCount),
			},
			{
				id: "edits",
				label: "Edits",
				value: String(modifiedFilesState.totalEditCount),
			},
		],
		actions: [
			{
				id: AGENT_PANEL_ACTION_IDS.review.openFullscreen,
				label: "Review",
				state: "enabled",
			},
		],
	};
}

export function buildPlanHeaderStrip(
	plan: SessionPlanResponse | null | undefined,
	showPlanSidebar: boolean | undefined
): AgentPanelStripModel | null {
	if (!plan || showPlanSidebar) {
		return null;
	}

	return {
		id: "plan-header",
		kind: "plan_header",
		title: plan.title,
		description: plan.summary ?? null,
		actions: [
			{
				id: AGENT_PANEL_ACTION_IDS.plan.toggleSidebar,
				label: "Open plan",
				state: "enabled",
			},
		],
	};
}
