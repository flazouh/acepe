<script lang="ts">
import { Browser } from "phosphor-svelte";
import { Terminal } from "phosphor-svelte";
import { X } from "phosphor-svelte";
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
	onOpenTerminal?: (projectPath: string) => void;
	onOpenBrowser?: (projectPath: string) => void;
}

let {
	projectPath,
	projectName,
	availableAgents,
	effectiveTheme,
	onCancel,
	onCreateSession,
	onOpenTerminal,
	onOpenBrowser,
}: Props = $props();

function handleCancel(event: MouseEvent) {
	event.stopPropagation();
	onCancel(projectPath);
}

function handleOpenTerminal(event: MouseEvent) {
	event.stopPropagation();
	onOpenTerminal?.(projectPath);
}

function handleOpenBrowser(event: MouseEvent) {
	event.stopPropagation();
	onOpenBrowser?.(projectPath);
}

function handleAgentClick(event: MouseEvent, agent: AgentInfo) {
	event.stopPropagation();
	onCreateSession(projectPath, agent.id);
}
</script>


<div class="flex h-7 w-full items-center justify-between px-0.5">
	<div class="flex items-center gap-0.5">
		{#if onOpenTerminal}
			<Tooltip.Root>
				<Tooltip.Trigger>
					<button
						type="button"
						class="flex items-center justify-center size-6 rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
						onclick={handleOpenTerminal}
						aria-label={m.sidebar_open_terminal({ projectName })}
					>
						<Terminal class="h-3.5 w-3.5" weight="fill" />
					</button>
				</Tooltip.Trigger>
				<Tooltip.Content>{m.sidebar_open_terminal({ projectName })}</Tooltip.Content>
			</Tooltip.Root>
		{/if}

		{#if onOpenBrowser}
			<Tooltip.Root>
				<Tooltip.Trigger>
					<button
						type="button"
						class="flex items-center justify-center size-6 rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
						onclick={handleOpenBrowser}
						aria-label={m.sidebar_open_browser({ projectName })}
					>
						<Browser class="h-3.5 w-3.5" weight="fill" />
					</button>
				</Tooltip.Trigger>
				<Tooltip.Content>{m.sidebar_open_browser({ projectName })}</Tooltip.Content>
			</Tooltip.Root>
		{/if}
	</div>

	<div class="flex items-center gap-0.5">
		{#each availableAgents as agent (agent.id)}
			<Tooltip.Root>
				<Tooltip.Trigger>
					<button
						type="button"
						class="flex items-center justify-center size-6 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
						onclick={(e) => handleAgentClick(e, agent)}
						aria-label={m.thread_list_new_agent_session({ agentName: agent.name })}
					>
						<img
							src={getAgentIcon(agent.id, effectiveTheme)}
							alt={agent.name}
							class="h-4 w-4 shrink-0"
						/>
					</button>
				</Tooltip.Trigger>
				<Tooltip.Content>
					{m.thread_list_new_agent_session({ agentName: agent.name })}
				</Tooltip.Content>
			</Tooltip.Root>
		{/each}

		<Tooltip.Root>
			<Tooltip.Trigger>
				<button
					type="button"
					class="flex items-center justify-center size-6 rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					onclick={handleCancel}
					aria-label={m.common_cancel()}
				>
					<X class="h-3 w-3" weight="bold" />
				</button>
			</Tooltip.Trigger>
			<Tooltip.Content>{m.common_cancel()}</Tooltip.Content>
		</Tooltip.Root>
	</div>
</div>
