import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TurnErrorUpdate } from "../../types/turn-error.js";
import type { CreatedPendingSessionResult } from "../services/session-connection-manager.js";
import type { SessionMessagingService } from "../services/session-messaging-service.js";
import { SessionCreationCoordinator } from "../session-creation-coordinator.svelte.js";

function createPendingResult(
	overrides: Partial<CreatedPendingSessionResult> = {}
): CreatedPendingSessionResult {
	return {
		kind: "pending",
		sessionId: overrides.sessionId ?? "pending-session-1",
		creationAttemptId: overrides.creationAttemptId ?? "attempt-1",
		projectPath: overrides.projectPath ?? "/repo",
		projectName: overrides.projectName ?? "repo",
		projectColor: overrides.projectColor ?? "#FF5D5A",
		managed: true,
		sequenceId: overrides.sequenceId ?? 1,
		agentId: overrides.agentId ?? "claude-code",
		title: overrides.title ?? "Test Thread",
		worktreePath: overrides.worktreePath ?? null,
	};
}

const turnErrorUpdate = {
	type: "turnError" as const,
	session_id: "pending-session-1",
	turn_id: "turn-1",
	error: {
		message: "Creation failed",
		kind: "fatal" as const,
		source: "transport" as const,
	},
};

describe("SessionCreationCoordinator", () => {
	let handleCanonicalTurnFailure: ReturnType<
		typeof vi.fn<(sessionId: string, update: TurnErrorUpdate) => void>
	>;
	let onTurnError: ReturnType<typeof vi.fn<(sessionId: string) => void>>;
	let coordinator: SessionCreationCoordinator;

	beforeEach(() => {
		handleCanonicalTurnFailure = vi.fn<(sessionId: string, update: TurnErrorUpdate) => void>();
		onTurnError = vi.fn<(sessionId: string) => void>();
		coordinator = new SessionCreationCoordinator({
			messagingSvc: {
				handleCanonicalTurnFailure,
			} as unknown as SessionMessagingService,
			onTurnError,
		});
	});

	describe("pending creation lifecycle", () => {
		it("registers pending creation and clears on complete", () => {
			const pending = createPendingResult();

			coordinator.beginPendingCreation(pending.sessionId, pending);

			expect(coordinator.hasPendingCreation(pending.sessionId)).toBe(true);
			expect(coordinator.getPendingCreation(pending.sessionId)).toEqual(pending);

			coordinator.completePendingCreation(pending.sessionId);

			expect(coordinator.hasPendingCreation(pending.sessionId)).toBe(false);
			expect(coordinator.getPendingCreation(pending.sessionId)).toBeNull();
		});

		it("fails pending creation with messaging and callback", () => {
			const pending = createPendingResult();
			coordinator.beginPendingCreation(pending.sessionId, pending);

			coordinator.failPendingCreation(pending.sessionId, turnErrorUpdate);

			expect(handleCanonicalTurnFailure).toHaveBeenCalledWith(
				pending.sessionId,
				turnErrorUpdate
			);
			expect(onTurnError).toHaveBeenCalledWith(pending.sessionId);
			expect(coordinator.hasPendingCreation(pending.sessionId)).toBe(false);
		});

		it("no-ops fail when session is not pending", () => {
			coordinator.failPendingCreation("missing-session", turnErrorUpdate);

			expect(handleCanonicalTurnFailure).not.toHaveBeenCalled();
			expect(onTurnError).not.toHaveBeenCalled();
		});
	});
});
