/**
 * Available mode information.
 *
 * Represents a mode that can be used in an ACP session.
 *
 * @see https://agentclientprotocol.com/protocol/#availablemode
 */
export type AvailableMode = {
	/**
	 * Unique identifier for the mode.
	 */
	id: string;

	/**
	 * Human-readable name of the mode.
	 */
	name: string;

	/**
	 * Optional description of the mode.
	 */
	description?: string;
};
