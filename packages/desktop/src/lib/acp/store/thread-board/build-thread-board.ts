import { deriveSessionWorkProjection, selectSessionWorkBucket } from "../session-work-projection.js";

import type { ThreadBoardGroup, ThreadBoardItem, ThreadBoardSource } from "./thread-board-item.js";
import { THREAD_BOARD_STATUS_ORDER, type ThreadBoardStatus } from "./thread-board-status.js";

export interface ThreadBoardStatusInput {
	readonly currentModeId: string | null;
	readonly connectionError: string | null;
	readonly state: ThreadBoardSource["state"];
}

export function classifyThreadBoardState(input: ThreadBoardStatusInput): ThreadBoardStatus {
	return selectSessionWorkBucket(
		deriveSessionWorkProjection({
			state: input.state,
			currentModeId: input.currentModeId,
			connectionError: input.connectionError,
		})
	);
}

export function classifyThreadBoardStatus(source: ThreadBoardSource): ThreadBoardStatus {
	return classifyThreadBoardState({
		currentModeId: source.currentModeId,
		connectionError: source.connectionError,
		state: source.state,
	});
}

function toThreadBoardItem(source: ThreadBoardSource, status: ThreadBoardStatus): ThreadBoardItem {
	return {
		panelId: source.panelId,
		sessionId: source.sessionId,
		agentId: source.agentId,
		autonomousEnabled: source.autonomousEnabled,
		projectPath: source.projectPath,
		projectName: source.projectName,
		projectColor: source.projectColor,
		projectIconSrc: source.projectIconSrc,
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
		sequenceId: source.sequenceId ?? null,
		worktreePath: source.worktreePath ?? null,
		worktreeDeleted: source.worktreeDeleted ?? false,
		status,
	};
}

function sortItems(items: ThreadBoardItem[]): void {
	items.sort((left, right) => right.lastActivityAt - left.lastActivityAt);
}

export function buildThreadBoard(
	sources: readonly ThreadBoardSource[]
): readonly ThreadBoardGroup[] {
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

	sortItems(answerNeeded);
	sortItems(planning);
	sortItems(working);
	sortItems(needsReview);
	sortItems(idle);
	sortItems(error);

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
