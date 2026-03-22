<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import { Kbd, KbdGroup } from "$lib/components/ui/kbd/index.js";
import * as m from "$lib/paraglide/messages.js";
import type { FileGitStatus } from "$lib/services/converted-session-types.js";
import { tauriClient } from "$lib/utils/tauri-client.js";
import "@acepe/ui/markdown-prose.css";

import { getAgentIcon } from "../constants/thread-list-constants.js";
import type { AgentInfo } from "../logic/agent-manager.js";
import type { Project } from "../logic/project-manager.svelte.js";
import { capitalizeName } from "../utils/index.js";
import ProjectCard from "./project-card.svelte";
import type { ProjectCardData } from "./project-card-data.js";
import {
	getCachedProjectSelectionMetadata,
	markProjectSelectionMetadataFieldLoadFinished,
	markProjectSelectionMetadataFieldLoadStarted,
	setCachedProjectSelectionMetadata,
	shouldLoadProjectSelectionMetadataField,
} from "./project-selection-metadata-cache.js";

interface Props {
	projects: Project[];
	availableAgents: AgentInfo[];
	effectiveTheme: "light" | "dark";
	onProjectAgentSelected: (project: Project, agentId: string) => void;
	preSelectedProjectPath?: string | null;
}

let {
	projects,
	availableAgents,
	effectiveTheme,
	onProjectAgentSelected,
	preSelectedProjectPath = null,
}: Props = $props();
const isMac = typeof navigator !== "undefined" && navigator.platform.includes("Mac");
const modifierSymbol = isMac ? "⌘" : "Ctrl";

// Two-stage keyboard selection state
let focusedProjectIndex = $state<number | null>(null);
const displayProjects = $derived.by(() => {
	if (!preSelectedProjectPath) {
		return projects;
	}
	const matchingProject = projects.find((project) => project.path === preSelectedProjectPath);
	return matchingProject ? [matchingProject] : projects;
});
const isSinglePreselectedProject = $derived.by(
	() => !!preSelectedProjectPath && displayProjects.length === 1
);

const cardDataMap = new SvelteMap<
	string,
	{
		branch: string | null;
		gitStatus: ReadonlyArray<FileGitStatus> | null;
	}
>();

const cardDataList = $derived<ProjectCardData[]>(
	displayProjects.map((project) => {
		const cached = cardDataMap.get(project.path) ?? getCachedProjectSelectionMetadata(project.path);
		return {
			project,
			branch: cached?.branch ?? null,
			gitStatus: cached?.gitStatus ?? null,
		};
	})
);

function setProjectCardData(
	projectPath: string,
	data: {
		branch: string | null;
		gitStatus: ReadonlyArray<FileGitStatus> | null;
	}
): void {
	setCachedProjectSelectionMetadata(projectPath, data);
	cardDataMap.set(projectPath, data);
}

function updateProjectCardData(
	projectPath: string,
	updates: Partial<{
		branch: string | null;
		gitStatus: ReadonlyArray<FileGitStatus> | null;
	}>
): void {
	const current = getCachedProjectSelectionMetadata(projectPath) ?? {
		branch: null,
		gitStatus: null,
	};
	setProjectCardData(projectPath, {
		branch: updates.branch ?? current.branch,
		gitStatus: updates.gitStatus ?? current.gitStatus,
	});
}

function ensureProjectInfoLoaded(project: Project): void {
	const projectPath = project.path;
	const cached = getCachedProjectSelectionMetadata(projectPath);
	if (cached) {
		cardDataMap.set(projectPath, cached);
	}

	const shouldLoadBranch = shouldLoadProjectSelectionMetadataField(projectPath, "branch");
	const shouldLoadGitStatus = shouldLoadProjectSelectionMetadataField(projectPath, "gitStatus");
	if (shouldLoadBranch || shouldLoadGitStatus) {
		if (shouldLoadBranch) {
			markProjectSelectionMetadataFieldLoadStarted(projectPath, "branch");
		}
		if (shouldLoadGitStatus) {
			markProjectSelectionMetadataFieldLoadStarted(projectPath, "gitStatus");
		}

		void tauriClient.fileIndex.getProjectGitOverviewSummary(projectPath).match(
			(overview) => {
				updateProjectCardData(projectPath, {
					branch: overview.branch,
					gitStatus: overview.gitStatus,
				});
				if (shouldLoadBranch) {
					markProjectSelectionMetadataFieldLoadFinished(projectPath, "branch", true);
				}
				if (shouldLoadGitStatus) {
					markProjectSelectionMetadataFieldLoadFinished(projectPath, "gitStatus", true);
				}
			},
			() => {
				if (shouldLoadBranch) {
					markProjectSelectionMetadataFieldLoadFinished(projectPath, "branch", false);
				}
				if (shouldLoadGitStatus) {
					markProjectSelectionMetadataFieldLoadFinished(projectPath, "gitStatus", false);
				}
			}
		);
	}
}

$effect(() => {
	if (typeof window === "undefined" || isSinglePreselectedProject) {
		return;
	}

	for (const project of displayProjects) {
		ensureProjectInfoLoaded(project);
	}
});

$effect(() => {
	if (!isSinglePreselectedProject) {
		if (focusedProjectIndex !== null && focusedProjectIndex >= displayProjects.length) {
			focusedProjectIndex = null;
		}
		return;
	}
	focusedProjectIndex = 0;
	const preselectedProject = displayProjects[0];
	if (preselectedProject) {
		ensureProjectInfoLoaded(preselectedProject);
	}
});

