/**
 * Represents an AI agent that can have skills.
 */
export interface SkillAgent {
	/** Agent identifier (claude-code, cursor, codex) */
	id: string;
	/** Display name for the agent */
	name: string;
	/** Full path to the skills directory */
	skillsDir: string;
	/** Whether the skills directory exists on disk */
	exists: boolean;
}
