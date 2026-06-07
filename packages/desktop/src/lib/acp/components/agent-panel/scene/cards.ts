import { AGENT_PANEL_ACTION_IDS, type AgentPanelCardModel } from "@acepe/ui/agent-panel/types";
import type {
	DesktopErrorCardInput,
	DesktopInstallCardInput,
	DesktopPrCardInput,
	DesktopWorktreeCardInput,
} from "./scene-input-types.js";

export function buildDesktopPrCard(
	input: DesktopPrCardInput | null | undefined
): AgentPanelCardModel | null {
	if (!input) {
		return null;
	}

	return {
		id: "pr-status-card",
		kind: "pr_status",
		title: "Pull request",
		description: input.description,
		meta: [
			{
				id: "files-changed",
				label: "Files changed",
				value:
					input.filesChanged === null || input.filesChanged === undefined
						? null
						: String(input.filesChanged),
			},
			{
				id: "checks",
				label: "Checks",
				value: input.checksLabel ?? null,
			},
		],
		actions: [
			{
				id: AGENT_PANEL_ACTION_IDS.review.openFullscreen,
				label: input.isBusy ? "Preparing" : "Open review",
				state: input.isBusy ? "busy" : "enabled",
			},
		],
	};
}

export function buildDesktopWorktreeCard(
	input: DesktopWorktreeCardInput | null | undefined
): AgentPanelCardModel | null {
	if (!input) {
		return null;
	}

	return {
		id: "worktree-setup-card",
		kind: "worktree_setup",
		title: "Worktree setup",
		description: input.description,
		meta: [
			{
				id: "worktree-stage",
				label: "Stage",
				value: input.stageLabel ?? null,
			},
			{
				id: "worktree-progress",
				label: "Progress",
				value: input.progressLabel ?? null,
			},
		],
		actions: [
			{
				id: AGENT_PANEL_ACTION_IDS.worktree.create,
				label: "Creating",
				state: "busy",
			},
		],
	};
}

export function buildDesktopInstallCard(
	input: DesktopInstallCardInput | null | undefined
): AgentPanelCardModel | null {
	if (!input) {
		return null;
	}

	return {
		id: "agent-install-card",
		kind: "install",
		title: "Agent install",
		description: input.description,
		meta: [
			{
				id: "install-stage",
				label: "Stage",
				value: input.stageLabel ?? null,
			},
			{
				id: "install-progress",
				label: "Progress",
				value: input.progressLabel ?? null,
			},
		],
		actions: [
			{
				id: AGENT_PANEL_ACTION_IDS.status.install,
				label: "Install",
				state: "busy",
			},
		],
	};
}

export function buildDesktopErrorCard(
	input: DesktopErrorCardInput | null | undefined
): AgentPanelCardModel | null {
	if (!input) {
		return null;
	}

	return {
		id: "error-card",
		kind: "error",
		title: input.title,
		description: input.description,
		meta: [
			{
				id: "error-details",
				label: "Details",
				value: input.details ?? null,
			},
		],
		actions: [
			{
				id: AGENT_PANEL_ACTION_IDS.status.retry,
				label: "Retry",
				state: "enabled",
			},
			{
				id: AGENT_PANEL_ACTION_IDS.header.createIssueReport,
				label: "Report issue",
				state: "enabled",
			},
		],
	};
}
