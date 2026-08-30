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
	/**
	 * True while an install is in flight for this agent. The row shows an
	 * indeterminate state, not a percentage: the backend install call is
	 * request/response and reports nothing between start and finish, so there
	 * is no progress to render. A `installProgress` prop used to sit here and
	 * fed a bar that stayed at 0% for the whole download.
	 */
	readonly installing?: boolean;
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
