<script lang="ts">
import { onDestroy, onMount } from "svelte";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { computeProjectBadgeLabels } from "@acepe/ui";
import type { FileGitStatus } from "$lib/services/converted-session-types.js";
import { tauriClient } from "$lib/utils/tauri-client.js";
import type { Project } from "../logic/project-manager.svelte.js";
import ProjectCard from "./project-card.svelte";
import type { ProjectCardData } from "./project-card-data.js";
import { getVisibleProjectSelectionProjects } from "./project-selection-visibility.js";
import {
	buildProjectSelectionCardDataList,
	createProjectSelectionMetadataScheduler,
	getProjectSelectionModifierSymbol,
	getProjectSelectionPathsKey,
	getProjectSelectionShortcutIndex,
	getSelectableProjectByIndex,
	isProjectSelectionTextInputTarget,
	shouldSyncProjectSelectionMetadata,
} from "./project-selection-panel-state.js";
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
	onProjectSelected: (project: Project) => void;
	preSelectedProjectPath?: string | null;
}

let { projects, onProjectSelected, preSelectedProjectPath = null }: Props = $props();
const isMac = typeof navigator !== "undefined" && navigator.platform.includes("Mac");
const modifierSymbol = getProjectSelectionModifierSymbol(
	typeof navigator !== "undefined" ? navigator.platform : undefined
);

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
let lastProjectsKey = "";
let lastDisplayProjectsKey = "";
const scheduleProjectSelectionMetadata = createProjectSelectionMetadataScheduler();
let cancelScheduledProjectSelectionMetadataSync: (() => void) | null = null;

const cardDataList = $derived<ProjectCardData[]>(
	buildProjectSelectionCardDataList({
		displayProjects,
		cardDataByPath: cardDataMap,
		getCachedMetadata: getCachedProjectSelectionMetadata,
		remoteStatusByPath: remoteStatusMap,
	})
);

const labelByPath = $derived(
	computeProjectBadgeLabels(projects.map((project) => ({ key: project.path, name: project.name })))
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
					remoteStatusMap.delete(projectPath);
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

function refreshMissingProjectPaths(): void {
	if (typeof window === "undefined") {
		return;
	}

	const projectsKey = getProjectSelectionPathsKey(projects);
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
		},
		() => undefined
	);
}

function syncDisplayedProjectMetadata(): void {
	if (typeof window === "undefined") {
		return;
	}

	const displayProjectsKey = getProjectSelectionPathsKey(displayProjects);
	const hasRetryableMetadata = displayProjects.some((project) =>
		shouldLoadProjectSelectionMetadata(project.path)
	);
	if (
		!shouldSyncProjectSelectionMetadata({
			displayProjectsKey,
			lastDisplayProjectsKey,
			hasRetryableMetadata,
		})
	) {
		return;
	}
	lastDisplayProjectsKey = displayProjectsKey;

	for (const project of displayProjects) {
		ensureProjectInfoLoaded(project);
	}
}

function syncProjectSelectionState(): void {
	refreshMissingProjectPaths();
	syncDisplayedProjectMetadata();
}

function handleKeyDown(event: KeyboardEvent) {
	if (isProjectSelectionTextInputTarget(event.target)) {
		return;
	}

	const index = getProjectSelectionShortcutIndex({
		key: event.key,
		isMac,
		metaKey: event.metaKey,
		ctrlKey: event.ctrlKey,
		altKey: event.altKey,
		shiftKey: event.shiftKey,
	});
	if (index === null) {
		return;
	}

	const project = getSelectableProjectByIndex({
		projects: displayProjects,
		index,
		missingProjectPaths,
	});
	if (project) {
		event.preventDefault();
		event.stopPropagation();
		onProjectSelected(project);
	}
}

function handleProjectSelect(index: number) {
	const project = getSelectableProjectByIndex({
		projects: displayProjects,
		index,
		missingProjectPaths,
	});
	if (project) {
		onProjectSelected(project);
	}
}

onMount(() => {
	window.addEventListener("keydown", handleKeyDown);
	cancelScheduledProjectSelectionMetadataSync =
		scheduleProjectSelectionMetadata(syncProjectSelectionState);
});

onDestroy(() => {
	window.removeEventListener("keydown", handleKeyDown);
	if (cancelScheduledProjectSelectionMetadataSync !== null) {
		cancelScheduledProjectSelectionMetadataSync();
		cancelScheduledProjectSelectionMetadataSync = null;
	}
});
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="flex flex-col items-center justify-center h-full p-4 gap-4">
	<div class="flex flex-col gap-1.5 w-full max-w-xs">
		{#each cardDataList as data, index (data.project.path)}
			<ProjectCard
				{data}
				{index}
				{modifierSymbol}
				label={labelByPath.get(data.project.path) ?? null}
				isMissing={missingProjectPaths.has(data.project.path)}
				onSelect={() => handleProjectSelect(index)}
			/>
		{/each}
	</div>
</div>
