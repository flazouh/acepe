import type { ContentBlock } from "../../services/converted-session-types.js";
import type { SessionId } from "./session-id.js";

/**
 * Prompt request for sending a message to an ACP session.
 *
 * @see https://agentclientprotocol.com/protocol/#prompt
 */
export type PromptRequest = {
	/**
	 * Session ID to send the prompt to.
	 */
	sessionId: SessionId;

	/**
	 * Content blocks to send as the prompt.
	 */
	content: ContentBlock[];
};
