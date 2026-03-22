<script lang="ts">
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import IconPlus from "@tabler/icons-svelte/icons/plus";
import * as Tooltip from "$lib/components/ui/tooltip/index.js";
import * as m from "$lib/paraglide/messages.js";
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
	if (agent.available) {
		onSelect(projectPath, agent.id);
	}
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
				{m.thread_list_new_session_in_project({ projectName })}
			</Tooltip.Content>
		</Tooltip.Root>
		<DropdownMenu.Content align="start" class="flex gap-1 p-1.5 min-w-0">
			{#each availableAgents as agent (agent.id)}
				<Tooltip.Root>
					<Tooltip.Trigger>
						<DropdownMenu.Item
							class="p-1.5 rounded-md {!agent.available
								? 'opacity-50 cursor-not-allowed'
								: 'hover:bg-accent'}"
							disabled={!agent.available}
							onclick={() => handleAgentSelect(agent)}
						>
							<img src={getAgentIcon(agent.id, effectiveTheme)} alt={agent.name} class="h-5 w-5" />
						</DropdownMenu.Item>
					</Tooltip.Trigger>
					<Tooltip.Content>
						{agent.available
							? m.thread_list_new_agent_session({ agentName: agent.name })
							: `${agent.name} (not installed)`}
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
			{m.thread_list_new_session_in_project({ projectName })}
		</Tooltip.Content>
	</Tooltip.Root>
{/if}
