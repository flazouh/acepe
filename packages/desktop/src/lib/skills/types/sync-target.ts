/**
 * Sync target configuration for a skill.
 */
export interface SyncTarget {
	/** Agent ID */
	agentId: string;
	/** Agent display name */
	agentName: string;
	/** Whether sync is enabled for this agent */
	enabled: boolean;
	/** Sync status: "synced", "pending", "never" */
	status: "synced" | "pending" | "never";
	/** Last synced timestamp (if synced) */
	syncedAt: number | null;
}
