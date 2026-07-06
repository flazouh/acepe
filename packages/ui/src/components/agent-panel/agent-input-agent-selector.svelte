<!--
  AgentInputAgentSelector - Agent picker for new-thread setup and composer toolbar.

  Presentational: desktop supplies agent list, preferences, and icon rendering.
-->
<script lang="ts">
	import type { Snippet } from "svelte";

	import { Colors } from "../../lib/colors.js";
	import { Selector, SelectorItem } from "../selector/index.js";
	import { BUTTON_CHIP_ICON_SIZE_PX } from "../button/variants.js";
	import type { ButtonVariant } from "../button/index.js";
	import type {
		AgentInputAgentSelectorIconParams,
		AgentInputAgentSelectorItem,
	} from "./agent-input-agent-selector-types.js";
	import DefaultAgentHeartIcon from "./default-agent-heart-icon.svelte";

	export type { AgentInputAgentSelectorItem } from "./agent-input-agent-selector-types.js";

	interface Props {
		availableAgents: readonly AgentInputAgentSelectorItem[];
		currentAgentId: string | null;
		defaultAgentId?: string | null;
		onAgentChange: (agentId: string) => void;
		onDefaultAgentToggle?: (agentId: string | null) => void;
		isLoading?: boolean;
		onOpenChange?: (open: boolean) => void;
		class?: string;
		showChevron?: boolean;
		variant?: ButtonVariant;
		triggerClass?: string;
		showLabel?: boolean;
		capitalizeName?: (name: string) => string;
		renderAgentIcon: Snippet<[AgentInputAgentSelectorIconParams]>;
		renderLoadingTrigger?: Snippet;
		emptyLabel?: string;
	}

	let {
		availableAgents,
		currentAgentId,
		defaultAgentId = null,
		onAgentChange,
		onDefaultAgentToggle,
		isLoading = false,
		onOpenChange,
		class: className = "",
		showChevron = true,
		variant = "ghost",
		triggerClass = "rounded-lg",
		showLabel = false,
		capitalizeName = (name) => name,
		renderAgentIcon,
		renderLoadingTrigger,
		emptyLabel = "No agents available",
	}: Props = $props();

	let selectorRef: { toggle: () => void } | undefined = $state();
	let isDropdownOpen = $state(false);

	export function toggle() {
		selectorRef?.toggle();
	}

	function handleAgentSelect(agentId: string) {
		if (agentId !== currentAgentId) {
			onAgentChange(agentId);
		}
		isDropdownOpen = false;
	}

	function handleOpenChange(open: boolean) {
		isDropdownOpen = open;
		onOpenChange?.(open);
	}

	const currentAgent = $derived(
		currentAgentId ? (availableAgents.find((a) => a.id === currentAgentId) ?? null) : null
	);
	const displayAgent = $derived(currentAgent ?? availableAgents[0] ?? null);

	const effectiveTriggerSize = $derived(showLabel ? "setupBarChip" : "default");
	const effectiveShowChevron = $derived(showLabel ? false : showChevron);
	const setupChipIconClass = $derived(showLabel ? "shrink-0" : "h-4 w-4 shrink-0");
	const setupChipIconSize = $derived(showLabel ? BUTTON_CHIP_ICON_SIZE_PX : 16);
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
	triggerClass={showLabel ? "" : triggerClass}
	triggerActive={showLabel && isDropdownOpen}
	side="top"
	sideOffset={8}
>
	{#snippet renderButton()}
		{#if isLoading && renderLoadingTrigger}
			{@render renderLoadingTrigger()}
		{:else if displayAgent}
			{@render renderAgentIcon({
				agentId: displayAgent.id,
				providerBrand: displayAgent.providerBrand ?? null,
				providerLabel: displayAgent.providerLabel ?? displayAgent.name,
				class: setupChipIconClass,
				size: setupChipIconSize,
			})}
			{#if showLabel}
				<span class="whitespace-nowrap">
					{capitalizeName(displayAgent.name)}
				</span>
			{/if}
		{/if}
	{/snippet}

	{#if availableAgents.length === 0}
		<div class="px-2 py-1.5 text-sm text-muted-foreground">{emptyLabel}</div>
	{:else}
		{#each availableAgents as agent (agent.id)}
			{@const isSelected = agent.id === currentAgentId}
			<SelectorItem
				label={capitalizeName(agent.name)}
				selected={isSelected}
				onSelect={() => handleAgentSelect(agent.id)}
			>
				{#snippet leading()}
					{@render renderAgentIcon({
						agentId: agent.id,
						providerBrand: agent.providerBrand ?? null,
						providerLabel: agent.providerLabel ?? agent.name,
						class: "h-3.5 w-3.5 shrink-0",
						size: 14,
					})}
				{/snippet}
				{#snippet trailing()}
					{#if onDefaultAgentToggle}
						<button
							type="button"
							class="default-agent-toggle shrink-0 {agent.id === defaultAgentId
								? ''
								: 'opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100 text-muted-foreground'} transition-opacity"
							style={`--default-agent-color: ${Colors.red};${agent.id === defaultAgentId ? `color: ${Colors.red};` : ""}`}
							onclick={(event: MouseEvent) => {
								event.stopPropagation();
								event.preventDefault();
								onDefaultAgentToggle(agent.id === defaultAgentId ? null : agent.id);
							}}
							aria-label={agent.id === defaultAgentId
								? `Unset ${agent.name} as default agent`
								: `Set ${agent.name} as default agent`}
						>
							{#if agent.id === defaultAgentId}
								<DefaultAgentHeartIcon filled={true} />
							{:else}
								<DefaultAgentHeartIcon />
							{/if}
						</button>
					{/if}
				{/snippet}
			</SelectorItem>
		{/each}
	{/if}
</Selector>

<style>
	.default-agent-toggle:hover,
	.default-agent-toggle:focus-visible {
		color: var(--default-agent-color);
	}
</style>
