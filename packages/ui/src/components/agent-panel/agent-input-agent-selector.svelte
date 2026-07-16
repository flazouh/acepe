<!--
  AgentInputAgentSelector - Agent picker for new-thread setup and composer toolbar.

  Presentational: desktop supplies agent list, preferences, and icon rendering.
-->
<script lang="ts">
	import type { Snippet } from "svelte";

	import { Selector, SelectorItem } from "../selector/index.js";
	import * as DropdownMenu from "../dropdown-menu/index.js";
	import {
		dropdownMenuItemTypographyClass,
		dropdownMenuSectionTypographyClass,
	} from "../dropdown-menu/dropdown-menu-typography.js";
	import { SegmentedProgressBar } from "../segmented-progress-bar/index.js";
	import { HugeiconsIcon } from "../icons/index.js";
	import { BUTTON_CHIP_ICON_SIZE_PX } from "../button/variants.js";
	import type { ButtonVariant } from "../button/index.js";
	import type {
		AgentInputAgentSelectorIconParams,
		AgentInputAgentSelectorItem,
	} from "./agent-input-agent-selector-types.js";
	import DefaultAgentPinIcon from "./default-agent-pin-icon.svelte";

	export type { AgentInputAgentSelectorItem } from "./agent-input-agent-selector-types.js";

	interface Props {
		availableAgents: readonly AgentInputAgentSelectorItem[];
		currentAgentId: string | null;
		defaultAgentId?: string | null;
		onAgentChange: (agentId: string) => void;
		onAgentInstall?: (agentId: string) => void;
		onDefaultAgentToggle?: (agentId: string | null) => void;
		notInstalledLabel?: string;
		installingLabel?: string;
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
		onAgentInstall,
		onDefaultAgentToggle,
		notInstalledLabel = "Not installed",
		installingLabel = "Installing…",
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

	function isAgentInstalled(agent: AgentInputAgentSelectorItem): boolean {
		return agent.installed !== false;
	}

	function handleNotInstalledSelect(agent: AgentInputAgentSelectorItem, event: Event) {
		// Keep the menu open and never select an agent that is not ready yet.
		event.preventDefault();
		if (agent.installing) {
			// Install already in flight — swallow repeat clicks.
			return;
		}
		onAgentInstall?.(agent.id);
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
			{#if !isAgentInstalled(agent)}
				<DropdownMenu.Item
					closeOnSelect={false}
					onSelect={(event) => handleNotInstalledSelect(agent, event)}
					class="group/item transition-colors py-1"
				>
					{#if agent.installing}
						<div class="flex w-full min-w-0 flex-col gap-1.5">
							<div class="flex min-w-0 items-center gap-2">
								{@render renderAgentIcon({
									agentId: agent.id,
									providerBrand: agent.providerBrand ?? null,
									providerLabel: agent.providerLabel ?? agent.name,
									class: "h-3.5 w-3.5 shrink-0 opacity-60",
									size: 14,
								})}
								<div class="flex min-w-0 flex-1 flex-col gap-0.5">
									<span class="truncate {dropdownMenuItemTypographyClass} text-muted-foreground">
										{capitalizeName(agent.name)}
									</span>
									<span class="{dropdownMenuSectionTypographyClass} text-muted-foreground">
										{installingLabel}
									</span>
								</div>
							</div>
							<SegmentedProgressBar
								ariaLabel={`Installing ${capitalizeName(agent.name)}`}
								label=""
								percent={agent.installProgress ?? 0}
								segmentCount={12}
								showPercent={true}
								variant="downloadFillWidth"
							/>
						</div>
					{:else}
						<div class="flex w-full min-w-0 items-center gap-2">
							{@render renderAgentIcon({
								agentId: agent.id,
								providerBrand: agent.providerBrand ?? null,
								providerLabel: agent.providerLabel ?? agent.name,
								class: "h-3.5 w-3.5 shrink-0 opacity-60",
								size: 14,
							})}
							<div class="flex min-w-0 flex-1 flex-col gap-0.5">
								<span class="truncate {dropdownMenuItemTypographyClass} text-muted-foreground">
									{capitalizeName(agent.name)}
								</span>
								<span class="{dropdownMenuSectionTypographyClass} {agent.installError
									? 'text-destructive'
									: 'text-muted-foreground'}">
									{agent.installError ?? notInstalledLabel}
								</span>
							</div>
							<HugeiconsIcon
								name="download"
								class="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/item:opacity-100"
							/>
						</div>
					{/if}
				</DropdownMenu.Item>
			{:else}
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
						{@const isDefault = agent.id === defaultAgentId}
						<button
							type="button"
							class="group/pin shrink-0 transition-colors {isDefault
								? 'text-foreground'
								: 'text-muted-foreground hover:text-foreground focus-visible:text-foreground'}"
							onclick={(event: MouseEvent) => {
								event.stopPropagation();
								event.preventDefault();
								onDefaultAgentToggle(isDefault ? null : agent.id);
							}}
							aria-label={isDefault
								? `Unset ${agent.name} as default agent`
								: `Set ${agent.name} as default agent`}
						>
							<DefaultAgentPinIcon active={isDefault} />
						</button>
					{/if}
				{/snippet}
			</SelectorItem>
			{/if}
		{/each}
	{/if}
</Selector>
