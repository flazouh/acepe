<script lang="ts">
	import { Colors } from "@acepe/ui/colors";
	import { Selector } from "@acepe/ui";
	import * as DropdownMenu from "@acepe/ui/dropdown-menu";
	import { useTheme } from "$lib/components/theme/context.svelte.js";
	import { Skeleton } from "$lib/components/ui/skeleton/index.js";
	import * as m from "$lib/messages.js";
	import { Heart } from "phosphor-svelte";
	import { getAgentIcon } from "../constants/thread-list-constants.js";
	import type { AgentInfo } from "../logic/agent-manager.js";
	import { getAgentPreferencesStore } from "../store/index.js";
import { capitalizeName } from "../utils/index.js";
import { createLogger } from "../utils/logger.js";
import SelectorCheck from "./selector-check.svelte";

interface AgentSelectorProps {
	availableAgents: AgentInfo[];
	currentAgentId: string | null;
	onAgentChange: (agentId: string) => void;
	isLoading?: boolean;
	ontoggle?: (isOpen: boolean) => void;
}

let {
	availableAgents,
	currentAgentId,
	onAgentChange,
	isLoading = false,
	ontoggle,
}: AgentSelectorProps = $props();

let selectorRef: { toggle: () => void } | undefined = $state();
let isDropdownOpen = $state(false);

const logger = createLogger({
	id: "agent-selector" as const,
	name: "Agent Selector",
});

const themeState = useTheme();
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
</script>

<Selector
	bind:this={selectorRef}
	bind:open={isDropdownOpen}
	disabled={isLoading || availableAgents.length === 0}
	onOpenChange={handleOpenChange}
>
	{#snippet renderButton()}
		{#if isLoading}
			<Skeleton class="h-4 w-4 shrink-0 rounded" />
			<Skeleton class="h-3 w-20" />
		{:else if currentAgent}
			{@const icon = getAgentIcon(currentAgent.id, themeState.effectiveTheme)}
			{#if icon}
				<img
					src={icon}
					alt={currentAgent.name}
					class="h-4 w-4 shrink-0"
				/>
			{/if}
		{/if}
	{/snippet}

	{#if availableAgents.length === 0}
		<div class="px-2 py-1.5 text-sm text-muted-foreground">
			{m.agent_selector_no_agents()}
		</div>
	{:else}
		{#each availableAgents as agent (agent.id)}
			{@const icon = getAgentIcon(agent.id, themeState.effectiveTheme)}
			{@const isSelected = agent.id === currentAgentId}
			<DropdownMenu.Item
				onSelect={() => handleAgentSelect(agent.id)}
				class="group/item py-1 {isSelected ? 'bg-accent' : ''}"
			>
				<div class="flex items-center gap-2 w-full">
					{#if icon}
						<img src={icon} alt={agent.name} class="h-4 w-4 shrink-0" />
					{/if}
					<span class="flex-1 text-sm truncate">{capitalizeName(agent.name)}</span>
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
					<SelectorCheck visible={isSelected} />
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
