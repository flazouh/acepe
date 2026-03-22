/**
 * Result of a sync operation for a single skill.
 */
export interface SkillSyncResult {
	/** Skill ID */
	skillId: string;
	/** Agent ID */
	agentId: string;
	/** Whether sync was successful */
	success: boolean;
	/** Error message if failed */
	error: string | null;
}

/**
 * Result of a full sync operation.
 */
export interface SyncResult {
	/** Number of skills synced */
	syncedCount: number;
	/** Number of skills that failed */
	failedCount: number;
	/** Individual results */
	results: SkillSyncResult[];
}
