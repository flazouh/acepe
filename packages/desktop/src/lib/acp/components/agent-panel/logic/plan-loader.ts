import * as Effect from "effect/Effect";

import type {
	SessionHistoryService,
	SessionPlanResponse,
} from "../../../../services/claude-history";

import { PlanLoadError } from "../errors";

/**
 * Loads a session plan from the Claude history service.
 *
 * @param service - Claude history service instance
 * @param sessionId - Session ID to load plan for
 * @param projectPath - Project path for the session
 * @param agentId - Agent ID for the session
 * @returns Result containing the plan or an error
 *
 * @example
 * ```ts
 * loadSessionPlan(service, "session-123", "/path/to/project")
 * ```
 */
export function loadSessionPlan(
	service: SessionHistoryService,
	sessionId: string,
	projectPath: string,
	agentId: string
): Effect.Effect<SessionPlanResponse | null, PlanLoadError> {
	return service.getUnifiedPlan(sessionId, projectPath, agentId).pipe(
		Effect.mapError(
			(err) =>
				new PlanLoadError("Failed to load session plan", {
					sessionId,
					projectPath,
					agentId,
					originalError: err.message,
				})
		)
	);
}
