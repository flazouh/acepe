/**
 * Model information for available AI models.
 *
 * Represents a model that can be selected for a session.
 * Retrieved from ACP when connecting to an agent.
 */
export interface Model {
	readonly id: string;
	readonly name: string;
	readonly description?: string;
}
