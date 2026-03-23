import type { LibrarySkill } from "./library-skill.js";
import type { SyncTarget } from "./sync-target.js";

/**
 * A skill with its sync status across all agents.
 */
export interface LibrarySkillWithSync {
	/** The skill data */
	skill: LibrarySkill;
	/** Sync targets with status */
	syncTargets: SyncTarget[];
	/** Whether the skill has pending changes (content changed since last sync) */
	hasPendingChanges: boolean;
}
