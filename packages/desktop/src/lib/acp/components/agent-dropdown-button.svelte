<script lang="ts">
import { Selector } from "@acepe/ui";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { IconPlus } from "@tabler/icons-svelte";
import * as Tooltip from "$lib/components/ui/tooltip/index.js";
import type { AgentInfo } from "../logic/agent-manager.js";
import AgentIcon from "./agent-icon.svelte";

interface Props {
	projectPath: string;
	projectName: string;
	availableAgents: AgentInfo[];
	onSelect: (projectPath: string, agentId: string) => void;
}

let { projectPath, projectName, availableAgents, onSelect }: Props = $props();

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
	<Selector
		align="start"
		triggerSize="square"
		showChevron={false}
		tooltipLabel={`New session in ${projectName}`}
		variant="ghost"
	>
		{#snippet renderButton()}
			<IconPlus class="h-3 w-3" />
		{/snippet}

		<div class="flex gap-1 p-1.5 min-w-0">
			{#each availableAgents as agent (agent.id)}
				<Tooltip.Root>
					<Tooltip.Trigger>
						<DropdownMenu.Item
							class="p-1.5 rounded-md hover:bg-accent"
							onclick={() => handleAgentSelect(agent)}
						>
							<AgentIcon
								agentId={agent.id}
								providerBrand={agent.provider_metadata?.providerBrand ?? null}
								providerLabel={agent.provider_metadata?.displayName ?? agent.name}
								class="h-5 w-5"
								size={20}
							/>
						</DropdownMenu.Item>
					</Tooltip.Trigger>
					<Tooltip.Content>
						{`New ${agent.name} session`}
					</Tooltip.Content>
				</Tooltip.Root>
			{/each}
		</div>
	</Selector>
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
