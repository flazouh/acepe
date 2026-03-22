/**
 * Event emitted when skills change on disk.
 */
export interface SkillsChangedEvent {
	/** Agent ID that changed */
	agentId: string;
	/** Type of change: "created", "modified", "deleted" */
	changeType: "created" | "modified" | "deleted";
	/** Path that changed */
	path: string;
}
