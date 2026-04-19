/**
 * Session Event Handler Interface
 *
 * Narrow interface defining what SessionEventService needs from a store.
 * This breaks the circular dependency between SessionEventService and SessionStore.
 */

import type { ResultAsync } from "neverthrow";

import type {
	ConfigOptionData,
	ContentBlock,
	ToolCallData,
} from "../../services/converted-session-types.js";
import type { SessionStateEnvelope } from "../../services/acp-types.js";
import type { AppError } from "../errors/app-error.js";
import type { AvailableCommand } from "../types/available-command.js";
import type { ToolCallUpdate } from "../types/tool-call.js";
import type { TurnCompleteUpdate, TurnErrorUpdate } from "../types/turn-error.js";
import type { SessionCold, SessionEntry, SessionHotState } from "./types.js";

/**
 * Interface for handling session events.
 *
 * SessionStore implements this interface, allowing SessionEventService
 * to depend on the interface rather than the concrete class.
 */
export interface SessionEventHandler {
	/**
	 * Get session cold data by ID from the store.
	 */
	getSessionCold(sessionId: string): SessionCold | undefined;

	/**
	 * Check if a session's entries have been preloaded from disk.
	 */
	isPreloaded(sessionId: string): boolean;

	/**
	 * Get entries for a session.
	 */
	getEntries(sessionId: string): SessionEntry[];

	/**
	 * Get hot state for a session.
	 */
	getHotState(sessionId: string): SessionHotState;

	/**
	 * Aggregate an assistant message chunk into the appropriate entry.
	 */
	aggregateAssistantChunk(
		sessionId: string,
		chunk: { content: ContentBlock },
		messageId: string | undefined,
		isThought: boolean
	): ResultAsync<void, AppError>;

	/**
	 * Aggregate a user message chunk into the latest user entry or create a new one.
	 */
	aggregateUserChunk(
		sessionId: string,
		chunk: { content: ContentBlock }
	): ResultAsync<void, AppError>;

	/**
	 * Create a new tool call entry.
	 */
	createToolCallEntry(sessionId: string, toolCallData: ToolCallData): void;

	/**
	 * Update an existing tool call entry.
	 */
	updateToolCallEntry(sessionId: string, update: ToolCallUpdate): void;

	/**
	 * Update available commands for a session.
	 */
	updateAvailableCommands(sessionId: string, commands: AvailableCommand[]): void;

	/**
	 * Ensure the session is in streaming state.
	 */
	ensureStreamingState(sessionId: string): void;

	/**
	 * Handle an incoming stream entry.
	 */
	handleStreamEntry(sessionId: string, entry: SessionEntry): void;

	/**
	 * Handle stream completion for a session.
	 * Called when the agent's turn is complete.
	 */
	handleStreamComplete(sessionId: string, turnId?: TurnCompleteUpdate["turn_id"]): void;

	/**
	 * Handle a turn error for a session.
	 * Called when the agent's turn fails with an error (e.g., usage limit).
	 */
	handleTurnError(sessionId: string, update: TurnErrorUpdate): void;

	/**
	 * Clear in-progress assistant streaming aggregation state.
	 * Used when a user chunk appears between assistant chunks to force a new assistant entry.
	 */
	clearStreamingAssistantEntry(sessionId: string): void;

	/**
	 * Update the current mode for a session.
	 * Called when the agent switches modes (e.g., entering plan mode).
	 */
	updateCurrentMode(sessionId: string, modeId: string): void;

	/**
	 * Update config options for a session.
	 * Called when a configOptionUpdate session update is received.
	 * Stores all config options (not just mode) for UI rendering.
	 */
	updateConfigOptions(sessionId: string, configOptions: ConfigOptionData[]): void;

	/**
	 * Update usage telemetry for a session (spend + tokens).
	 * Called when a usageTelemetryUpdate session update is received.
	 */
	updateUsageTelemetry(
		sessionId: string,
		telemetry: import("./types.js").SessionUsageTelemetry
	): void;

	applySessionStateEnvelope(sessionId: string, envelope: SessionStateEnvelope): void;
}
