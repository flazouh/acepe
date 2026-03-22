/**
 * A skill stored in the unified library (SQLite).
 */
export interface LibrarySkill {
	/** Unique skill ID (UUID) */
	id: string;
	/** Skill name */
	name: string;
	/** Optional description */
	description: string | null;
	/** Full SKILL.md content */
	content: string;
	/** Optional category for organization */
	category: string | null;
	/** Created timestamp (Unix millis) */
	createdAt: number;
	/** Updated timestamp (Unix millis) */
	updatedAt: number;
}
