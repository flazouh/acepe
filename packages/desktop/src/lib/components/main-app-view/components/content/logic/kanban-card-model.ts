import type {
	KanbanCardData,
	KanbanSceneCardData,
	KanbanSceneFooterData,
	KanbanSceneMenuAction,
	PrChecksItem,
} from "@acepe/ui";
import { COLOR_NAMES, Colors } from "@acepe/ui/colors";

import {
	isActiveCompactActivityKind,
	projectSessionPreviewActivity,
} from "$lib/acp/components/activity-entry/activity-entry-projection.js";
import type { Project } from "$lib/acp/logic/project-manager.svelte.js";
import type { Panel, PanelHotState } from "$lib/acp/store/types.js";
import type { ThreadBoardItem } from "$lib/acp/store/thread-board/thread-board-item.js";
import {
	deriveSessionTitleFromUserInput,
	formatRichSessionTitle,
	formatSessionTitleForDisplay,
} from "$lib/acp/store/session-title-policy.js";

export interface OptimisticKanbanCard {
	readonly panelId: string;
	readonly projectPath: string;
	readonly card: KanbanCardData;
}

export interface BuildKanbanCardInput {
	readonly item: ThreadBoardItem;
	readonly getAgentIcon: (agentId: string | null | undefined) => string;
	readonly onOpenPrCheckDetails: (detailsUrl: string) => void;
}

export function buildKanbanCard(input: BuildKanbanCardInput): KanbanCardData {
	const item = input.item;
	const isWorking = isActiveCompactActivityKind(item.state.activity.kind);
	const todoProgress = item.todoProgress
		? {
				current: item.todoProgress.current,
				total: item.todoProgress.total,
				label: item.todoProgress.label,
			}
		: null;
	const activityProjection = projectSessionPreviewActivity({
		activityKind: item.state.activity.kind,
		currentStreamingToolCall: item.currentStreamingToolCall,
		currentToolKind: item.currentToolKind,
		lastToolCall: item.lastToolCall,
		lastToolKind: item.lastToolKind,
		todoProgress,
	});
	const toolDisplay =
		activityProjection.selectedTool && activityProjection.toolKind !== "think"
			? activityProjection.selectedTool
			: null;

	const activityText: string | null = (() => {
		if (!isWorking) return null;
		if (toolDisplay) return null;
		return "Thinking...";
	})();

	const isStreaming = isWorking;
	const taskCard = (() => {
		if (
			!activityProjection.showTaskSubagentList ||
			activityProjection.taskSubagentTools.length === 0
		) {
			return null;
		}

		const summary = activityProjection.taskDescription
			? activityProjection.taskDescription
			: (activityProjection.taskSubagentSummaries[
					activityProjection.taskSubagentSummaries.length - 1
				] ?? null);
		if (!summary) {
			return null;
		}

		return {
			summary,
			isStreaming,
			latestTool: activityProjection.latestTaskSubagentTool,
			toolCalls: activityProjection.taskSubagentTools,
		};
	})();

	const latestTool = (() => {
		if (taskCard) return null;
		if (!isWorking) return null;
		return activityProjection.latestTool;
	})();
	const hasUnseenCompletion =
		item.status === "needs_review" ? false : item.state.attention.hasUnseenCompletion;
	const richTitleResult = formatRichSessionTitle(item.title, item.projectName);
	const prFooter = item.linkedPr
		? {
				prNumber: item.linkedPr.prNumber,
				state: item.linkedPr.state,
				title: item.linkedPr.title,
				url: item.linkedPr.url,
				additions: item.linkedPr.additions,
				deletions: item.linkedPr.deletions,
				isLoading: item.linkedPr.isLoading,
				hasResolvedDetails: item.linkedPr.hasResolvedDetails,
				checks: item.linkedPr.checks,
				isChecksLoading: item.linkedPr.isChecksLoading,
				hasResolvedChecks: item.linkedPr.hasResolvedChecks,
				onOpenCheck: (check: PrChecksItem) => {
					if (check.detailsUrl == null) {
						return;
					}
					input.onOpenPrCheckDetails(check.detailsUrl);
				},
			}
		: null;

	return {
		id: item.sessionId,
		title: richTitleResult.plainText,
		richTitle: richTitleResult.richText,
		agentIconSrc: input.getAgentIcon(item.agentId),
		agentLabel: item.agentId,
		isAutoMode: item.autonomousEnabled === true,
		projectName: item.projectName,
		projectColor: item.projectColor,
		projectIconSrc: item.projectIconSrc,
		activityText,
		isStreaming,
		modeId: item.currentModeId,
		diffInsertions: item.insertions,
		diffDeletions: item.deletions,
		errorText: item.connectionError
			? item.connectionError
			: item.state.connection === "error"
				? "Connection error"
				: null,
		todoProgress,
		taskCard,
		latestTool,
		hasUnseenCompletion,
		sequenceId: item.sequenceId,
		isWorktreeSession: Boolean(item.worktreePath),
		worktreeDeleted: item.worktreeDeleted ?? false,
		prFooter,
		hideHeaderDiff: prFooter !== null,
	};
}

