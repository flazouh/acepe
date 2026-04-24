import { SvelteSet } from "svelte/reactivity";
import type { Mode } from "$lib/acp/application/dto/mode.js";
import type { Model } from "$lib/acp/application/dto/model.js";
import {
	type CapabilitySourceResolution,
	resolveCapabilitySource,
} from "$lib/acp/components/agent-input/logic/capability-source.js";
import type { Agent } from "$lib/acp/store/types.js";
import type {
	ModelsForDisplay,
	ProviderMetadataProjection,
} from "$lib/services/acp-provider-metadata.js";
import type { ResolvedCapabilities } from "$lib/services/acp-types.js";

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

function getProjectedProviderMetadata(
	agent: Agent,
	getProviderMetadata: (agentId: string) => ProviderMetadataProjection | null
): ProviderMetadataProjection | null | undefined {
	return getProviderMetadata(agent.id) ?? agent.providerMetadata ?? undefined;
}

export function getAgentsByProviderOrder(
	agents: readonly Agent[],
	getProviderMetadata: (agentId: string) => ProviderMetadataProjection | null
): Agent[] {
	return Array.from(agents).sort((left, right) => {
		const leftProviderMetadata = getProjectedProviderMetadata(left, getProviderMetadata);
		const rightProviderMetadata = getProjectedProviderMetadata(right, getProviderMetadata);
		return compareProviders(leftProviderMetadata, rightProviderMetadata, left.name, right.name);
	});
}

export function getAgentModelDefaultsEntries(
	agents: readonly Agent[],
	getProviderMetadata: (agentId: string) => ProviderMetadataProjection | null
): AgentModelDefaultsEntry[] {
	const entries: AgentModelDefaultsEntry[] = [];

	for (const agent of agents) {
		const providerMetadata = getProjectedProviderMetadata(agent, getProviderMetadata);
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

export function resolveSettingsCapabilitySource(input: {
	preconnectionCapabilities: ResolvedCapabilities | null;
	cachedModes: readonly Mode[];
	cachedModels: readonly Model[];
	cachedModelsDisplay: ModelsForDisplay | null;
	providerMetadata: ProviderMetadataProjection | null;
}): CapabilitySourceResolution {
	return resolveCapabilitySource({
		sessionCapabilities: null,
		preconnectionCapabilities: input.preconnectionCapabilities,
		cachedModes: input.cachedModes,
		cachedModels: input.cachedModels,
		cachedModelsDisplay: input.cachedModelsDisplay,
		providerMetadata: input.providerMetadata,
	});
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
