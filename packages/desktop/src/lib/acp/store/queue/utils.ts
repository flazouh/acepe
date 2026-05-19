/**
 * Queue utilities - Helper functions for building queue items.
 */

import type { SessionStatus } from "../../application/dto/session-status.js";
import { extractTodoProgressFromToolCall } from "../../components/session-list/session-list-logic.js";
import type { PlanApprovalInteraction } from "../../types/interaction.js";
import type { PermissionRequest } from "../../types/permission.js";
import type { QuestionRequest } from "../../types/question.js";
import type { ToolCall } from "../../types/tool-call.js";
import type { ToolKind } from "../../types/tool-kind.js";
import type { ActiveTurnFailure } from "../../types/turn-error.js";
import { computeStatsFromCheckpoints } from "../../utils/checkpoint-diff-utils.js";
import { extractProjectName } from "../../utils/path-utils.js";
import { generateFallbackProjectColor } from "../../utils/project-utils.js";
import { checkpointStore } from "../checkpoint-store.svelte.js";
import {
	deriveLiveSessionState,
	deriveLiveSessionWorkProjection,
	type LiveSessionWorkSource,
} from "../live-session-work.js";
import type { SessionOperationInteractionSnapshot } from "../operation-association.js";
import { deriveSessionState, statusToConnectionState } from "../session-state.js";
import {
	selectSessionStatusForPresentation,
	selectSessionWorkBucket,
	type SessionWorkBucket,
} from "../session-work-projection.js";
import type { UrgencyInfo } from "../urgency.js";
import { deriveUrgency } from "../urgency.js";
import type { QueueItem } from "./types.js";

// Re-export section utilities from queue-section-utils.ts (kept separate for testability)
export {
	classifyItem,
	groupIntoSections,
	isNeedsReview,
	type QueueSectionGroup,
	type QueueSectionId,
} from "./queue-section-utils.js";

export interface QueueSessionSnapshot {
	readonly id: string;
	readonly agentId: string;
	readonly projectPath: string;
	readonly title: string | null;
	readonly currentStreamingToolCall: ToolCall | null;
	readonly currentToolKind: ToolKind | "other" | null;
	readonly lastToolCall: ToolCall | null;
	readonly lastTodoToolCall: ToolCall | null;
	readonly state: ReturnType<typeof deriveSessionState>;
	readonly isStreaming: boolean;
	readonly isThinking: boolean;
	readonly status: SessionStatus;
	readonly workBucket: SessionWorkBucket;
	readonly updatedAt: Date;
	readonly currentModeId: string | null;
	/** Connection/agent error message (e.g. acp_resume_session failure) */
	readonly connectionError?: string | null;
	readonly activeTurnFailure?: ActiveTurnFailure | null;
}

export interface BuildQueueSessionSnapshotInput {
	readonly id: string;
	readonly agentId: string;
	readonly projectPath: string;
	readonly title: string | null;
	readonly currentStreamingToolCall: ToolCall | null;
	readonly currentToolKind: ToolKind | "other" | null;
	readonly lastToolCall: ToolCall | null;
	readonly lastTodoToolCall: ToolCall | null;
	readonly updatedAt: Date;
	readonly currentModeId: string | null;
	readonly connectionError: string | null;
	readonly activeTurnFailure: ActiveTurnFailure | null;
	readonly liveSessionSource: LiveSessionWorkSource;
	readonly interactionSnapshot: Pick<
		SessionOperationInteractionSnapshot,
		"pendingPlanApproval" | "pendingPermission" | "pendingQuestion"
	>;
	readonly hasUnseenCompletion: boolean;
}

/**
 * Calculate total insertions and deletions for a session.
 * Uses checkpoint data only; returns 0/0 when checkpoints lack stats.
 */
function computeSessionDiffStats(session: QueueSessionSnapshot): {
	insertions: number;
	deletions: number;
} {
	const checkpoints = checkpointStore.getCheckpoints(session.id);
	const stats = computeStatsFromCheckpoints(checkpoints);
	return stats ?? { insertions: 0, deletions: 0 };
}

/**
 * Color lookup function type.
 * Returns the project color for a given path, or null if not found.
 */
export type ProjectColorLookup = (projectPath: string) => string | null;
export type ProjectIconSrcLookup = (projectPath: string) => string | null;

export interface QueueSessionStateInput {
	readonly isStreaming: boolean;
	readonly isThinking: boolean;
	readonly status: SessionStatus;
	readonly currentModeId: string | null;
	readonly currentStreamingToolCall: ToolCall | null;
	readonly pendingQuestion: QuestionRequest | null;
	readonly pendingPlanApproval: PlanApprovalInteraction | null;
	readonly pendingPermission: PermissionRequest | null;
	readonly hasUnseenCompletion: boolean;
}

