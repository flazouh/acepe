export interface AgentInputConfigOption {
	id: string;
	name: string;
	category: string;
	type: string;
	/** Human-readable explanation of what this option controls. */
	description?: string | null;
	currentValue: string | number | boolean | null;
	options?: readonly { value: string | number | boolean; name: string }[];
}
