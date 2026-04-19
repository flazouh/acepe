<script lang="ts">
	import { IconCheck } from "@tabler/icons-svelte";

	import * as DropdownMenu from "../dropdown-menu/index.js";
	import { ProjectLetterBadge } from "../project-letter-badge/index.js";
	import { Selector } from "../selector/index.js";
	import type { ProjectSelectorViewItem } from "./types.js";

	/**
	 * Data shape for a single project row in the dropdown.
	 *
	 * All fields are pre-resolved by the controller so the shell contains
	 * zero domain lookups (no store reads, no IO, no theme access).
	 */

	interface Props {
		selectedProject: ProjectSelectorViewItem | null;
		recentProjects: readonly ProjectSelectorViewItem[];
		open?: boolean;
		disabled?: boolean;
		isLoading?: boolean;
		fallbackColor?: string;
		placeholderLabel?: string;
		emptyLabel?: string;
		browseLabel?: string;
		importLabel?: string | null;
		importIconSrc?: string | null;
		manageLabel?: string | null;
		missingLabel?: string;
		onSelect?: (projectPath: string) => void;
		onBrowse?: () => void;
		onImport?: () => void;
		onManage?: () => void;
		onOpenChange?: (open: boolean) => void;
	}

	let {
		selectedProject,
		recentProjects,
		open = $bindable(false),
		disabled = false,
		isLoading = false,
		fallbackColor = "var(--muted-foreground)",
		placeholderLabel = "Select project...",
		emptyLabel = "No recent projects",
		browseLabel = "Browse for folder...",
		importLabel = null,
		importIconSrc = null,
		manageLabel = null,
		missingLabel = "Missing",
		onSelect,
		onBrowse,
		onImport,
		onManage,
		onOpenChange,
	}: Props = $props();

	let selectorRef: { toggle: () => void } | undefined = $state();

	export function toggle(): void {
		selectorRef?.toggle();
	}

	function handleSelect(path: string): void {
		onSelect?.(path);
	}
</script>

<Selector
	bind:this={selectorRef}
	bind:open
	disabled={disabled || isLoading || recentProjects.length === 0}
	{onOpenChange}
>
	{#snippet renderButton()}
		{#if isLoading}
			<span
				class="h-2 w-2 shrink-0 rounded-full animate-pulse bg-muted"
				data-testid="project-selector-loading-dot"
			></span>
			<span class="h-3 w-32 rounded animate-pulse bg-muted"></span>
		{:else if selectedProject}
			<ProjectLetterBadge
				name={selectedProject.name}
				color={selectedProject.color}
				iconSrc={selectedProject.iconSrc}
				size={14}
			/>
			<span class="text-xs truncate min-w-0">{selectedProject.name}</span>
		{:else}
			<div
				class="h-2 w-2 shrink-0 rounded-full"
				style="background-color: {fallbackColor};"
			></div>
			<span class="text-xs truncate min-w-0">{placeholderLabel}</span>
		{/if}
	{/snippet}

	{#if recentProjects.length === 0}
		<div
			class="px-2 py-1.5 text-sm text-muted-foreground"
			data-testid="project-selector-empty"
		>
			{emptyLabel}
		</div>
	{:else}
		{#each recentProjects as project (project.path)}
			{@const isSelected = project.path === selectedProject?.path}
			{@const isMissing = project.isMissing === true}
			{#if isMissing}
				<DropdownMenu.Item disabled class="group/item py-1 opacity-50">
					<div class="flex items-center gap-2 w-full min-w-0">
						<ProjectLetterBadge
							name={project.name}
							color={project.color}
							iconSrc={project.iconSrc}
							size={16}
						/>
						<span class="flex-1 text-sm truncate line-through">{project.name}</span>
						<span class="text-[10px] text-destructive/70 shrink-0">{missingLabel}</span>
					</div>
				</DropdownMenu.Item>
			{:else}
				<DropdownMenu.Item
					onSelect={() => handleSelect(project.path)}
					class="group/item py-1 {isSelected ? 'bg-accent' : ''}"
				>
					<div class="flex items-center gap-2 w-full min-w-0">
						<ProjectLetterBadge
							name={project.name}
							color={project.color}
							iconSrc={project.iconSrc}
							size={16}
						/>
						<span class="flex-1 text-sm truncate">{project.name}</span>
						{#if isSelected}
							<IconCheck class="h-4 w-4 shrink-0 text-foreground" />
						{/if}
					</div>
				</DropdownMenu.Item>
			{/if}
		{/each}
	{/if}

	{#if onBrowse || onImport || onManage}
		<DropdownMenu.Separator />
	{/if}

	{#if onBrowse}
		<DropdownMenu.Item onSelect={onBrowse} class="cursor-pointer">
			<span>{browseLabel}</span>
		</DropdownMenu.Item>
	{/if}

	{#if onImport && importLabel}
		<DropdownMenu.Item onSelect={onImport} class="cursor-pointer">
			{#if importIconSrc}
				<img src={importIconSrc} alt="" class="mr-2 h-4 w-4 shrink-0" />
			{/if}
			<span>{importLabel}</span>
		</DropdownMenu.Item>
	{/if}

	{#if onManage && manageLabel}
		<DropdownMenu.Item onSelect={onManage} class="cursor-pointer">
			<span>{manageLabel}</span>
		</DropdownMenu.Item>
	{/if}
</Selector>