export function deriveQueueSessionState(input: QueueSessionStateInput) {
	const connectionState = input.isThinking
		? "awaitingResponse"
		: input.isStreaming
			? "streaming"
			: statusToConnectionState(input.status);

	return deriveSessionState({
		connectionState,
		modeId: input.currentModeId,
		tool: input.currentStreamingToolCall,
		pendingQuestion: input.pendingQuestion,
		pendingPlanApproval: input.pendingPlanApproval,
		pendingPermission: input.pendingPermission,
		hasUnseenCompletion: input.hasUnseenCompletion,
	});
}

export function buildQueueSessionSnapshot(
	input: BuildQueueSessionSnapshotInput
): QueueSessionSnapshot {
	const state = deriveLiveSessionState({
		source: input.liveSessionSource,
		currentModeId: input.currentModeId,
		interactionSnapshot: input.interactionSnapshot,
		hasUnseenCompletion: input.hasUnseenCompletion,
	});
	const workProjection = deriveLiveSessionWorkProjection({
		source: input.liveSessionSource,
		currentModeId: input.currentModeId,
		interactionSnapshot: input.interactionSnapshot,
		hasUnseenCompletion: input.hasUnseenCompletion,
	});

	return {
		id: input.id,
		agentId: input.agentId,
		projectPath: input.projectPath,
		title: input.title,
		currentStreamingToolCall: input.currentStreamingToolCall,
		currentToolKind: input.currentToolKind,
		lastToolCall: input.lastToolCall,
		lastTodoToolCall: input.lastTodoToolCall,
		state,
		isStreaming: workProjection.compactActivityKind === "streaming",
		isThinking: workProjection.compactActivityKind === "thinking",
		status: selectSessionStatusForPresentation(workProjection),
		workBucket: selectSessionWorkBucket(workProjection),
		updatedAt: input.updatedAt,
		currentModeId: input.currentModeId,
		connectionError: input.connectionError,
		activeTurnFailure: input.activeTurnFailure,
	};
}

/**
 * Build a QueueItem from session data.
 */
export function buildQueueItem(
	session: QueueSessionSnapshot,
	panelId: string | null,
	urgency: UrgencyInfo,
	_hasPendingQuestion: boolean,
	_hasPendingPermission: boolean,
	hasUnseenCompletion: boolean,
	pendingQuestionText: string | null,
	pendingQuestion: QuestionRequest | null,
	pendingPlanApproval: PlanApprovalInteraction | null,
	pendingPermission: PermissionRequest | null,
	getProjectColor?: ProjectColorLookup,
	getProjectIconSrc?: ProjectIconSrcLookup
): QueueItem {
	const pendingText = pendingQuestionText ?? null;
	const projectColor =
		getProjectColor?.(session.projectPath) ?? generateFallbackProjectColor(session.projectPath);
	const projectIconSrc = getProjectIconSrc?.(session.projectPath) ?? null;

	const diffStats = computeSessionDiffStats(session);
	const todoProgress = extractTodoProgressFromToolCall(session.lastTodoToolCall);

	return {
		sessionId: session.id,
		panelId,
		agentId: session.agentId,
		projectPath: session.projectPath,
		projectName: extractProjectName(session.projectPath),
		projectColor,
		projectIconSrc,
		title: session.title,
		urgency,
		pendingText,
		todoProgress,
		lastActivityAt: session.updatedAt.getTime(),
		currentToolKind:
			session.currentToolKind ?? (session.currentStreamingToolCall !== null ? "other" : null),
		currentStreamingToolCall: session.currentStreamingToolCall,
		lastToolKind: session.lastToolCall?.kind ?? null,
		lastToolCall: session.lastToolCall,
		currentModeId: session.currentModeId,
		insertions: diffStats.insertions,
		deletions: diffStats.deletions,
		pendingQuestion,
		pendingPlanApproval,
		status: session.status,
		workBucket: session.workBucket,
		connectionError: session.connectionError ?? null,
		activeTurnFailure: session.activeTurnFailure ?? null,
		state: session.state,
	};
}

/**
 * Calculate urgency for a session.
 * Uses the canonical-derived queue snapshot status plus canonical failure fields.
 */
export function calculateSessionUrgency(
	session: QueueSessionSnapshot,
	hasPendingQuestion: boolean,
	pendingQuestionText: string | null
): UrgencyInfo {
	return deriveUrgency({
		status: session.status,
		hasPendingQuestion,
		pendingQuestionText,
		statusChangedAt: session.updatedAt.getTime(),
		connectionError: session.connectionError ?? null,
		activeTurnFailure: session.activeTurnFailure ?? null,
	});
}
