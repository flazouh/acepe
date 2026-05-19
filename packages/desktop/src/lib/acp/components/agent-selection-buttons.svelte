<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { Button } from "$lib/components/ui/button/index.js";
import { Kbd, KbdGroup } from "$lib/components/ui/kbd/index.js";
import * as Tooltip from "$lib/components/ui/tooltip/index.js";
import type { AgentInfo } from "../logic/agent-manager.js";
import AgentIcon from "./agent-icon.svelte";

interface Props {
	readonly availableAgents: AgentInfo[];
	readonly onAgentSelect: (agentId: string) => void;
}

let { availableAgents, onAgentSelect }: Props = $props();

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
			{@const keyNumber = (index + 1).toString()}
			<div class="flex flex-col items-center gap-2">
				<Tooltip.Root>
					<Tooltip.Trigger>
						<Button
							variant="ghost"
							class="h-14 w-14 p-2 rounded-lg"
							onclick={() => onAgentSelect(agent.id)}
						>
							<AgentIcon
								agentId={agent.id}
								providerBrand={agent.provider_metadata?.providerBrand ?? null}
								providerLabel={agent.provider_metadata?.displayName ?? agent.name}
								class="h-10 w-10"
								size={40}
							/>
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
