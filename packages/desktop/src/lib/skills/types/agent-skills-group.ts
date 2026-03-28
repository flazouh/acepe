import type { Skill } from "./skill.js";

/**
 * Parsed skills grouped by agent for startup consumers.
 */
export interface AgentSkillsGroup {
	/** Agent ID these skills belong to. */
	agentId: string;
	/** Parsed skills for this agent. */
	skills: Skill[];
}
