<script lang="ts">
import { Colors } from "@acepe/ui/colors";
import { FUSED_CONTROL_SETUP_CHIP_ICON_SIZE_CLASS, FUSED_CONTROL_SETUP_CHIP_ICON_SIZE_PX, FUSED_CONTROL_SETUP_CHIP_LABEL_TEXT_CLASS } from "@acepe/ui/panel-header";
import { Selector, AgentInputSelectorItemRow } from "@acepe/ui";
import type { ButtonVariant } from "@acepe/ui";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { Skeleton } from "$lib/components/ui/skeleton/index.js";
import { Heart } from "phosphor-svelte";
import { getAgentPreferencesStore } from "../store/index.js";
import { capitalizeName } from "../utils/index.js";
import { cn } from "$lib/utils.js";
import { createLogger } from "../utils/logger.js";
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
	variant?: ButtonVariant;
	triggerClass?: string;
	/** When true, the trigger shows the agent name next to its icon. */
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
let isDropdownOpen = $state(false);

const logger = createLogger({
	id: "agent-selector" as const,
	name: "Agent Selector",
});

const agentPreferencesStore = getAgentPreferencesStore();
const defaultAgentId = $derived(agentPreferencesStore.defaultAgentId);

function handleAgentSelect(agentId: string) {
	logger.debug("handleAgentSelect() called", {
		agentId,
		currentAgentId,
		isDifferent: agentId !== currentAgentId,
	});

	if (agentId !== currentAgentId) {
		logger.info("Changing agent", { from: currentAgentId, to: agentId });
		onAgentChange(agentId);
	}
	isDropdownOpen = false;
}

export function toggle() {
	selectorRef?.toggle();
}

function handleOpenChange(open: boolean) {
	isDropdownOpen = open;
	ontoggle?.(open);
}

const currentAgent = $derived(
	currentAgentId ? (availableAgents.find((a) => a.id === currentAgentId) ?? null) : null
);
const displayAgent = $derived(currentAgent ?? availableAgents[0] ?? null);

// In the new-thread setup card (showLabel) every picker shares the same compact chip size;
// elsewhere the agent selector keeps its default styling.
const effectiveTriggerSize = $derived(showLabel ? "setupBarChip" : "default");
const effectiveTriggerClass = $derived(
	showLabel ? (isDropdownOpen ? "bg-accent text-foreground" : "") : triggerClass
);
const effectiveShowChevron = $derived(showLabel ? false : showChevron);
const setupChipIconClass = $derived(showLabel ? FUSED_CONTROL_SETUP_CHIP_ICON_SIZE_CLASS : "h-4 w-4 shrink-0");
const setupChipIconSize = $derived(showLabel ? FUSED_CONTROL_SETUP_CHIP_ICON_SIZE_PX : 16);
</script>

<Selector
	bind:this={selectorRef}
	bind:open={isDropdownOpen}
	disabled={isLoading || availableAgents.length === 0}
	onOpenChange={handleOpenChange}
	class={className}
	showChevron={effectiveShowChevron}
	{variant}
	triggerSize={effectiveTriggerSize}
	triggerClass={effectiveTriggerClass}
	side="top"
	sideOffset={8}
>
	{#snippet renderButton()}
		{#if isLoading}
			<Skeleton class="{FUSED_CONTROL_SETUP_CHIP_ICON_SIZE_CLASS} rounded" />
			<Skeleton class="h-3 w-20" />
		{:else if displayAgent}
			<AgentIcon
				agentId={displayAgent.id}
				providerBrand={displayAgent.provider_metadata?.providerBrand ?? null}
				providerLabel={displayAgent.provider_metadata?.displayName ?? displayAgent.name}
				class={setupChipIconClass}
				size={setupChipIconSize}
			/>
			{#if showLabel}
				<span class={cn("whitespace-nowrap", FUSED_CONTROL_SETUP_CHIP_LABEL_TEXT_CLASS)}>{capitalizeName(displayAgent.name)}</span>
			{/if}
		{/if}
	{/snippet}

	{#if availableAgents.length === 0}
		<div class="px-2 py-1.5 text-sm text-muted-foreground">
			{"No agents available"}
		</div>
	{:else}
		{#each availableAgents as agent (agent.id)}
			{@const isSelected = agent.id === currentAgentId}
			<AgentInputSelectorItemRow
				label={capitalizeName(agent.name)}
				selected={isSelected}
				onSelect={() => handleAgentSelect(agent.id)}
			>
				{#snippet leading()}
					<AgentIcon
						agentId={agent.id}
						providerBrand={agent.provider_metadata?.providerBrand ?? null}
						providerLabel={agent.provider_metadata?.displayName ?? agent.name}
						class="h-3.5 w-3.5 shrink-0"
						size={14}
					/>
				{/snippet}
				{#snippet trailing()}
					<button
						type="button"
						class="default-agent-toggle shrink-0 {agent.id === defaultAgentId ? '' : 'opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100 text-muted-foreground'} transition-opacity"
						style={`--default-agent-color: ${Colors.red};${agent.id === defaultAgentId ? `color: ${Colors.red};` : ""}`}
						onclick={(event: MouseEvent) => {
							event.stopPropagation();
							event.preventDefault();
							void agentPreferencesStore.setDefaultAgentId(agent.id === defaultAgentId ? null : agent.id);
						}}
						aria-label={agent.id === defaultAgentId
							? `Unset ${agent.name} as default agent`
							: `Set ${agent.name} as default agent`}
					>
						{#if agent.id === defaultAgentId}
							<Heart size={14} weight="fill" color={Colors.red} />
						{:else}
							<Heart size={14} weight="regular" />
						{/if}
					</button>
				{/snippet}
			</AgentInputSelectorItemRow>
		{/each}
	{/if}
</Selector>

<style>
	.default-agent-toggle:hover,
	.default-agent-toggle:focus-visible {
		color: var(--default-agent-color);
	}
</style>
