import { describe, expect, it } from "vitest";

import type { CreatedPendingSessionResult } from "../services/session-connection-manager.js";
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

describe("SessionCreationCoordinator", () => {
	describe("pending creation lifecycle", () => {
		it("registers pending creation and clears on complete", () => {
			const coordinator = new SessionCreationCoordinator({});
			const pending = createPendingResult();

			coordinator.beginPendingCreation(pending.sessionId, pending);

			expect(coordinator.hasPendingCreation(pending.sessionId)).toBe(true);
			expect(coordinator.getPendingCreation(pending.sessionId)).toEqual(pending);

			coordinator.completePendingCreation(pending.sessionId);

			expect(coordinator.hasPendingCreation(pending.sessionId)).toBe(false);
			expect(coordinator.getPendingCreation(pending.sessionId)).toBeNull();
		});

		it("registers the optimistic session row for a pending creation", () => {
			const registered: CreatedPendingSessionResult[] = [];
			const coordinator = new SessionCreationCoordinator({
				registerOptimisticSession: (result) => registered.push(result),
			});
			const pending = createPendingResult();

			coordinator.beginPendingCreation(pending.sessionId, pending);

			expect(registered).toEqual([pending]);
		});
	});
});
