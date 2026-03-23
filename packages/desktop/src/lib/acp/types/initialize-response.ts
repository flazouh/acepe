/**
 * Response from the initialize ACP protocol method.
 *
 * Contains information about the agent's capabilities and
 * available authentication methods.
 *
 * @see https://agentclientprotocol.com/protocol/#initialize
 */
export type InitializeResponse = {
	/**
	 * Protocol version supported by the agent.
	 */
	protocolVersion: number;

	/**
	 * Capabilities of the agent.
	 *
	 * This is a flexible JSON object that may contain various
	 * capability flags and settings.
	 */
	agentCapabilities: Record<string, unknown>;

	/**
	 * Information about the agent.
	 *
	 * This is a flexible JSON object that may contain agent
	 * metadata such as name, version, etc.
	 */
	agentInfo: Record<string, unknown>;

	/**
	 * Available authentication methods.
	 *
	 * Array of authentication method objects that the agent supports.
	 */
	authMethods: Record<string, unknown>[];
};