export interface BuildOptimisticKanbanCardsInput {
	readonly panels: readonly Panel[];
	readonly projects: readonly Project[];
	readonly getPanelHotState: (panelId: string) => PanelHotState;
	readonly getAgentIcon: (agentId: string | null | undefined) => string;
}

export function buildOptimisticKanbanCards(
	input: BuildOptimisticKanbanCardsInput
): readonly OptimisticKanbanCard[] {
	const cards: OptimisticKanbanCard[] = [];

	for (const panel of input.panels) {
		if (panel.sessionId !== null || panel.projectPath === null || panel.selectedAgentId === null) {
			continue;
		}

		const hotState = input.getPanelHotState(panel.id);
		if (hotState.pendingUserEntry === null && hotState.pendingWorktreeSetup === null) {
			continue;
		}

		const project = input.projects.find((candidate) => candidate.path === panel.projectPath) ?? null;
		const entry = hotState.pendingUserEntry;
		const pendingText =
			entry && entry.type === "user" && entry.message.content.type === "text"
				? entry.message.content.text
				: "";
		const title = formatSessionTitleForDisplay(
			deriveSessionTitleFromUserInput(pendingText),
			project ? project.name : null
		);
		const activityText =
			hotState.pendingWorktreeSetup?.phase === "creating-worktree"
				? "Creating worktree..."
				: "Starting...";

		cards.push({
			panelId: panel.id,
			projectPath: panel.projectPath,
			card: {
				id: panel.id,
				title,
				agentIconSrc: input.getAgentIcon(panel.selectedAgentId),
				agentLabel: panel.selectedAgentId,
				isAutoMode: hotState.provisionalAutonomousEnabled,
				projectName: project ? project.name : "Unknown",
				projectColor: project ? project.color : Colors[COLOR_NAMES.PINK],
				projectIconSrc: project ? (project.iconPath ?? null) : null,
				activityText,
				isStreaming: true,
				modeId: null,
				diffInsertions: 0,
				diffDeletions: 0,
				errorText: null,
				todoProgress: null,
				taskCard: null,
				latestTool: null,
				hasUnseenCompletion: false,
				sequenceId: null,
				isWorktreeSession: Boolean(panel.worktreePath),
				worktreeDeleted: false,
				prFooter: null,
				hideHeaderDiff: false,
			},
		});
	}

	return cards;
}

export function buildKanbanSceneMenuActions(isDev: boolean): readonly KanbanSceneMenuAction[] {
	const actions: KanbanSceneMenuAction[] = [
		{ id: "copy-id", label: "Copy session ID" },
		{ id: "copy-title", label: "Copy session title" },
		{ id: "open-raw", label: "Open raw session file" },
		{ id: "open-in-acepe", label: "Open raw session in Acepe" },
		{ id: "export-markdown", label: "Export as Markdown" },
		{ id: "export-json", label: "Export as JSON" },
	];

	if (isDev) {
		actions.push({ id: "copy-streaming-log-path", label: "Copy Streaming Log Path" });
		actions.push({ id: "export-raw-streaming", label: "Open Streaming Log" });
	}

	return actions;
}

export interface BuildKanbanSceneCardInput {
	readonly card: KanbanCardData;
	readonly footer: KanbanSceneFooterData | null;
	readonly menuActions: readonly KanbanSceneMenuAction[];
	readonly showCloseAction: boolean;
}

export function buildKanbanSceneCard(input: BuildKanbanSceneCardInput): KanbanSceneCardData {
	const footer = input.footer;

	return {
		id: input.card.id,
		title: input.card.title,
		richTitle: input.card.richTitle,
		agentIconSrc: input.card.agentIconSrc,
		agentLabel: input.card.agentLabel,
		isAutoMode: input.card.isAutoMode,
		projectName: input.card.projectName,
		projectColor: input.card.projectColor,
		projectIconSrc: input.card.projectIconSrc,
		activityText: input.card.activityText,
		isStreaming: input.card.isStreaming,
		modeId: input.card.modeId,
		diffInsertions: input.card.diffInsertions,
		diffDeletions: input.card.diffDeletions,
		errorText: input.card.errorText,
		todoProgress: input.card.todoProgress,
		taskCard: input.card.taskCard,
		latestTool: input.card.latestTool,
		hasUnseenCompletion: input.card.hasUnseenCompletion,
		sequenceId: input.card.sequenceId,
		isWorktreeSession: input.card.isWorktreeSession ?? false,
		worktreeDeleted: input.card.worktreeDeleted ?? false,
		footer,
		prFooter: input.card.prFooter ?? null,
		menuActions: input.menuActions,
		showCloseAction: input.showCloseAction,
		hideBody: footer?.kind === "permission",
		flushFooter: false,
		hideHeaderDiff: input.card.hideHeaderDiff ?? false,
	};
}
