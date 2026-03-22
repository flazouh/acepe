import type { SessionModelState } from "./session-model-state.js";
import type { SessionModes } from "./session-modes.js";

/**
 * Response from the session/resume ACP protocol method.
 *
 * Per ACP protocol: ResumeSessionResponse does NOT include sessionId
 * because the session ID was already provided in the request.
 *
 * @see https://agentclientprotocol.com/protocol/#unstable-sessionresume
 */
export type ResumeSessionResponse = {
	/**
	 * Model state for this session.
	 */
	models: SessionModelState;

	/**
	 * Mode state for this session.
	 */
	modes: SessionModes;
};
