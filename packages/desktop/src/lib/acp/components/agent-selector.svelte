<script lang="ts">
import { AgentInputAgentSelector } from "@acepe/ui";
import { Skeleton } from "$lib/components/ui/skeleton/index.js";
import { getAgentPreferencesStore } from "../store/index.js";
import { capitalizeName } from "../utils/index.js";
import AgentIcon from "./agent-icon.svelte";
import type { ProviderMetadataProjection } from "$lib/services/acp-types.js";

interface AgentSelectorProps {
	availableAgents: readonly {
		readonly id: string;
		readonly name: string;
		readonly provider_metadata?: ProviderMetadataProjection;
	}[];
	currentAgentId: string | null;
	onAgentChange: (agentId: string) => void;
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
const defaultAgentId = $derived(agentPreferencesStore.defaultAgentId);

const agentItems = $derived(
	availableAgents.map((agent) => ({
		id: agent.id,
		name: agent.name,
		providerBrand: agent.provider_metadata?.providerBrand ?? null,
		providerLabel: agent.provider_metadata?.displayName ?? agent.name,
	}))
);

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
