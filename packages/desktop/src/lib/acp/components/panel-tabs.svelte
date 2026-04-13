<script lang="ts">
import { ProjectLetterBadge } from "@acepe/ui";
import { IconX } from "@tabler/icons-svelte";
import { normalizeTitleForDisplay } from "$lib/acp/store/session-title-policy.js";
import { Button } from "$lib/components/ui/button/index.js";
import * as Tooltip from "$lib/components/ui/tooltip/index.js";
import * as m from "$lib/messages.js";

import type { Project } from "../logic/project-manager.svelte.js";

import { getProjectColor } from "../utils/colors.js";
import AgentIcon from "./agent-icon.svelte";

/**
 * Panel tab info - uses granular session props instead of session object.
 */
interface PanelTabInfo {
	id: string;
	sessionId: string | null;
	sessionProjectPath: string | null;
	sessionTitle: string | null;
	agentId: string | null;
	width: number;
	pendingProjectSelection?: boolean;
}

interface Props {
	panels: PanelTabInfo[];
	focusedPanelId: string | null;
	recentProjects: Project[];
	onSelectPanel: (panelId: string) => void;
	onClosePanel: (panelId: string) => void;
}

let { panels, focusedPanelId, recentProjects, onSelectPanel, onClosePanel }: Props = $props();

function getProjectForSession(projectPath: string | null): Project | null {
	if (!projectPath) return null;
	return recentProjects.find((p) => p.path === projectPath) ?? null;
}

function getProjectInfo(panel: PanelTabInfo): { name: string; color: string } {
	const project = getProjectForSession(panel.sessionProjectPath);
	if (project) {
		return { name: project.name, color: getProjectColor(project) };
	}
	return { name: "?", color: "var(--orange-500, #f97316)" };
}
</script>

<div class="flex items-center gap-0.5 overflow-x-auto">
	{#each panels as panel (panel.id)}
		{@const isFocused = panel.id === focusedPanelId}
		{@const projectInfo = getProjectInfo(panel)}
		{@const title =
			normalizeTitleForDisplay(panel.sessionTitle ?? "") || m.agent_panel_new_thread()}
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						variant="ghost"
						size="sm"
						class="group flex items-center gap-2 px-2 py-1.5 h-auto {isFocused ? 'bg-accent' : ''}"
						onclick={() => onSelectPanel(panel.id)}
					>
						<!-- Project letter badge -->
						<ProjectLetterBadge name={projectInfo.name} color={projectInfo.color} />

						<!-- Agent icon -->
						{#if panel.agentId}
							<AgentIcon agentId={panel.agentId} size={16} class="shrink-0" />
						{/if}

						<!-- Title -->
						<span class="text-sm max-w-[150px] truncate">{title}</span>

						<!-- Close button -->
						<button
							type="button"
							class="h-5 w-5 p-0 rounded-sm opacity-0 group-hover:opacity-100 transition-opacity shrink-0 hover:bg-accent flex items-center justify-center"
							onclick={(e: MouseEvent) => {
								e.stopPropagation();
								onClosePanel(panel.id);
							}}
						>
							<IconX class="h-3 w-3" />
							<span class="sr-only">{m.common_close()}</span>
						</button>
					</Button>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content side="bottom">
				{m.panel_tabs_tooltip()}
			</Tooltip.Content>
		</Tooltip.Root>
	{/each}
</div>
