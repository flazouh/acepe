<script lang="ts">
import X from "phosphor-svelte/lib/X";
import * as Tooltip from "$lib/components/ui/tooltip/index.js";
import * as m from "$lib/paraglide/messages.js";
import { getAgentIcon } from "../constants/thread-list-constants.js";
import type { AgentInfo } from "../logic/agent-manager.js";

interface Props {
	projectPath: string;
	projectName: string;
	availableAgents: AgentInfo[];
	effectiveTheme: "light" | "dark";
	onCancel: (projectPath: string) => void;
	onCreateSession: (projectPath: string, agentId: string) => void;
}

let {
	projectPath,
	projectName,
	availableAgents,
	effectiveTheme,
	onCancel,
	onCreateSession,
}: Props = $props();

function handleCancel(event: MouseEvent) {
	event.stopPropagation();
	onCancel(projectPath);
}

function handleAgentClick(event: MouseEvent, agent: AgentInfo) {
	event.stopPropagation();
	if (agent.available) {
		onCreateSession(projectPath, agent.id);
	}
}
</script>

<div class="flex items-center justify-end h-7 w-full">
	<!-- Agent icons (left of X) -->
	<div class="flex items-center">
		{#each [...availableAgents] as agent (agent.id)}
			<Tooltip.Root>
				<Tooltip.Trigger>
					<button
						type="button"
						class="inline-flex items-center justify-center h-7 w-7 p-1.5 rounded-none border-l border-border/50 cursor-pointer text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
						disabled={!agent.available}
						onclick={(e) => handleAgentClick(e, agent)}
						aria-label={agent.available
							? m.thread_list_new_agent_session({ agentName: agent.name })
							: `${agent.name} (not installed)`}
					>
						<img
							src={getAgentIcon(agent.id, effectiveTheme)}
							alt={agent.name}
							class="h-4 w-4 shrink-0"
						/>
					</button>
				</Tooltip.Trigger>
				<Tooltip.Content>
					{agent.available
						? m.thread_list_new_agent_session({ agentName: agent.name })
						: `${agent.name} (not installed)`}
				</Tooltip.Content>
			</Tooltip.Root>
		{/each}
	</div>

	<!-- Cancel (X) on the right (plus icon position) -->
	<Tooltip.Root>
		<Tooltip.Trigger>
			<button
				type="button"
				class="inline-flex items-center justify-center h-7 w-7 cursor-pointer text-muted-foreground hover:bg-accent hover:text-foreground transition-colors border-l border-border/50"
				onclick={handleCancel}
				aria-label={m.common_cancel()}
			>
				<X class="h-3 w-3" weight="bold" />
			</button>
		</Tooltip.Trigger>
		<Tooltip.Content>{m.common_cancel()}</Tooltip.Content>
	</Tooltip.Root>
</div>
