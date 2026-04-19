<script lang="ts">
import { onMount } from "svelte";
import { SvelteSet } from "svelte/reactivity";
import { ProjectSelectorView, type ProjectSelectorViewItem } from "@acepe/ui";
import { useTheme } from "$lib/components/theme/context.svelte.js";
import { tauriClient } from "$lib/utils/tauri-client.js";
import { LOGGER_IDS } from "../constants/logger-ids.js";

import { getAgentIcon } from "../constants/thread-list-constants.js";
import type { Project } from "../logic/project-manager.svelte.js";
import { getProjectColor, TAG_COLORS } from "../utils/colors.js";
import { createLogger } from "../utils/logger.js";

interface ProjectSelectorProps {
	selectedProject: Project | null;
	recentProjects: Project[];
	missingProjectPaths?: ReadonlySet<string>;
	onProjectChange: (project: Project) => void;
	onBrowse: () => void;
	onImport?: () => void | Promise<void>;
	onManageProjects?: () => void;
	isLoading?: boolean;
	ontoggle?: (isOpen: boolean) => void;
}

let {
	selectedProject,
	recentProjects,
	missingProjectPaths,
	onProjectChange,
	onBrowse,
	onImport,
	onManageProjects,
	isLoading = false,
	ontoggle,
}: ProjectSelectorProps = $props();

let viewRef: { toggle: () => void } | undefined = $state();
let isOpen = $state(false);
const localMissingPaths = new SvelteSet<string>();
const effectiveMissingPaths = $derived(missingProjectPaths ?? localMissingPaths);

const _logger = createLogger({
	id: LOGGER_IDS.PROJECT_SELECTOR,
	name: "Project Selector",
});

onMount(() => {
	if (missingProjectPaths) return;
	const paths = recentProjects.map((p) => p.path);
	if (paths.length === 0) return;
	void tauriClient.projects.getMissingProjectPaths(paths).match(
		(missing) => {
			for (const p of missing) localMissingPaths.add(p);
		},
		() => {}
	);
});

const themeState = useTheme();

export function toggle() {
	viewRef?.toggle();
}

const selectedItem = $derived<ProjectSelectorViewItem | null>(
	selectedProject
		? {
				path: selectedProject.path,
				name: selectedProject.name,
				color: getProjectColor(selectedProject),
				iconSrc: selectedProject.iconPath ?? null,
			}
		: null
);

const recentItems = $derived<readonly ProjectSelectorViewItem[]>(
	recentProjects.map((project) => ({
		path: project.path,
		name: project.name,
		color: getProjectColor(project),
		iconSrc: project.iconPath ?? null,
		isMissing: effectiveMissingPaths.has(project.path),
	}))
);

const importIcon = $derived(
	onImport ? (getAgentIcon("claude-code", themeState.effectiveTheme) ?? null) : null
);

function handleSelectByPath(path: string) {
	const project = recentProjects.find((p) => p.path === path);
	if (!project) return;
	if (project.path !== selectedProject?.path) {
		onProjectChange(project);
	}
	isOpen = false;
}

function handleOpenChange(open: boolean) {
	isOpen = open;
	ontoggle?.(open);
}

function handleImport() {
	if (!onImport) return;
	const result = onImport();
	if (result instanceof Promise) {
		void result;
	}
}
</script>

<ProjectSelectorView
	bind:this={viewRef}
	bind:open={isOpen}
	selectedProject={selectedItem}
	recentProjects={recentItems}
	{isLoading}
	fallbackColor={TAG_COLORS[0]}
	onSelect={handleSelectByPath}
	{onBrowse}
	onImport={onImport ? handleImport : undefined}
	onManage={onManageProjects}
	importLabel={onImport ? "Import from Claude..." : null}
	importIconSrc={importIcon}
	manageLabel={onManageProjects ? "Manage projects..." : null}
	onOpenChange={handleOpenChange}
/>
