<script lang="ts">
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { IconPlus } from "@tabler/icons-svelte";
import * as Tooltip from "$lib/components/ui/tooltip/index.js";
import { getAgentIcon } from "../constants/thread-list-constants.js";
import type { AgentInfo } from "../logic/agent-manager.js";

interface Props {
	projectPath: string;
	projectName: string;
	availableAgents: AgentInfo[];
	effectiveTheme: "light" | "dark";
	onSelect: (projectPath: string, agentId: string) => void;
}

let { projectPath, projectName, availableAgents, effectiveTheme, onSelect }: Props = $props();

const hasMultipleAgents = $derived(availableAgents.length > 1);
const singleAgent = $derived(availableAgents.length === 1 ? availableAgents[0] : null);

function handleSingleAgentClick(event: MouseEvent) {
	event.stopPropagation();
	if (singleAgent) {
		onSelect(projectPath, singleAgent.id);
	}
}

function handleAgentSelect(agent: AgentInfo) {
	onSelect(projectPath, agent.id);
}
</script>

{#if hasMultipleAgents}
	<DropdownMenu.Root>
		<Tooltip.Root>
			<Tooltip.Trigger>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<button
							{...props}
							class="inline-flex items-center justify-center h-7 w-7 cursor-pointer text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
						>
							<IconPlus class="h-3 w-3" />
						</button>
					{/snippet}
				</DropdownMenu.Trigger>
			</Tooltip.Trigger>
			<Tooltip.Content>
				{`New session in ${projectName}`}
			</Tooltip.Content>
		</Tooltip.Root>
		<DropdownMenu.Content align="start" class="flex gap-1 p-1.5 min-w-0">
			{#each availableAgents as agent (agent.id)}
				<Tooltip.Root>
					<Tooltip.Trigger>
						<DropdownMenu.Item
							class="p-1.5 rounded-md hover:bg-accent"
							onclick={() => handleAgentSelect(agent)}
						>
							<img src={getAgentIcon(agent.id, effectiveTheme)} alt={agent.name} class="h-5 w-5" />
						</DropdownMenu.Item>
					</Tooltip.Trigger>
					<Tooltip.Content>
						{`New ${agent.name} session`}
					</Tooltip.Content>
				</Tooltip.Root>
			{/each}
		</DropdownMenu.Content>
	</DropdownMenu.Root>
{:else if singleAgent}
	<Tooltip.Root>
		<Tooltip.Trigger>
			<button
				class="inline-flex items-center justify-center h-7 w-7 cursor-pointer text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
				onclick={handleSingleAgentClick}
			>
				<IconPlus class="h-3 w-3" />
			</button>
		</Tooltip.Trigger>
		<Tooltip.Content>
			{`New session in ${projectName}`}
		</Tooltip.Content>
	</Tooltip.Root>
{/if}
