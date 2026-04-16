export interface AgentInputConfigOption {
	id: string;
	name: string;
	category: string;
	type: string;
	currentValue: string | number | boolean | null;
	options?: readonly { value: string | number | boolean; name: string }[];
}
