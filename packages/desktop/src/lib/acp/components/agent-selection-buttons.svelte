<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { useTheme } from "$lib/components/theme/context.svelte.js";
import { Button } from "$lib/components/ui/button/index.js";
import { Kbd, KbdGroup } from "$lib/components/ui/kbd/index.js";
import * as Tooltip from "$lib/components/ui/tooltip/index.js";
import * as m from "$lib/paraglide/messages.js";
import { getAgentIcon } from "../constants/thread-list-constants.js";
import type { AgentInfo } from "../logic/agent-manager.js";
import { getAgentStore } from "../store/index.js";

interface Props {
	readonly availableAgents: AgentInfo[];
	readonly onAgentSelect: (agentId: string) => void;
}

let { availableAgents, onAgentSelect }: Props = $props();

const agentStore = getAgentStore();
const themeState = useTheme();
const theme = $derived(themeState.effectiveTheme);

// Detect platform for modifier key display
const isMac = typeof navigator !== "undefined" && navigator.platform.includes("Mac");
const modifierSymbol = isMac ? "⌘" : "Ctrl";

// Handle keyboard shortcuts (Cmd/Ctrl+1-9 to select agents)
function handleKeyDown(event: KeyboardEvent) {
	// Ignore if user is typing in an input
	const target = event.target as HTMLElement;
	if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
		return;
	}

	// Require Cmd (Mac) or Ctrl (Windows/Linux) modifier
	const hasModifier = isMac ? event.metaKey : event.ctrlKey;
	if (!hasModifier) {
		return;
	}

	const key = event.key;
	const index = parseInt(key, 10) - 1;

	if (index >= 0 && index < availableAgents.length) {
		const agent = availableAgents[index];
		if (agent.available) {
			event.preventDefault();
			onAgentSelect(agent.id);
		} else if (
			agent.availability_kind?.kind === "installable" &&
			!agentStore.isInstalling(agent.id)
		) {
			// Trigger install for installable agents via keyboard shortcut
			event.preventDefault();
			agentStore.installAgent(agent.id);
		}
	}
}

onMount(() => {
	window.addEventListener("keydown", handleKeyDown);
});

onDestroy(() => {
	window.removeEventListener("keydown", handleKeyDown);
});
</script>

<div class="flex flex-col items-center gap-4">
	<span class="text-sm text-muted-foreground">{m.agent_selection_choose_agent()}</span>
	<div class="flex items-start justify-center gap-6">
		{#each availableAgents as agent, index (agent.id)}
			{@const iconSrc = getAgentIcon(agent.id, theme)}
			{@const keyNumber = (index + 1).toString()}
			{@const isInstallable = agent.availability_kind?.kind === "installable"}
			{@const isInstallingNow = agentStore.isInstalling(agent.id)}
			<div class="flex flex-col items-center gap-2">
				{#if agent.available}
					<Tooltip.Root>
						<Tooltip.Trigger>
							<Button
								variant="ghost"
								class="h-14 w-14 p-2 rounded-lg"
								onclick={() => onAgentSelect(agent.id)}
							>
								<img src={iconSrc} alt={agent.name} class="h-10 w-10" />
							</Button>
						</Tooltip.Trigger>
						<Tooltip.Content>
							<span>{agent.name}</span>
						</Tooltip.Content>
					</Tooltip.Root>
				{:else if isInstallable && !isInstallingNow}
					<!-- Installable but not installed — show Install button -->
					<Tooltip.Root>
						<Tooltip.Trigger>
							<Button
								variant="ghost"
								class="h-14 w-14 p-2 rounded-lg opacity-60 hover:opacity-100"
								onclick={() => agentStore.installAgent(agent.id)}
							>
								<img src={iconSrc} alt={agent.name} class="h-10 w-10 grayscale" />
							</Button>
						</Tooltip.Trigger>
						<Tooltip.Content>
							<span>Install {agent.name}</span>
						</Tooltip.Content>
					</Tooltip.Root>
				{:else if isInstallingNow}
					<!-- Installing — show spinner -->
					<Tooltip.Root>
						<Tooltip.Trigger>
							<Button
								variant="ghost"
								class="h-14 w-14 p-2 rounded-lg opacity-50"
								disabled
							>
								<img src={iconSrc} alt={agent.name} class="h-10 w-10 grayscale animate-pulse" />
							</Button>
						</Tooltip.Trigger>
						<Tooltip.Content>
							<span>Installing {agent.name}...</span>
						</Tooltip.Content>
					</Tooltip.Root>
				{:else}
					<!-- Not available and not installable -->
					<Tooltip.Root>
						<Tooltip.Trigger>
							<Button
								variant="ghost"
								class="h-14 w-14 p-2 rounded-lg opacity-50 cursor-not-allowed"
								disabled
							>
								<img src={iconSrc} alt={agent.name} class="h-10 w-10 grayscale" />
							</Button>
						</Tooltip.Trigger>
						<Tooltip.Content>
							<span>{agent.name} - {m.agent_selector_not_installed()}</span>
						</Tooltip.Content>
					</Tooltip.Root>
				{/if}
				<KbdGroup class="text-[10px] {!agent.available ? 'opacity-50' : ''}">
					<Kbd class="px-1 py-0.5 min-w-0">{modifierSymbol}</Kbd>
					<Kbd class="px-1 py-0.5 min-w-0">{keyNumber}</Kbd>
				</KbdGroup>
			</div>
		{/each}
	</div>
</div>
