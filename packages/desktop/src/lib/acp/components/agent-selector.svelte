<script lang="ts">
import { AgentInputAgentSelector } from "@acepe/ui";
import { Skeleton } from "$lib/components/ui/skeleton/index.js";
import { getAgentPreferencesStore, getAgentStore } from "../store/index.js";
import type { AgentAvailabilityKind } from "../store/types.js";
import { capitalizeName } from "../utils/index.js";
import AgentIcon from "./agent-icon.svelte";
import type { ProviderMetadataProjection } from "$lib/services/acp-types.js";
import { PreconnectionCapabilitiesState } from "./agent-input/logic/preconnection-capabilities-state.svelte.js";
import {
	installAgentForSelection,
	resolvePostInstallCapabilityMode,
} from "./agent-input/logic/installable-agent-selection.js";

interface AgentSelectorProps {
	availableAgents: readonly {
		readonly id: string;
		readonly name: string;
		readonly provider_metadata?: ProviderMetadataProjection;
		readonly availability_kind?: AgentAvailabilityKind;
	}[];
	currentAgentId: string | null;
	onAgentChange: (agentId: string) => void;
	projectPath?: string | null;
	isLoading?: boolean;
	ontoggle?: (isOpen: boolean) => void;
	class?: string;
	showChevron?: boolean;
	variant?: import("@acepe/ui").ButtonVariant;
	triggerClass?: string;
	showLabel?: boolean;
}

let {
	availableAgents,
	currentAgentId,
	onAgentChange,
	projectPath = null,
	isLoading = false,
	ontoggle,
	class: className = "",
	showChevron = true,
	variant = "ghost",
	triggerClass = "rounded-lg",
	showLabel = false,
}: AgentSelectorProps = $props();

let selectorRef: { toggle: () => void } | undefined = $state();

const agentPreferencesStore = getAgentPreferencesStore();
const agentStore = getAgentStore();
const preconnectionCapabilitiesState = new PreconnectionCapabilitiesState();
const defaultAgentId = $derived(agentPreferencesStore.defaultAgentId);

const agentItems = $derived(
	availableAgents.map((agent) => {
		const installState = agentStore.installing[agent.id];
		const readiness = agentStore.getAgentInstallationReadiness(agent.id);
		const setupPending = readiness?.status === "pending";
		const providerMetadata = agentStore.getProviderMetadata(agent.id) ?? agent.provider_metadata;
		return {
			id: agent.id,
			name: agent.name,
			providerBrand: providerMetadata?.providerBrand ?? null,
			providerLabel: providerMetadata?.displayName ?? agent.name,
			installed: readiness
				? false
				: agent.availability_kind
					? agent.availability_kind.installed
					: true,
			installing: setupPending || (readiness === null && installState !== undefined),
			// Rust emits install progress on a 0–1 scale; the shared row expects 0–100.
			installProgress:
				setupPending && installState
					? Math.round(installState.progress * 100)
					: setupPending
						? 100
						: null,
			installError:
				readiness?.status === "failed"
					? `Agent setup failed: ${readiness.message}. Click to retry.`
					: null,
		};
	})
);

function handleAgentInstall(agentId: string): void {
	const agent = availableAgents.find((candidate) => candidate.id === agentId);
	const readiness = agentStore.getAgentInstallationReadiness(agentId);
	if (!agent || readiness?.status === "pending") {
		return;
	}

	const canonicalAgent = agentStore.getAgent(agentId);
	const installRequired =
		(canonicalAgent?.availability_kind?.installed ?? agent.availability_kind?.installed) !== true;
	agentStore.beginAgentInstallationReadiness(agentId);
	void installAgentForSelection(
		{
			agentId,
			installRequired,
			projectPath,
			preconnectionCapabilityMode: resolvePostInstallCapabilityMode({
				projectedProviderMetadata: agent.provider_metadata,
				canonicalProviderMetadata: canonicalAgent?.providerMetadata,
				requiresPostInstallCatalog: true,
			}),
		},
		{
			installAgent: (targetAgentId) => agentStore.installAgent(targetAgentId),
			refreshPreconnectionCapabilities: (input, options) =>
				preconnectionCapabilitiesState.ensureLoaded(input, options),
			selectAgent: onAgentChange,
		}
	).match(
		() => {
			agentStore.completeAgentInstallationReadiness(agentId);
		},
		(error) => {
			agentStore.failAgentInstallationReadiness(agentId, error.message);
		}
	);
}

export function toggle() {
	selectorRef?.toggle();
}
</script>

<AgentInputAgentSelector
	bind:this={selectorRef}
	availableAgents={agentItems}
	{currentAgentId}
	defaultAgentId={defaultAgentId}
	{onAgentChange}
	onAgentInstall={(agentId) => {
		void handleAgentInstall(agentId);
	}}
	onDefaultAgentToggle={(agentId) => {
		void agentPreferencesStore.setDefaultAgentId(agentId);
	}}
	{isLoading}
	onOpenChange={ontoggle}
	class={className}
	{showChevron}
	{variant}
	{triggerClass}
	{showLabel}
	{capitalizeName}
>
	{#snippet renderAgentIcon({ agentId, providerBrand, providerLabel, class: iconClass, size })}
		<AgentIcon
			{agentId}
			{providerBrand}
			{providerLabel}
			class={iconClass}
			{size}
		/>
	{/snippet}
	{#snippet renderLoadingTrigger()}
		<Skeleton class="size-3.5 shrink-0 rounded" />
		<Skeleton class="h-3 w-20" />
	{/snippet}
</AgentInputAgentSelector>
