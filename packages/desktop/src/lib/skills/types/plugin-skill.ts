/**
 * A skill from a plugin (read-only).
 */
export interface PluginSkill {
	/** Unique identifier (plugin_id::folder_name) */
	id: string;
	/** Plugin this skill belongs to */
	pluginId: string;
	/** Skill folder name */
	folderName: string;
	/** Full path to SKILL.md */
	path: string;
	/** Skill name from frontmatter */
	name: string;
	/** Description from frontmatter */
	description: string;
	/** Raw content of SKILL.md */
	content: string;
	/** Last modified timestamp */
	modifiedAt: number;
}
