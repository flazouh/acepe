/** Data shape for an agent/model pill in the composer toolbar. */
export interface AgentInputPillItem {
	id: string;
	name: string;
	iconSrc: string;
}

/** Data shape for a context pill (attached file, URL, etc.) in the composer. */
export interface AgentInputContextPillItem {
	id: string;
	label: string;
	iconSrc?: string;
}
