import { SvelteSet } from "svelte/reactivity";
import type {
	ModelsForDisplay,
	ProviderMetadataProjection,
} from "$lib/services/acp-provider-metadata.js";
import type { Agent } from "$lib/acp/store/types.js";

const MIN_SELECTED_AGENTS_ERROR = "At least one agent must remain selected";

type AgentSelectionUpdateResult =
	| {
			readonly ok: true;
			readonly changed: boolean;
			readonly value: string[];
	  }
	| {
			readonly ok: false;
			readonly error: string;
	  };

/**
 * Computes selected agent IDs from a Switch checked event.
 * Handles duplicate change events idempotently to avoid double-toggle state churn.
 */
export function applyAgentSelectionChange(
	currentSelectedAgentIds: readonly string[],
	agentId: string,
	checked: boolean
): AgentSelectionUpdateResult {
	const normalizedCurrent = Array.from(new SvelteSet(currentSelectedAgentIds));
	const currentlySelected = normalizedCurrent.includes(agentId);

	// Idempotent no-op for repeated checked events with same value.
	if (checked === currentlySelected) {
		return {
			ok: true,
			changed: false,
			value: normalizedCurrent,
		};
	}

	if (checked) {
		const nextSelected = Array.from(normalizedCurrent);
		nextSelected.push(agentId);
		return {
			ok: true,
			changed: true,
			value: nextSelected,
		};
	}

	if (normalizedCurrent.length === 1) {
		return {
			ok: false,
			error: MIN_SELECTED_AGENTS_ERROR,
		};
	}

	return {
		ok: true,
		changed: true,
		value: normalizedCurrent.filter((id) => id !== agentId),
	};
}

export interface AgentModelDefaultsEntry {
	readonly agent: Agent;
	readonly providerMetadata: ProviderMetadataProjection;
}

function compareProviders(
	left: ProviderMetadataProjection | null | undefined,
	right: ProviderMetadataProjection | null | undefined,
	leftFallback: string,
	rightFallback: string
): number {
	const leftOrder = left?.displayOrder ?? Number.MAX_SAFE_INTEGER;
	const rightOrder = right?.displayOrder ?? Number.MAX_SAFE_INTEGER;
	if (leftOrder !== rightOrder) {
		return leftOrder - rightOrder;
	}

	const leftLabel = left?.displayName ?? leftFallback;
	const rightLabel = right?.displayName ?? rightFallback;
	return leftLabel.localeCompare(rightLabel, undefined, {
		sensitivity: "base",
	});
}

export function getAgentsByProviderOrder(
	agents: readonly Agent[],
	getCachedModelsDisplay: (agentId: string) => ModelsForDisplay | null
): Agent[] {
	return Array.from(agents).sort((left, right) => {
		const leftProviderMetadata =
			getCachedModelsDisplay(left.id)?.presentation?.provider ?? left.providerMetadata ?? undefined;
		const rightProviderMetadata =
			getCachedModelsDisplay(right.id)?.presentation?.provider ?? right.providerMetadata ?? undefined;
		return compareProviders(leftProviderMetadata, rightProviderMetadata, left.name, right.name);
	});
}

export function getAgentModelDefaultsEntries(
	agents: readonly Agent[],
	getCachedModelsDisplay: (agentId: string) => ModelsForDisplay | null
): AgentModelDefaultsEntry[] {
	const entries: AgentModelDefaultsEntry[] = [];

	for (const agent of agents) {
		const cachedModelsDisplay = getCachedModelsDisplay(agent.id);
		const providerMetadata =
			cachedModelsDisplay?.presentation?.provider ?? agent.providerMetadata ?? undefined;
		if (!providerMetadata?.supportsModelDefaults) {
			continue;
		}

		entries.push({
			agent,
			providerMetadata,
		});
	}

	return entries.sort((left, right) =>
		compareProviders(
			left.providerMetadata,
			right.providerMetadata,
			left.agent.name,
			right.agent.name
		)
	);
}

export function getProviderDefaultLabel(
	providerMetadata: ProviderMetadataProjection | null | undefined
): string {
	if (!providerMetadata?.defaultAlias) {
		return "Agent default";
	}

	const alias = providerMetadata.defaultAlias;
	return alias.charAt(0).toUpperCase() + alias.slice(1);
}
