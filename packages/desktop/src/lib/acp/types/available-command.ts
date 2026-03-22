/**
 * Available command from the ACP protocol.
 *
 * Represents a slash command that can be executed by the agent.
 */
export type AvailableCommand = {
	/**
	 * Command name (without the leading slash).
	 * Examples: "compact", "review", "mcp:github"
	 */
	name: string;

	/**
	 * Human-readable description of what the command does.
	 */
	description: string;

	/**
	 * Optional input hint for command arguments.
	 * If present, shows a hint for what arguments the command accepts.
	 */
	input?: {
		hint: string;
	} | null;
};
