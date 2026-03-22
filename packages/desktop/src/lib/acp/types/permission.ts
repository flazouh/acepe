/**
 * Permission request from the agent.
 *
 * Represents a permission prompt that requires user interaction.
 */
export interface PermissionRequest {
	/**
	 * Unique identifier for this permission request.
	 */
	id: string;

	/**
	 * The session this permission belongs to.
	 */
	sessionId: string;

	/**
	 * The JSON-RPC request ID for this permission request.
	 * Used to send the response back to the ACP subprocess.
	 * Only present for ACP mode (not OpenCode HTTP mode).
	 */
	jsonRpcRequestId?: number;

	/**
	 * The permission being requested (e.g., "ReadFile", "RunCommand").
	 */
	permission: string;

	/**
	 * Patterns or paths the permission applies to.
	 */
	patterns: string[];

	/**
	 * Additional metadata about the permission request.
	 */
	metadata: Record<string, unknown>;

	/**
	 * Options that should be shown as "always allow" choices.
	 */
	always: string[];

	/**
	 * Optional reference to the tool call that triggered this permission.
	 */
	tool?: {
		messageID: string;
		callID: string;
	};
}

/**
 * Response to a permission request.
 */
export type PermissionReply = "once" | "always" | "reject";

/**
 * Permission update event from the ACP protocol.
 */
export type PermissionUpdate = {
	type: "permissionRequest";
	permission: PermissionRequest;
};

/**
 * Permission reply request to send to the backend.
 */
export interface PermissionReplyRequest {
	id: string;
	reply: PermissionReply;
}
