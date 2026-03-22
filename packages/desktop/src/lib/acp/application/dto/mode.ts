/**
 * Mode information for available agent modes.
 *
 * Represents a mode that can be selected for a session (e.g., "code", "architect").
 * Retrieved from ACP when connecting to an agent.
 */
export interface Mode {
	readonly id: string;
	readonly name: string;
	readonly description?: string;
}