function handleKeyDown(event: KeyboardEvent) {
	const target = event.target as HTMLElement;
	if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
		return;
	}

	// Handle Escape to clear focus
	if (event.key === "Escape" && focusedProjectIndex !== null) {
		if (isSinglePreselectedProject) {
			return;
		}
		event.preventDefault();
		focusedProjectIndex = null;
		return;
	}

	const hasModifier = isMac ? event.metaKey : event.ctrlKey;
	const hasWrongModifier = isMac ? event.ctrlKey : event.metaKey;
	if (!hasModifier || hasWrongModifier || event.altKey || event.shiftKey) {
		return;
	}

	if (event.key >= "1" && event.key <= "9") {
		const index = Number.parseInt(event.key, 10) - 1;

		if (focusedProjectIndex !== null) {
			// Stage 2: A project is focused, select an agent
			if (index < availableAgents.length) {
				const agent = availableAgents[index];
				if (agent.available) {
					event.preventDefault();
					event.stopPropagation();
					const project = displayProjects[focusedProjectIndex];
					focusedProjectIndex = null;
					onProjectAgentSelected(project, agent.id);
				}
			}
		} else {
			// Stage 1: No project focused, focus a project
			if (index < displayProjects.length) {
				event.preventDefault();
				event.stopPropagation();
				focusedProjectIndex = index;
				const project = displayProjects[index];
				if (project) {
					ensureProjectInfoLoaded(project);
				}
			}
		}
	}
}

function handleProjectFocus(index: number) {
	focusedProjectIndex = index;
	const project = displayProjects[index];
	if (project) {
		ensureProjectInfoLoaded(project);
	}
}

function handleAgentSelect(projectIndex: number, agentId: string) {
	const project = displayProjects[projectIndex];
	onProjectAgentSelected(project, agentId);
}

// Clear focus when clicking outside
function handleContainerClick(event: MouseEvent) {
	if (isSinglePreselectedProject) {
		return;
	}
	const target = event.target as HTMLElement;
	// If clicking directly on the container (not a child card), clear focus
	if (target === event.currentTarget) {
		focusedProjectIndex = null;
	}
}

onMount(() => {
	window.addEventListener("keydown", handleKeyDown);
});

onDestroy(() => {
	window.removeEventListener("keydown", handleKeyDown);
});
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="flex flex-col items-center justify-center h-full p-4 gap-4"
	onclick={handleContainerClick}
>
	{#if !isSinglePreselectedProject}
		<!-- How it works (below title, markdown-style table with keybinds on right) -->
		<div
			class="markdown-content w-full max-w-xs text-left"
			role="region"
			aria-label={m.project_select_how_title()}
		>
			<span class="text-[11px] text-muted-foreground block mb-1.5"
				>{m.project_select_how_title()}</span
			>
			<div class="table-wrapper">
				<table>
					<tbody>
						<tr>
							<td>1. {m.project_select_how_step1()}</td>
							<td class="text-right whitespace-nowrap w-0">
								<KbdGroup class="inline-flex justify-end">
									<Kbd class="text-[10px] px-1 py-0.5 min-w-0">{modifierSymbol}</Kbd>
									<Kbd class="text-[10px] px-1 py-0.5 min-w-0">1-9</Kbd>
								</KbdGroup>
							</td>
						</tr>
						<tr>
							<td>2. {m.project_select_how_step2()}</td>
							<td class="text-right whitespace-nowrap w-0">
								<KbdGroup class="inline-flex justify-end">
									<Kbd class="text-[10px] px-1 py-0.5 min-w-0">{modifierSymbol}</Kbd>
									<Kbd class="text-[10px] px-1 py-0.5 min-w-0">1-9</Kbd>
								</KbdGroup>
							</td>
						</tr>
					</tbody>
				</table>
			</div>
		</div>
	{/if}

	{#if isSinglePreselectedProject}
		<div class="grid grid-cols-2 gap-px rounded-md border border-border/50 overflow-hidden">
			{#each availableAgents as agent (agent.id)}
				{@const iconSrc = getAgentIcon(agent.id, effectiveTheme)}
				{#if agent.available}
					<button
						class="flex items-center gap-2 px-2.5 py-2 bg-popover opacity-60 hover:opacity-100 hover:bg-accent/50 transition-all cursor-pointer"
						onclick={() => handleAgentSelect(0, agent.id)}
					>
						<img src={iconSrc} alt={agent.name} class="h-6 w-6 shrink-0" />
						<span class="text-[11px] font-semibold text-foreground truncate">
							{capitalizeName(agent.name)}
						</span>
					</button>
				{:else}
					<button
						class="flex items-center gap-2 px-2.5 py-2 bg-popover opacity-25 cursor-not-allowed"
						disabled
					>
						<img src={iconSrc} alt={agent.name} class="h-6 w-6 shrink-0 grayscale" />
						<span class="text-[11px] font-semibold text-foreground truncate">
							{capitalizeName(agent.name)}
						</span>
					</button>
				{/if}
			{/each}
		</div>
	{:else}
		<div class="flex flex-col gap-1.5 w-full max-w-xs">
			{#each cardDataList as data, index (data.project.path)}
				<ProjectCard
					{data}
					{index}
					{availableAgents}
					{effectiveTheme}
					isFocused={focusedProjectIndex === index}
					onFocus={() => handleProjectFocus(index)}
					onAgentSelect={(agentId) => handleAgentSelect(index, agentId)}
				/>
			{/each}
		</div>
	{/if}
</div>
