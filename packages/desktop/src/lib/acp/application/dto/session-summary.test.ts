import { describe, expect, it } from "vitest";

import type {
	LifecycleStatus,
	SessionGraphActionability,
	SessionGraphActivity,
	SessionGraphActivityKind,
	SessionGraphLifecycle,
	SessionTurnState,
} from "$lib/services/acp-types.js";
import type { CanonicalSessionProjection } from "../../store/canonical-session-projection.js";

import {
	buildSessionSummaryFromCold,
	deriveSessionListStateFromCanonical,
} from "./session-summary.js";

function actionability(status: LifecycleStatus): SessionGraphActionability {
	return {
		canSend: status === "ready",
		canResume: false,
		canRetry: status === "failed",
		canArchive: status === "ready",
		canConfigure: status === "ready",
		recommendedAction: status === "ready" ? "send" : "none",
		recoveryPhase: "none",
		compactStatus: status,
	};
}

function lifecycle(status: LifecycleStatus): SessionGraphLifecycle {
	return {
		status,
		detachedReason: null,
		failureReason: null,
		errorMessage: null,
		actionability: actionability(status),
	};
}

function activity(kind: SessionGraphActivityKind): SessionGraphActivity {
	return {
		kind,
		activeOperationCount: kind === "running_operation" ? 1 : 0,
		activeSubagentCount: 0,
		dominantOperationId: kind === "running_operation" ? "op-1" : null,
		blockingInteractionId: kind === "waiting_for_user" ? "interaction-1" : null,
	};
}

function projection(input: {
	readonly lifecycleStatus: LifecycleStatus;
	readonly activityKind: SessionGraphActivityKind;
	readonly turnState: SessionTurnState;
}): CanonicalSessionProjection {
	return {
		lifecycle: lifecycle(input.lifecycleStatus),
		activity: activity(input.activityKind),
		turnState: input.turnState,
		activeTurnFailure: null,
		lastTerminalTurnId: null,
		activeStreamingTail: null,
		capabilities: {},
		tokenStream: new Map(),
		clockAnchor: null,
		revision: {
			graphRevision: 1,
			transcriptRevision: 1,
			lastEventSeq: 1,
		},
	};
}

describe("deriveSessionListStateFromCanonical", () => {
	it("returns neutral state when the canonical projection is missing", () => {
		expect(deriveSessionListStateFromCanonical(null)).toEqual({
			status: "idle",
			isConnected: false,
			isStreaming: false,
		});
	});

	it.each([
		["activating", "connecting", false, false],
		["reconnecting", "connecting", false, false],
		["failed", "error", false, false],
		["reserved", "idle", false, false],
		["detached", "idle", false, false],
		["archived", "idle", false, false],
	] as const)("maps %s lifecycle to %s summary state", (lifecycleStatus, status, isConnected, isStreaming) => {
		expect(
			deriveSessionListStateFromCanonical(
				projection({
					lifecycleStatus,
					activityKind: "idle",
					turnState: "Idle",
				})
			)
		).toEqual({
			status,
			isConnected,
			isStreaming,
		});
	});

	it.each([
		["idle", "Idle", "ready", true, false],
		["running_operation", "Idle", "streaming", true, true],
		["awaiting_model", "Idle", "streaming", true, true],
		["waiting_for_user", "Idle", "streaming", true, true],
		["idle", "Running", "streaming", true, true],
		["paused", "Idle", "paused", true, false],
		["paused", "Running", "paused", true, false],
		["error", "Idle", "error", false, false],
		["error", "Running", "error", false, false],
		["idle", "Completed", "ready", true, false],
		["idle", "Failed", "ready", true, false],
	] as const)("maps ready lifecycle with %s activity and %s turn state", (activityKind, turnState, status, isConnected, isStreaming) => {
		expect(
			deriveSessionListStateFromCanonical(
				projection({
					lifecycleStatus: "ready",
					activityKind,
					turnState,
				})
			)
		).toEqual({
			status,
			isConnected,
			isStreaming,
		});
	});
});

describe("buildSessionSummaryFromCold", () => {
	it("centralizes cold session to summary field mapping", () => {
		const createdAt = new Date("2026-05-01T00:00:00.000Z");
		const updatedAt = new Date("2026-05-01T00:01:00.000Z");

		expect(
			buildSessionSummaryFromCold({
				cold: {
					id: "session-1",
					projectPath: "/repo",
					agentId: "codex",
					worktreePath: "/repo-worktree",
					title: "Build feature",
					createdAt,
					updatedAt,
					sourcePath: "/repo/session.json",
					sessionLifecycleState: "persisted",
					parentId: null,
					prNumber: 123,
					prState: "OPEN",
					prLinkMode: "manual",
					linkedPr: {
						prNumber: 123,
						state: "OPEN",
						url: "https://github.com/example/repo/pull/123",
						title: "Feature PR",
						additions: 10,
						deletions: 2,
						isDraft: false,
						isLoading: false,
						hasResolvedDetails: true,
						checksHeadSha: "abc123",
						checks: [],
						isChecksLoading: false,
						hasResolvedChecks: true,
					},
					worktreeDeleted: true,
					sequenceId: 7,
				},
				listState: {
					status: "streaming",
					isConnected: true,
					isStreaming: true,
				},
				entryCount: 5,
			})
		).toEqual({
			id: "session-1",
			projectPath: "/repo",
			agentId: "codex",
			worktreePath: "/repo-worktree",
			title: "Build feature",
			status: "streaming",
			entryCount: 5,
			isConnected: true,
			isStreaming: true,
			lastEntry: undefined,
			createdAt,
			updatedAt,
			parentId: null,
			prNumber: 123,
			prState: "OPEN",
			prLinkMode: "manual",
			linkedPr: {
				prNumber: 123,
				state: "OPEN",
				url: "https://github.com/example/repo/pull/123",
				title: "Feature PR",
				additions: 10,
				deletions: 2,
				isDraft: false,
				isLoading: false,
				hasResolvedDetails: true,
				checksHeadSha: "abc123",
				checks: [],
				isChecksLoading: false,
				hasResolvedChecks: true,
			},
			worktreeDeleted: true,
			sequenceId: 7,
		});
	});
});
