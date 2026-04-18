<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { useTheme } from "$lib/components/theme/context.svelte.js";
import { Button } from "$lib/components/ui/button/index.js";
import { Kbd, KbdGroup } from "$lib/components/ui/kbd/index.js";
import * as Tooltip from "$lib/components/ui/tooltip/index.js";
import { getAgentIcon } from "../constants/thread-list-constants.js";
import type { AgentInfo } from "../logic/agent-manager.js";

interface Props {
	readonly availableAgents: AgentInfo[];
	readonly onAgentSelect: (agentId: string) => void;
}

let { availableAgents, onAgentSelect }: Props = $props();

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
		event.preventDefault();
		onAgentSelect(availableAgents[index].id);
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
	<span class="text-sm text-muted-foreground">{"Choose your agent"}</span>
	<div class="flex items-start justify-center gap-6">
		{#each availableAgents as agent, index (agent.id)}
			{@const iconSrc = getAgentIcon(agent.id, theme)}
			{@const keyNumber = (index + 1).toString()}
			<div class="flex flex-col items-center gap-2">
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
				<KbdGroup class="text-[10px]">
					<Kbd class="px-1 py-0.5 min-w-0">{modifierSymbol}</Kbd>
					<Kbd class="px-1 py-0.5 min-w-0">{keyNumber}</Kbd>
				</KbdGroup>
			</div>
		{/each}
	</div>
</div>
