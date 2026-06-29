<script lang="ts">
import { onMount } from "svelte";
import { SvelteSet } from "svelte/reactivity";
import { ProjectLetterBadge, Selector, SelectorItem, computeProjectBadgeLabels } from "@acepe/ui";
import { FUSED_CONTROL_SETUP_CHIP_ICON_SIZE_CLASS, FUSED_CONTROL_SETUP_CHIP_ICON_SIZE_PX, FUSED_CONTROL_SETUP_CHIP_LABEL_TEXT_CLASS } from "@acepe/ui/panel-header";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import { useTheme } from "$lib/components/theme/context.svelte.js";
import { Skeleton } from "$lib/components/ui/skeleton/index.js";
import { tauriClient } from "$lib/utils/tauri-client.js";
import { LOGGER_IDS } from "../constants/logger-ids.js";

import { getProviderBrandIcon } from "../constants/thread-list-constants.js";
import type { Project } from "../logic/project-manager.svelte.js";
import { AGENT_IDS } from "../types/agent-id.js";
import { getProjectColor, TAG_COLORS } from "@acepe/ui/colors";
import { cn } from "$lib/utils.js";
import { createLogger } from "../utils/logger.js";

interface ProjectSelectorProps {
	selectedProject: Project | null;
	recentProjects: readonly Project[];
	missingProjectPaths?: ReadonlySet<string>;
	onProjectChange: (project: Project) => void;
	onBrowse?: () => void;
	onImport?: () => void | Promise<void>;
	onManageProjects?: () => void;
	isLoading?: boolean;
	ontoggle?: (isOpen: boolean) => void;
	placeholder?: string;
	/** When true, the trigger shows the project name next to its badge. */
	showLabel?: boolean;
	/**
	 * Global path → disambiguating badge label map. When omitted, labels are
	 * computed from the projects this selector renders so colliding first
	 * letters still disambiguate ("Ac" / "Ap").
	 */
	labelByPath?: ReadonlyMap<string, string> | null;
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
	placeholder = "Select project...",
	showLabel = false,
	labelByPath = null,
}: ProjectSelectorProps = $props();

const effectiveLabelByPath = $derived(
	labelByPath ??
		computeProjectBadgeLabels(
			recentProjects.map((project) => ({ key: project.path, name: project.name }))
		)
);

let selectorRef: { toggle: () => void } | undefined = $state();
let isOpen = $state(false);
const localMissingPaths = new SvelteSet<string>();
const effectiveMissingPaths = $derived(missingProjectPaths ?? localMissingPaths);
const hasProjectActions = $derived(
	onBrowse !== undefined || onImport !== undefined || onManageProjects !== undefined
);

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
	disabled={isLoading || (recentProjects.length === 0 && !hasProjectActions)}
	onOpenChange={handleOpenChange}
	variant="ghost"
	showChevron={false}
	triggerSize={showLabel ? "setupBarChip" : "icon"}
	triggerClass={isOpen ? "bg-accent text-foreground" : ""}
	triggerAriaLabel={selectedProject?.name ?? placeholder}
	side="top"
	sideOffset={8}
>
	{#snippet renderButton()}
		{#if isLoading}
			<Skeleton class="{FUSED_CONTROL_SETUP_CHIP_ICON_SIZE_CLASS} rounded-md" />
		{:else}
			{@const color = selectedProject ? getProjectColor(selectedProject) : TAG_COLORS[0]}
			{#if selectedProject}
				<ProjectLetterBadge
					name={selectedProject.name}
					label={effectiveLabelByPath.get(selectedProject.path) ?? null}
					{color}
					iconSrc={selectedProject.iconPath ?? null}
					size={FUSED_CONTROL_SETUP_CHIP_ICON_SIZE_PX}
				/>
				{#if showLabel}
					<span class={cn("whitespace-nowrap", FUSED_CONTROL_SETUP_CHIP_LABEL_TEXT_CLASS)}>{selectedProject.name}</span>
				{/if}
			{:else}
				<div class="{FUSED_CONTROL_SETUP_CHIP_ICON_SIZE_CLASS} rounded-md" style="background-color: {color};"></div>
				{#if showLabel}
					<span class={cn("whitespace-nowrap text-muted-foreground", FUSED_CONTROL_SETUP_CHIP_LABEL_TEXT_CLASS)}>{placeholder}</span>
				{/if}
			{/if}
		{/if}
	{/snippet}

	{#if recentProjects.length === 0}
		<div class="px-2 py-1.5 text-sm text-muted-foreground">No recent projects</div>
	{:else}
		{#each recentProjects as project (project.path)}
			{@const color = getProjectColor(project)}
			{@const isSelected = project.path === selectedProject?.path}
			{@const isMissing = effectiveMissingPaths.has(project.path)}
			{#if isMissing}
				<SelectorItem
					label={project.name}
					disabled={true}
					labelClass="line-through"
				>
					{#snippet leading()}
						<ProjectLetterBadge
							name={project.name}
							label={effectiveLabelByPath.get(project.path) ?? null}
							{color}
							iconSrc={project.iconPath ?? null}
							size={14}
						/>
					{/snippet}
					{#snippet trailing()}
						<span class="shrink-0 text-[10px] text-destructive/70">Missing</span>
					{/snippet}
				</SelectorItem>
			{:else}
				<SelectorItem
					label={project.name}
					selected={isSelected}
					onSelect={() => handleProjectSelect(project)}
				>
					{#snippet leading()}
						<ProjectLetterBadge
							name={project.name}
							label={effectiveLabelByPath.get(project.path) ?? null}
							{color}
							iconSrc={project.iconPath ?? null}
							size={14}
						/>
					{/snippet}
				</SelectorItem>
			{/if}
		{/each}
	{/if}

	{#if onBrowse || onImport || onManageProjects}
		<DropdownMenu.Separator />
	{/if}

	{#if onBrowse}
		<DropdownMenu.Item onSelect={onBrowse} class="cursor-pointer">
			<span>Browse for folder...</span>
		</DropdownMenu.Item>
	{/if}

	{#if onImport}
		{@const importIcon = getProviderBrandIcon(AGENT_IDS.CLAUDE_CODE, themeState.effectiveTheme)}
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
