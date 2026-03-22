/**
 * ACP Protocol Method Names
 *
 * Type-safe constants for JSON-RPC method names used in ACP communication.
 * Using these constants prevents typos that would otherwise only be caught at runtime.
 */

/**
 * Inbound methods - requests FROM the ACP subprocess TO the client.
 */
export const ACP_INBOUND_METHODS = {
	/**
	 * Request permission from the user before executing a tool.
	 * Sent by the agent when it needs approval for an operation.
	 */
	REQUEST_PERMISSION: "session/request_permission",

	/**
	 * Terminal protocol methods - for executing commands in terminals.
	 * Per ACP spec: https://agentclientprotocol.com/protocol/terminals
	 */
	TERMINAL_CREATE: "terminal/create",
	TERMINAL_OUTPUT: "terminal/output",
	TERMINAL_WAIT_FOR_EXIT: "terminal/wait_for_exit",
	TERMINAL_KILL: "terminal/kill",
	TERMINAL_RELEASE: "terminal/release",

	/**
	 * File system protocol methods - for reading/writing files.
	 * Per ACP spec: https://agentclientprotocol.com/protocol/filesystem
	 */
	FS_READ_TEXT_FILE: "fs/read_text_file",
	FS_WRITE_TEXT_FILE: "fs/write_text_file",
} as const;

/**
 * Type representing all valid inbound method names.
 */
export type AcpInboundMethod = (typeof ACP_INBOUND_METHODS)[keyof typeof ACP_INBOUND_METHODS];
