<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import * as m from "$lib/paraglide/messages.js";
import type { FileGitStatus } from "$lib/services/converted-session-types.js";
import { tauriClient } from "$lib/utils/tauri-client.js";
import { getAgentIcon } from "../constants/thread-list-constants.js";
import type { AgentInfo } from "../logic/agent-manager.js";
import type { Project } from "../logic/project-manager.svelte.js";
import { capitalizeName } from "../utils/index.js";
import ProjectCard from "./project-card.svelte";
import type { ProjectCardData } from "./project-card-data.js";
import { getVisibleProjectSelectionProjects } from "./project-selection-visibility.js";
import {
	getCachedProjectSelectionMetadata,
	markProjectSelectionMetadataFieldLoadFinished,
	markProjectSelectionMetadataFieldLoadStarted,
	setCachedProjectSelectionMetadata,
	shouldLoadProjectSelectionMetadata,
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
const missingProjectPaths = new SvelteSet<string>();
const cardDataMap = new SvelteMap<
	string,
	{
		branch: string | null;
		gitStatus: ReadonlyArray<FileGitStatus> | null;
	}
>();
const remoteStatusMap = new SvelteMap<string, { ahead: number; behind: number }>();

const displayProjects = $derived.by(() => {
	return getVisibleProjectSelectionProjects(projects, preSelectedProjectPath, missingProjectPaths);
});
const isSinglePreselectedProject = $derived.by(
	() => !!preSelectedProjectPath && displayProjects.length === 1
);
let lastProjectsKey = "";
let lastDisplayProjectsKey = "";

const effectiveFocusedIndex = $derived.by<number | null>(() => {
	if (isSinglePreselectedProject) {
		return displayProjects.length > 0 ? 0 : null;
	}
	if (focusedProjectIndex !== null && focusedProjectIndex >= displayProjects.length) {
		return null;
	}
	return focusedProjectIndex;
});

const cardDataList = $derived<ProjectCardData[]>(
	displayProjects.map((project) => {
		const cached = cardDataMap.get(project.path) ?? getCachedProjectSelectionMetadata(project.path);
		const remote = remoteStatusMap.get(project.path);
		return {
			project,
			branch: cached?.branch ?? null,
			gitStatus: cached?.gitStatus ?? null,
			ahead: remote?.ahead ?? null,
			behind: remote?.behind ?? null,
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
	if (missingProjectPaths.has(projectPath)) {
		return;
	}
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

		void tauriClient.git.isRepo(projectPath).match(
			(isRepo) => {
				if (!isRepo) {
					setProjectCardData(projectPath, {
						branch: null,
						gitStatus: null,
					});
					if (shouldLoadBranch) {
						markProjectSelectionMetadataFieldLoadFinished(projectPath, "branch", false);
					}
					if (shouldLoadGitStatus) {
						markProjectSelectionMetadataFieldLoadFinished(projectPath, "gitStatus", false);
					}
					return;
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
						// Fetch remote status (ahead/behind) in background
						void tauriClient.git.remoteStatus(projectPath).match(
							(remote) => {
								remoteStatusMap.set(projectPath, {
									ahead: remote.ahead,
									behind: remote.behind,
								});
							},
							() => {
								/* no remote or not a git repo — ignore */
							}
						);
					},
					(err) => {
						const msg = err instanceof Error ? err.message : String(err);
						if (
							msg.includes("not found") ||
							msg.includes("not a directory") ||
							msg.includes("does not exist")
						) {
							missingProjectPaths.add(projectPath);
						}
						if (shouldLoadBranch) {
							markProjectSelectionMetadataFieldLoadFinished(projectPath, "branch", false);
						}
						if (shouldLoadGitStatus) {
							markProjectSelectionMetadataFieldLoadFinished(projectPath, "gitStatus", false);
						}
					}
				);
			},
			(err) => {
				const msg = err instanceof Error ? err.message : String(err);
				if (
					msg.includes("not found") ||
					msg.includes("not a directory") ||
					msg.includes("does not exist")
				) {
					missingProjectPaths.add(projectPath);
				}
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

function updateMissingProjectPaths(paths: readonly string[]): void {
	const nextMissingPaths = new Set(paths);

	for (const existingPath of Array.from(missingProjectPaths)) {
		if (!nextMissingPaths.has(existingPath)) {
			missingProjectPaths.delete(existingPath);
		}
	}

	for (const path of nextMissingPaths) {
		if (!missingProjectPaths.has(path)) {
			missingProjectPaths.add(path);
		}
	}
}

function getProjectPathsKey(list: readonly Project[]): string {
	return list.map((project) => project.path).join("\n");
}

function refreshMissingProjectPaths(): void {
	if (typeof window === "undefined") {
		return;
	}

	const projectsKey = getProjectPathsKey(projects);
	if (projectsKey === lastProjectsKey) {
		return;
	}
	lastProjectsKey = projectsKey;

	const projectPaths = projects.map((project) => project.path);
	if (projectPaths.length === 0) {
		updateMissingProjectPaths([]);
		syncDisplayedProjectMetadata();
		return;
	}

	void tauriClient.projects.getMissingProjectPaths(projectPaths).match(
		(paths) => {
			updateMissingProjectPaths(paths);
			syncDisplayedProjectMetadata();
			if (isSinglePreselectedProject) {
				const preselectedProject = displayProjects[0];
				if (preselectedProject && !missingProjectPaths.has(preselectedProject.path)) {
					ensureProjectInfoLoaded(preselectedProject);
				}
			}
		},
		() => undefined
	);
}

function syncDisplayedProjectMetadata(): void {
	if (typeof window === "undefined") {
		return;
	}

	const displayProjectsKey = getProjectPathsKey(displayProjects);
	const hasRetryableMetadata = displayProjects.some((project) =>
		shouldLoadProjectSelectionMetadata(project.path)
	);
	if (
		!isSinglePreselectedProject &&
		displayProjectsKey === lastDisplayProjectsKey &&
		!hasRetryableMetadata
	) {
		return;
	}
	lastDisplayProjectsKey = displayProjectsKey;

	if (isSinglePreselectedProject) {
		return;
	}

	for (const project of displayProjects) {
		ensureProjectInfoLoaded(project);
	}
}

function syncProjectSelectionState(): void {
	refreshMissingProjectPaths();
	syncDisplayedProjectMetadata();
}

function handleKeyDown(event: KeyboardEvent) {
	const target = event.target as HTMLElement;
	if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
		return;
	}

	// Handle Escape to clear focus
	if (event.key === "Escape" && effectiveFocusedIndex !== null) {
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

		if (effectiveFocusedIndex !== null) {
			// Stage 2: A project is focused, select an agent
			if (index < availableAgents.length) {
				event.preventDefault();
				event.stopPropagation();
				const project = displayProjects[effectiveFocusedIndex];
				focusedProjectIndex = null;
				onProjectAgentSelected(project, availableAgents[index].id);
			}
		} else {
			// Stage 1: No project focused, focus a project
			if (index < displayProjects.length) {
				const project = displayProjects[index];
				if (project && !missingProjectPaths.has(project.path)) {
					event.preventDefault();
					event.stopPropagation();
					focusedProjectIndex = index;
					ensureProjectInfoLoaded(project);
				}
			}
		}
	}
}

function handleProjectFocus(index: number) {
	const project = displayProjects[index];
	if (project && missingProjectPaths.has(project.path)) return;
	focusedProjectIndex = index;
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
	syncProjectSelectionState();
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
	{#if isSinglePreselectedProject}
		<div class="grid grid-cols-2 gap-px rounded-md border border-border/50 overflow-hidden">
			{#each availableAgents as agent (agent.id)}
				{@const iconSrc = getAgentIcon(agent.id, effectiveTheme)}
				<button
					class="flex items-center gap-2 px-2.5 py-2 bg-popover opacity-60 hover:opacity-100 hover:bg-accent/50 transition-all cursor-pointer"
					onclick={() => handleAgentSelect(0, agent.id)}
				>
					<img src={iconSrc} alt={agent.name} class="h-6 w-6 shrink-0" />
					<span class="text-[11px] font-semibold text-foreground truncate">
						{capitalizeName(agent.name)}
					</span>
				</button>
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
					{modifierSymbol}
					isMissing={missingProjectPaths.has(data.project.path)}
					isFocused={effectiveFocusedIndex === index}
					onFocus={() => handleProjectFocus(index)}
					onAgentSelect={(agentId) => handleAgentSelect(index, agentId)}
				/>
			{/each}
		</div>
	{/if}
</div>
