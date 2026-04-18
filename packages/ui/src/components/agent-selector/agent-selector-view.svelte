<script lang="ts">
	import { Heart } from "phosphor-svelte";
	import { IconCheck } from "@tabler/icons-svelte";

	import { Colors } from "../../lib/colors.js";
	import * as DropdownMenu from "../dropdown-menu/index.js";
	import { Selector } from "../selector/index.js";
	import type { ButtonVariant } from "../button/index.js";
	import type { AgentSelectorViewItem } from "./types.js";

	interface Props {
		agents: readonly AgentSelectorViewItem[];
		selectedAgentId: string | null;
		open?: boolean;
		disabled?: boolean;
		isLoading?: boolean;
		class?: string;
		buttonClass?: string;
		contentClass?: string;
		showChevron?: boolean;
		variant?: ButtonVariant;
		emptyLabel?: string;
		favoriteColor?: string;
		onSelect?: (agentId: string) => void;
		onToggleFavorite?: (agentId: string, nextFavorite: boolean) => void;
		onOpenChange?: (open: boolean) => void;
	}

	let {
		agents,
		selectedAgentId,
		open = $bindable(false),
		disabled = false,
		isLoading = false,
		class: className = "",
		buttonClass = "",
		contentClass = "",
		showChevron = true,
		variant = "outline",
		emptyLabel = "No agents available",
		favoriteColor = Colors.red,
		onSelect,
		onToggleFavorite,
		onOpenChange,
	}: Props = $props();

	let selectorRef: { toggle: () => void } | undefined = $state();

	export function toggle(): void {
		selectorRef?.toggle();
	}

	const selectedAgent = $derived(
		selectedAgentId === null
			? null
			: (agents.find((agent) => agent.id === selectedAgentId) ?? null)
	);

	function handleAgentSelect(agentId: string): void {
		onSelect?.(agentId);
	}

	function handleToggleFavorite(event: MouseEvent, agent: AgentSelectorViewItem): void {
		event.stopPropagation();
		event.preventDefault();
		onToggleFavorite?.(agent.id, !agent.isFavorite);
	}
</script>

	<Selector
		bind:this={selectorRef}
		bind:open
		disabled={disabled || isLoading || agents.length === 0}
		class={className}
		{buttonClass}
		{contentClass}
		{showChevron}
		{variant}
		{onOpenChange}
	>
	{#snippet renderButton()}
		{#if isLoading}
			<span class="h-4 w-4 shrink-0 rounded animate-pulse bg-muted"></span>
			<span class="h-3 w-20 rounded animate-pulse bg-muted"></span>
		{:else if selectedAgent && selectedAgent.iconSrc}
			<img
				src={selectedAgent.iconSrc}
				alt={selectedAgent.name}
				class="h-4 w-4 shrink-0"
			/>
		{/if}
	{/snippet}

	{#if agents.length === 0}
		<div
			class="px-2 py-1.5 text-sm text-muted-foreground"
			data-testid="agent-selector-empty"
		>
			{emptyLabel}
		</div>
	{:else}
		{#each agents as agent (agent.id)}
			{@const isSelected = agent.id === selectedAgentId}
			<DropdownMenu.Item
				onSelect={() => handleAgentSelect(agent.id)}
				class="group/item py-1 {isSelected ? 'bg-accent' : ''}"
			>
				<div class="flex items-center gap-2 w-full">
					{#if agent.iconSrc}
						<img src={agent.iconSrc} alt={agent.name} class="h-4 w-4 shrink-0" />
					{/if}
					<span class="flex-1 text-sm truncate">{agent.name}</span>
					<button
						type="button"
						class="default-agent-toggle shrink-0 {agent.isFavorite
							? ''
							: 'opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100 text-muted-foreground'} transition-opacity"
						style={`--default-agent-color: ${favoriteColor};${agent.isFavorite ? `color: ${favoriteColor};` : ""}`}
						onclick={(event) => handleToggleFavorite(event, agent)}
						aria-label={agent.isFavorite
							? `Unset ${agent.name} as default agent`
							: `Set ${agent.name} as default agent`}
					>
						{#if agent.isFavorite}
							<Heart size={14} weight="fill" color={favoriteColor} />
						{:else}
							<Heart size={14} weight="regular" />
						{/if}
					</button>
					{#if isSelected}
						<IconCheck class="h-4 w-4 shrink-0 text-foreground" />
					{/if}
				</div>
			</DropdownMenu.Item>
		{/each}
	{/if}
</Selector>

<style>
	.default-agent-toggle:hover,
	.default-agent-toggle:focus-visible {
		color: var(--default-agent-color);
	}
</style>
