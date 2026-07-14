<script lang="ts">
import { HugeiconsIcon, ProjectLetterBadge, computeProjectBadgeLabels } from "@acepe/ui";
import { normalizeTitleForDisplay } from "$lib/acp/store/session-title-policy.js";
import { Button } from "$lib/components/ui/button/index.js";
import * as Tooltip from "@acepe/ui/tooltip";
import type { Project } from "../logic/project-manager.svelte.js";

import { getProjectColor } from "@acepe/ui/colors";
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

const labelByPath = $derived(
	computeProjectBadgeLabels(recentProjects.map((p) => ({ key: p.path, name: p.name })))
);

function getProjectForSession(projectPath: string | null): Project | null {
	if (!projectPath) return null;
	return recentProjects.find((p) => p.path === projectPath) ?? null;
}

function getProjectInfo(panel: PanelTabInfo): {
	name: string;
	color: string;
	iconSrc: string | null;
} {
	const project = getProjectForSession(panel.sessionProjectPath);
	if (project) {
		return {
			name: project.name,
			color: getProjectColor(project),
			iconSrc: project.iconPath ?? null,
		};
	}
	return { name: "?", color: "var(--orange-500, #f97316)", iconSrc: null };
}
</script>

<div class="flex items-center gap-0.5 overflow-x-auto">
	{#each panels as panel (panel.id)}
		{@const isFocused = panel.id === focusedPanelId}
		{@const projectInfo = getProjectInfo(panel)}
		{@const title =
			normalizeTitleForDisplay(panel.sessionTitle ?? "") || "New Thread"}
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
						<ProjectLetterBadge
							name={projectInfo.name}
							label={panel.sessionProjectPath
								? (labelByPath.get(panel.sessionProjectPath) ?? null)
								: null}
							color={projectInfo.color}
							iconSrc={projectInfo.iconSrc}
						/>

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
							<HugeiconsIcon name="close" class="h-3 w-3" />
							<span class="sr-only">{"Close"}</span>
						</button>
					</Button>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content side="bottom">
				{"Click to focus panel"}
			</Tooltip.Content>
		</Tooltip.Root>
	{/each}
</div>
