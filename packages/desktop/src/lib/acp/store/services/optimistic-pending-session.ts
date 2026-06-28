/**
 * optimistic-pending-session — builds the optimistic cold session record for a
 * deferred (pending) creation result.
 *
 * Deferred-creation providers (e.g. Claude Code via the cc_sdk bridge) return a
 * pending result before the canonical session graph materializes. The ready
 * path registers its cold record immediately; this helper lets the deferred
 * path do the same so the agent panel resolves identity + title (agent icon,
 * working spark, user-derived title) the instant a thread is created, instead
 * of waiting for canonical promotion. Canonical state remains the sole
 * authority — only identity/metadata is promoted early.
 */
import type { SessionCold } from "../types.js";
import type { CreatedPendingSessionResult } from "./session-connection-manager.js";

/**
 * Project a pending-creation result into the cold identity/metadata record that
 * lives in the single session registry. `now` is injected so the function stays
 * pure and testable.
 */
export function optimisticSessionColdFromPendingCreation(
	pending: CreatedPendingSessionResult,
	now: Date
): SessionCold {
	return {
		id: pending.sessionId,
		projectPath: pending.projectPath,
		agentId: pending.agentId,
		worktreePath: pending.worktreePath ?? undefined,
		title: pending.title ?? "New Thread",
		updatedAt: now,
		createdAt: now,
		sourcePath: undefined,
		sessionLifecycleState: "created",
		parentId: null,
		sequenceId: pending.sequenceId ?? undefined,
	};
}
