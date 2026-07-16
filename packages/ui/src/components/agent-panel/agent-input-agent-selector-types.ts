import type { ProviderBrand } from "../provider-mark/index.js";

export interface AgentInputAgentSelectorItem {
	readonly id: string;
	readonly name: string;
	readonly providerBrand?: ProviderBrand | null;
	readonly providerLabel?: string | null;
	/**
	 * Managed-agent availability. `false` marks an agent the user has enabled but
	 * whose runtime is not installed yet; undefined is treated as installed.
	 */
	readonly installed?: boolean;
	/** True while an install is in flight for this agent (drives the inline progress state). */
	readonly installing?: boolean;
	/** Install progress on a 0–100 scale while `installing` is true. */
	readonly installProgress?: number | null;
	/** Persistent setup failure copy. The row remains installable so selecting it retries. */
	readonly installError?: string | null;
}

export interface AgentInputAgentSelectorIconParams {
	agentId: string;
	providerBrand: ProviderBrand | null;
	providerLabel: string;
	class: string;
	size: number;
}
