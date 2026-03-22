/**
 * ACP Protocol method names.
 *
 * These constants define all available JSON-RPC methods in the
 * Agent Client Protocol specification.
 *
 * @see https://agentclientprotocol.com/protocol/
 */
export const ACP_METHODS = {
	/**
	 * Initialize the ACP connection.
	 *
	 * @see https://agentclientprotocol.com/protocol/#initialize
	 */
	INITIALIZE: "initialize",

	/**
	 * Create a new session.
	 *
	 * @see https://agentclientprotocol.com/protocol/#sessionnew
	 */
	SESSION_NEW: "session/new",

	/**
	 * Set the model for a session.
	 *
	 * @see https://agentclientprotocol.com/protocol/#sessionsetmodel
	 */
	SESSION_SET_MODEL: "session/set_model",

	/**
	 * Set the mode for a session.
	 *
	 * @see https://agentclientprotocol.com/protocol/#sessionsetmode
	 */
	SESSION_SET_MODE: "session/set_mode",

	/**
	 * Send a prompt to a session.
	 *
	 * @see https://agentclientprotocol.com/protocol/#prompt
	 */
	PROMPT: "session/prompt",

	/**
	 * Cancel a session.
	 *
	 * @see https://agentclientprotocol.com/protocol/#sessioncancel
	 */
	SESSION_CANCEL: "session/cancel",
} as const;

/**
 * Type for ACP method names.
 */
export type AcpMethod = (typeof ACP_METHODS)[keyof typeof ACP_METHODS];
