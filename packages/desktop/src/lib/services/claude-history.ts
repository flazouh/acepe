import type { ResultAsync } from "neverthrow";
import { LOGGER_IDS } from "../acp/constants/logger-ids.js";
import { createLogger } from "../acp/utils/logger.js";
import { tauriClient } from "../utils/tauri-client.js";
import type { SessionPlanResponse } from "./converted-session-types.js";

export class SessionHistoryService {
	private readonly logger = createLogger({
		id: LOGGER_IDS.CLAUDE_HISTORY_SERVICE,
		name: "Session History Service",
	});

	/**
	 * Get the plan associated with a session through the unified history pipeline.
	 */
	getUnifiedPlan(
		sessionId: string,
		projectPath: string,
		agentId: string
	): ResultAsync<SessionPlanResponse | null, Error> {
		this.logger.debug("Getting unified session plan:", sessionId, agentId);
		return tauriClient.history
			.getUnifiedPlan(sessionId, projectPath, agentId)
			.mapErr((e) => new Error(`Failed to get unified plan: ${e}`))
			.map((plan) => {
				if (plan) {
					this.logger.debug("Found unified plan for session:", sessionId, plan.slug);
				} else {
					this.logger.debug("No unified plan found for session:", sessionId);
				}
				return plan;
			});
	}
}

// Re-export types for convenience
export type { ContentBlock, SessionPlanResponse } from "./converted-session-types.js";
