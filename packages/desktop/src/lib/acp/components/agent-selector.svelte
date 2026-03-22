<script lang="ts">
import { Selector } from "@acepe/ui";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { AnalyticsEvent, capture } from "$lib/analytics.js";
import { useTheme } from "$lib/components/theme/context.svelte.js";
import { Skeleton } from "$lib/components/ui/skeleton/index.js";
import * as m from "$lib/paraglide/messages.js";
import { getAgentIcon } from "../constants/thread-list-constants.js";
import type { AgentInfo } from "../logic/agent-manager.js";
import { getAgentStore } from "../store/index.js";
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

const agentStore = getAgentStore();

let selectorRef: { toggle: () => void } | undefined = $state();
let isDropdownOpen = $state(false);

const logger = createLogger({
	id: "agent-selector" as const,
	name: "Agent Selector",
});

const themeState = useTheme();

function handleAgentSelect(agentId: string) {
	logger.debug("handleAgentSelect() called", {
		agentId,
		currentAgentId,
		isDifferent: agentId !== currentAgentId,
	});

	if (agentId !== currentAgentId) {
		logger.info("Changing agent", { from: currentAgentId, to: agentId });
		capture(AnalyticsEvent.AgentChanged, {
			from_agent: currentAgentId,
			to_agent: agentId,
		});
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
					class="h-4 w-4 shrink-0 {currentAgent.available ? '' : 'opacity-50'}"
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
			{@const isInstallable = agent.availability_kind?.kind === "installable"}
			{@const isInstallingNow = agentStore.isInstalling(agent.id)}
			{#if isInstallable && !agent.available && !isInstallingNow}
				<!-- Installable but not yet installed — show Install action -->
				<DropdownMenu.Item
					onSelect={(e) => {
						e.preventDefault();
						agentStore.installAgent(agent.id);
					}}
					class="group/item py-1"
				>
					<div class="flex items-center gap-2 w-full opacity-70">
						{#if icon}
							<img src={icon} alt={agent.name} class="h-4 w-4 shrink-0 opacity-50" />
						{/if}
						<span class="flex-1 text-sm truncate">{capitalizeName(agent.name)}</span>
						<span class="text-xs text-primary font-medium">Install</span>
					</div>
				</DropdownMenu.Item>
			{:else if isInstallingNow}
				<!-- Currently installing — show spinner -->
				<div class="flex items-center gap-2 w-full px-2 py-1 opacity-60">
					{#if icon}
						<img src={icon} alt={agent.name} class="h-4 w-4 shrink-0 opacity-50" />
					{/if}
					<span class="flex-1 text-sm truncate">{capitalizeName(agent.name)}</span>
					<span class="text-xs text-muted-foreground animate-pulse">Installing...</span>
				</div>
			{:else}
				<!-- Available agent — normal select -->
				<DropdownMenu.Item
					onSelect={() => handleAgentSelect(agent.id)}
					class="group/item py-1 {isSelected ? 'bg-accent' : ''}"
				>
					<div class="flex items-center gap-2 w-full">
						{#if icon}
							<img src={icon} alt={agent.name} class="h-4 w-4 shrink-0" />
						{/if}
						<span class="flex-1 text-sm truncate">{capitalizeName(agent.name)}</span>
						<SelectorCheck visible={isSelected} />
					</div>
				</DropdownMenu.Item>
			{/if}
		{/each}
	{/if}
</Selector>
