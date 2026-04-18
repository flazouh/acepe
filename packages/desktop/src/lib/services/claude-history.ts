import type { ResultAsync } from "neverthrow";
import { LOGGER_IDS } from "../acp/constants/logger-ids.js";
import { createLogger } from "../acp/utils/logger.js";
import { tauriClient } from "../utils/tauri-client.js";
import type { HistoryEntry } from "./claude-history-types.js";
import type { FullSession, SessionPlanResponse } from "./converted-session-types.js";

export type SessionMessage = {
	type: string;
	message?: {
		role: string;
		content: unknown[];
	};
	session_id: string;
	uuid: string;
	parent_uuid?: string;
	timestamp: string;
	cwd?: string;
	git_branch?: string;
	version?: string;
};

export class SessionHistoryService {
	private readonly logger = createLogger({
		id: LOGGER_IDS.CLAUDE_HISTORY_SERVICE,
		name: "Session History Service",
	});

	getHistory(): ResultAsync<HistoryEntry[], Error> {
		return tauriClient.history
			.getSessionHistory()
			.mapErr((e) => new Error(`Failed to get session history: ${e}`))
			.map((result) => {
				this.logger.info("Loaded", result.length, "threads from backend");

				// Filter out invalid entries (missing sessionId)
				const validEntries = result.filter((t) => t.sessionId && typeof t.sessionId === "string");
				if (validEntries.length !== result.length) {
					this.logger.warn(
						"Filtered out",
						result.length - validEntries.length,
						"invalid entries (missing sessionId)"
					);
				}

				if (validEntries.length > 0) {
					this.logger.debug(
						"Sample threads:",
						validEntries.slice(0, 5).map((t) => ({
							sessionId: t.sessionId.substring(0, 8),
							display: t.display?.substring(0, 50) || "no title",
							project: t.project || "no project",
						}))
					);
				}
				return validEntries;
			});
	}

	getSessionMessages(sessionId: string, projectPath: string): ResultAsync<SessionMessage[], Error> {
		return tauriClient.history
			.getSessionMessages(sessionId, projectPath)
			.mapErr((e) => new Error(`Failed to get session messages: ${e}`));
	}

	/**
	 * Get full session data with ordered messages, thinking blocks, tool calls, and stats.
	 * This parses the JSONL files directly and returns comprehensive session data.
	 *
	 * @param sessionId - The session ID to load
	 * @param projectPath - The project path for this session
	 * @returns Full session with all messages ordered by parentUuid chain
	 */
	getFullSession(sessionId: string, projectPath: string): ResultAsync<FullSession, Error> {
		this.logger.debug("Loading full session:", sessionId, "from", projectPath);

		return tauriClient.history
			.getFullSession(sessionId, projectPath)
			.mapErr((e) => new Error(`Failed to get full session: ${e}`))
			.map((result) => {
				this.logger.info(
					"Loaded full session:",
					result.session_id,
					"with",
					result.stats.total_messages,
					"messages,",
					result.stats.tool_uses,
					"tool calls,",
					result.stats.thinking_blocks,
					"thinking blocks"
				);
				return result;
			});
	}

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

// Singleton instance for shared use
let historyServiceInstance: SessionHistoryService | null = null;

/**
 * Get the singleton ClaudeHistoryService instance.
 * Use this instead of creating new instances to avoid memory overhead.
 */
export function getSessionHistoryService(): SessionHistoryService {
	if (!historyServiceInstance) {
		historyServiceInstance = new SessionHistoryService();
	}
	return historyServiceInstance;
}

// Re-export types for convenience
export type {
	ContentBlock,
	FullSession,
	OrderedMessage,
	SessionPlanResponse,
	SessionStats,
	StoredAssistantChunk,
	StoredAssistantMessage,
	StoredContentBlock,
	StoredEntry,
	StoredUserMessage,
	TokenUsage,
} from "./converted-session-types.js";
