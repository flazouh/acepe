import type { ActivityState } from "../session-state.js";

import type { ThreadBoardGroup, ThreadBoardItem, ThreadBoardSource } from "./thread-board-item.js";
import { THREAD_BOARD_STATUS_ORDER, type ThreadBoardStatus } from "./thread-board-status.js";

function isActiveActivity(activity: ActivityState): boolean {
	return activity.kind === "streaming" || activity.kind === "thinking";
}

function resolveEffectiveModeId(source: ThreadBoardSource): string | null {
	if (source.currentModeId !== null) {
		return source.currentModeId;
	}

	if (source.state.activity.kind === "streaming") {
		return source.state.activity.modeId;
	}

	return null;
}

export function classifyThreadBoardStatus(source: ThreadBoardSource): ThreadBoardStatus {
	const pendingInput = source.state.pendingInput;
	if (pendingInput.kind !== "none") {
		return "answer_needed";
	}

	if (source.state.connection === "error" || source.connectionError !== null) {
		return "error";
	}

	if (isActiveActivity(source.state.activity)) {
		const modeId = resolveEffectiveModeId(source);
		if (modeId === "plan") {
			return "planning";
		}
		return "working";
	}

	if (source.state.activity.kind === "paused") {
		return "working";
	}

	if (source.state.attention.hasUnseenCompletion) {
		return "needs_review";
	}

	return "idle";
}

function toThreadBoardItem(source: ThreadBoardSource, status: ThreadBoardStatus): ThreadBoardItem {
	return {
		panelId: source.panelId,
		sessionId: source.sessionId,
		agentId: source.agentId,
		projectPath: source.projectPath,
		projectName: source.projectName,
		projectColor: source.projectColor,
		title: source.title,
		lastActivityAt: source.lastActivityAt,
		currentModeId: source.currentModeId,
		currentToolKind: source.currentToolKind,
		currentStreamingToolCall: source.currentStreamingToolCall,
		lastToolKind: source.lastToolKind,
		lastToolCall: source.lastToolCall,
		insertions: source.insertions,
		deletions: source.deletions,
		todoProgress: source.todoProgress,
		connectionError: source.connectionError,
		state: source.state,
		status,
	};
}

function sortByLastActivityDesc(items: ThreadBoardItem[]): void {
	items.sort((left, right) => right.lastActivityAt - left.lastActivityAt);
}

export function buildThreadBoard(sources: readonly ThreadBoardSource[]): readonly ThreadBoardGroup[] {
	const answerNeeded: ThreadBoardItem[] = [];
	const planning: ThreadBoardItem[] = [];
	const working: ThreadBoardItem[] = [];
	const needsReview: ThreadBoardItem[] = [];
	const idle: ThreadBoardItem[] = [];
	const error: ThreadBoardItem[] = [];

	for (const source of sources) {
		const status = classifyThreadBoardStatus(source);
		const item = toThreadBoardItem(source, status);

		if (status === "answer_needed") {
			answerNeeded.push(item);
			continue;
		}
		if (status === "planning") {
			planning.push(item);
			continue;
		}
		if (status === "working") {
			working.push(item);
			continue;
		}
		if (status === "needs_review") {
			needsReview.push(item);
			continue;
		}
		if (status === "idle") {
			idle.push(item);
			continue;
		}
		error.push(item);
	}

	sortByLastActivityDesc(answerNeeded);
	sortByLastActivityDesc(planning);
	sortByLastActivityDesc(working);
	sortByLastActivityDesc(needsReview);
	sortByLastActivityDesc(idle);
	sortByLastActivityDesc(error);

	const groupsByStatus = new Map<ThreadBoardStatus, readonly ThreadBoardItem[]>();
	groupsByStatus.set("answer_needed", answerNeeded);
	groupsByStatus.set("planning", planning);
	groupsByStatus.set("working", working);
	groupsByStatus.set("needs_review", needsReview);
	groupsByStatus.set("idle", idle);
	groupsByStatus.set("error", error);

	return THREAD_BOARD_STATUS_ORDER.map((status) => ({
		status,
		items: groupsByStatus.get(status) ? groupsByStatus.get(status)! : [],
	}));
}