/**
 * A skill with its metadata and content.
 */
export interface Skill {
	/** Unique identifier in format "agent_id::folder_name" */
	id: string;
	/** Agent this skill belongs to */
	agentId: string;
	/** Skill folder name (without path) */
	folderName: string;
	/** Full path to the SKILL.md file */
	path: string;
	/** Skill name from frontmatter */
	name: string;
	/** Description from frontmatter */
	description: string;
	/** Raw content of the SKILL.md file */
	content: string;
	/** Last modified timestamp (Unix millis) */
	modifiedAt: number;
}
