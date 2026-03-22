import type { SessionId } from "./session-id.js";
import type { SessionModelState } from "./session-model-state.js";
import type { SessionModes } from "./session-modes.js";

/**
 * Response from the session/new ACP protocol method.
 *
 * Contains the session ID and initial state including
 * available models and modes.
 *
 * @see https://agentclientprotocol.com/protocol/#sessionnew
 */
export type NewSessionResponse = {
	/**
	 * Unique identifier for the newly created session.
	 */
	sessionId: SessionId;

	/**
	 * Model state for this session.
	 */
	models: SessionModelState;

	/**
	 * Mode state for this session.
	 */
	modes: SessionModes;
};
