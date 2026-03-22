<script lang="ts">
import { ProjectLetterBadge, Selector } from "@acepe/ui";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { useTheme } from "$lib/components/theme/context.svelte.js";
import { Skeleton } from "$lib/components/ui/skeleton/index.js";
import { LOGGER_IDS } from "../constants/logger-ids.js";

import { getAgentIcon } from "../constants/thread-list-constants.js";
import type { Project } from "../logic/project-manager.svelte.js";
import { getProjectColor, TAG_COLORS } from "../utils/colors.js";
import { capitalizeName } from "../utils/index.js";
import { createLogger } from "../utils/logger.js";
import SelectorCheck from "./selector-check.svelte";

interface ProjectSelectorProps {
	selectedProject: Project | null;
	recentProjects: Project[];
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
	onProjectChange,
	onBrowse,
	onImport,
	onManageProjects,
	isLoading = false,
	ontoggle,
}: ProjectSelectorProps = $props();

let selectorRef: { toggle: () => void } | undefined = $state();
let isOpen = $state(false);

const _logger = createLogger({
	id: LOGGER_IDS.PROJECT_SELECTOR,
	name: "Project Selector",
});

const themeState = useTheme();

export function toggle() {
	selectorRef?.toggle();
}

function handleProjectSelect(project: Project) {
	if (project.path !== selectedProject?.path) {
		onProjectChange(project);
	}
	isOpen = false;
}

function handleOpenChange(open: boolean) {
	isOpen = open;
	ontoggle?.(open);
}
</script>

<Selector
	bind:this={selectorRef}
	bind:open={isOpen}
	disabled={isLoading || recentProjects.length === 0}
	onOpenChange={handleOpenChange}
>
	{#snippet renderButton()}
		{#if isLoading}
			<Skeleton class="h-2 w-2 shrink-0 rounded-full" />
			<Skeleton class="h-3 w-32" />
		{:else}
			{@const color = selectedProject ? getProjectColor(selectedProject) : TAG_COLORS[0]}
			{#if selectedProject}
				<ProjectLetterBadge name={selectedProject.name} {color} size={14} />
			{:else}
				<div class="h-2 w-2 shrink-0 rounded-full" style="background-color: {color};"></div>
			{/if}
			<span class="text-xs truncate min-w-0">
				{selectedProject ? capitalizeName(selectedProject.name) : "Select project..."}
			</span>
		{/if}
	{/snippet}

	{#if recentProjects.length === 0}
		<div class="px-2 py-1.5 text-sm text-muted-foreground">No recent projects</div>
	{:else}
		{#each recentProjects as project (project.path)}
			{@const color = getProjectColor(project)}
			{@const isSelected = project.path === selectedProject?.path}
			<DropdownMenu.Item
				onSelect={() => handleProjectSelect(project)}
				class="group/item py-1 {isSelected ? 'bg-accent' : ''}"
			>
				<div class="flex items-center gap-2 w-full min-w-0">
					<ProjectLetterBadge name={project.name} {color} size={16} />
					<span class="flex-1 text-sm truncate">{capitalizeName(project.name)}</span>
					<SelectorCheck visible={isSelected} />
				</div>
			</DropdownMenu.Item>
		{/each}
	{/if}

	<DropdownMenu.Separator />

	<DropdownMenu.Item onSelect={onBrowse} class="cursor-pointer">
		<span>Browse for folder...</span>
	</DropdownMenu.Item>

	{#if onImport}
		{@const importIcon = getAgentIcon("claude-code", themeState.effectiveTheme)}
		<DropdownMenu.Item onSelect={onImport} class="cursor-pointer">
			{#if importIcon}
				<img src={importIcon} alt="" class="mr-2 h-4 w-4 shrink-0" />
			{/if}
			<span>Import from Claude...</span>
		</DropdownMenu.Item>
	{/if}

	{#if onManageProjects}
		<DropdownMenu.Item onSelect={onManageProjects} class="cursor-pointer">
			<span>Manage projects...</span>
		</DropdownMenu.Item>
	{/if}
</Selector>
