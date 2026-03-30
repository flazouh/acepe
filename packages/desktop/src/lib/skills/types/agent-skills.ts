import type { Skill } from "./skill.js";

/**
 * Parsed on-disk skills grouped by agent.
 */
export interface AgentSkills {
	/** Agent identifier (claude-code, cursor, codex) */
	agentId: string;
	/** Parsed skills discovered in this agent's skill directory */
	skills: Skill[];
}