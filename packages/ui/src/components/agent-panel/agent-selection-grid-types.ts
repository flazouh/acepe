/**
 * A single agent entry for the selection grid.
 */
export interface AgentGridItem {
	readonly id: string;
	readonly name: string;
	readonly iconSrc: string;
	readonly available: boolean;
}
