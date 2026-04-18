/**
 * Session UI State Derivation
 *
 * Derives UI state from session machine state.
 * This is the single source of truth for UI rendering decisions.
 */

import type { SessionEntry } from "../application/dto/session-entry.js";
import type { SessionMachineSnapshot } from "./session-machine";

import { ConnectionState, ContentState } from "./session-machine";

/**
 * Derived UI state from session machine.
 * What the UI actually needs to render correctly.
 */
export interface SessionUIState {
	/** Show content loading spinner (content: loading) */
	showContentLoading: boolean;

	/** Show connection spinner (connection: connecting | warmingUp) */
	showConnecting: boolean;

	/** Show "Thinking_" - ONLY when awaiting AI response (connection: awaitingResponse) */
	showThinking: boolean;

	/** Show streaming animation (connection: streaming) - for typewriter effect on text */
	showStreaming: boolean;

	/** Show conversation entries (content: loaded) */
	showConversation: boolean;

	/** Show ready placeholder (content: unloaded | error, connection: ready) */
	showReady: boolean;

	/** Show any error state (content: error | connection: error) */
	showError: boolean;

	/** User can type input (connection: ready) */
	inputEnabled: boolean;

	/** Session is read-only (connection: disconnected) */
	isReadOnly: boolean;
}

export type ConnectionPhase = "disconnected" | "connecting" | "connected" | "failed";
export type ContentPhase = "empty" | "loading" | "loaded";
export type ActivityPhase = "idle" | "running" | "waiting_for_user";

/**
 * Canonical runtime contract for session lifecycle UI.
 * Panel/input/queue components should consume this shape to avoid split-brain state.
 */
export interface SessionRuntimeState {
	connectionPhase: ConnectionPhase;
	contentPhase: ContentPhase;
	activityPhase: ActivityPhase;
	canSubmit: boolean;
	canCancel: boolean;
	showStop: boolean;
	showThinking: boolean;
	showConnectingOverlay: boolean;
	showConversation: boolean;
	showReadyPlaceholder: boolean;
}

/**
 * Derive UI state from machine snapshot.
 *
 * This function contains the logic that fixes the "Thinking_" bug:
 * - showThinking is ONLY true when connection is awaitingResponse
 * - Content loading and connection can happen simultaneously
 * - UI can show content loading + connection spinner at the same time
 *
 * The XState machine is the single source of truth for connection state.
 *
 * @param state - Machine snapshot from XState
 */
export function deriveSessionUIState(state: SessionMachineSnapshot): SessionUIState {
	const { content, connection } = state;

	return {
		// Content loading spinner - independent of connection
		showContentLoading: content === ContentState.LOADING,

		// Connection spinner - can show alongside content loading
		showConnecting:
			connection === ConnectionState.CONNECTING || connection === ConnectionState.WARMING_UP,

		// "Thinking_" - THE FIX: ONLY when actually awaiting AI response
		showThinking: connection === ConnectionState.AWAITING_RESPONSE,

		// Streaming animation - for typewriter effect during response streaming
		showStreaming: connection === ConnectionState.STREAMING,

		// Show conversation when content is loaded
		showConversation: content === ContentState.LOADED,

		// Ready placeholder when connected but no content yet
		showReady: content !== ContentState.LOADED && connection === ConnectionState.READY,

		// Error state from either region
		showError: content === ContentState.ERROR || connection === ConnectionState.ERROR,

		// Input enabled when connection is ready
		inputEnabled: connection === ConnectionState.READY,

		// Read-only when not connected
		isReadOnly: connection === ConnectionState.DISCONNECTED,
	};
}

/**
 * Derive canonical runtime lifecycle state from machine snapshot.
 *
 * @param state - Machine snapshot from XState
 * @param lastEntry - Optional last session entry, used to detect the between-tool-calls gap
 *   (agent finished a tool but hasn't started generating its next content yet).
 */
export function deriveSessionRuntimeState(
	state: SessionMachineSnapshot,
	lastEntry?: SessionEntry | null
): SessionRuntimeState {
	const { content, connection } = state;

	const connectionPhase: ConnectionPhase =
		connection === ConnectionState.ERROR
			? "failed"
			: connection === ConnectionState.DISCONNECTED
				? "disconnected"
				: connection === ConnectionState.CONNECTING || connection === ConnectionState.WARMING_UP
					? "connecting"
					: "connected";

	const contentPhase: ContentPhase =
		content === ContentState.LOADING
			? "loading"
			: content === ContentState.LOADED
				? "loaded"
				: "empty";

	const activityPhase: ActivityPhase =
		connection === ConnectionState.AWAITING_RESPONSE
			? "waiting_for_user"
			: connection === ConnectionState.STREAMING || connection === ConnectionState.PAUSED
				? "running"
				: "idle";

	const isWaitingBetweenToolCalls =
		connection === ConnectionState.STREAMING &&
		lastEntry?.type === "tool_call" &&
		(lastEntry.message.status === "completed" || lastEntry.message.status === "failed");

	const showThinking =
		connection === ConnectionState.AWAITING_RESPONSE || isWaitingBetweenToolCalls;
	const isCancellable =
		connection === ConnectionState.AWAITING_RESPONSE || activityPhase === "running";

	return {
		connectionPhase,
		contentPhase,
		activityPhase,
		canSubmit:
			connection === ConnectionState.READY ||
			(connection === ConnectionState.DISCONNECTED && content === ContentState.LOADED),
		canCancel: isCancellable,
		showStop: isCancellable,
		showThinking,
		showConnectingOverlay: connectionPhase === "connecting" && contentPhase !== "loaded",
		showConversation: contentPhase === "loaded",
		showReadyPlaceholder: contentPhase !== "loaded" && connection === ConnectionState.READY,
	};
}

/**
 * Helper function to check if session is in a loading state (either region).
 */
export function isSessionLoading(state: SessionMachineSnapshot): boolean {
	return (
		state.content === ContentState.LOADING ||
		state.connection === ConnectionState.CONNECTING ||
		state.connection === ConnectionState.WARMING_UP
	);
}

/**
 * Helper function to check if session has any errors.
 */
export function hasSessionError(state: SessionMachineSnapshot): boolean {
	return state.content === ContentState.ERROR || state.connection === ConnectionState.ERROR;
}
