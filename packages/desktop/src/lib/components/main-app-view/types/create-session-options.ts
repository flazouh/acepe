/**
 * Options for creating a new session.
 */
export interface CreateSessionOptions {
	/**
	 * The agent ID to use for the session.
	 */
	agentId: string;

	/**
	 * The project path for the session.
	 */
	projectPath: string;

	/**
	 * Optional project name/title for the session.
	 */
	projectName?: string;
}
