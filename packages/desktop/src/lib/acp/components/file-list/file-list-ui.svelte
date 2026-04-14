<script lang="ts">
import { Skeleton } from "$lib/components/ui/skeleton/index.js";
import * as m from "$lib/messages.js";
import ProjectHeader from "../project-header.svelte";

import { flattenFileTree } from "./file-list-logic.js";
import type { FileGroup, FileTreeNode } from "./file-list-types.js";
import FileTreeItem from "./file-tree-item.svelte";

interface Props {
	fileGroups: FileGroup[];
	expandedFolders: Set<string>;
	collapsedProjects: Set<string>;
	onToggleFolder: (projectPath: string, folderPath: string) => void;
	onToggleProject: (projectPath: string) => void;
	onSelectFile: (filePath: string, projectPath: string) => void;
}

let {
	fileGroups,
	expandedFolders,
	collapsedProjects,
	onToggleFolder,
	onToggleProject,
	onSelectFile,
}: Props = $props();

const isEmpty = $derived(fileGroups.length === 0);
const allEmpty = $derived(fileGroups.every((g) => g.files.length === 0 && !g.loading));

function handleProjectHeaderClick(projectPath: string) {
	onToggleProject(projectPath);
}

function getFlattenedFiles(group: FileGroup): Array<{ node: FileTreeNode; projectPath: string }> {
	return flattenFileTree(group.files, expandedFolders, group.projectPath);
}
</script>

<div class="flex flex-col h-full gap-2" data-file-list-scrollable>
	{#if isEmpty}
		<!-- Empty state - no projects -->
		<div class="flex items-center justify-center flex-1 text-center p-4">
			<div class="text-sm text-muted-foreground">
				<p>{m.file_list_empty()}</p>
			</div>
		</div>
	{:else if allEmpty}
		<!-- All projects empty -->
		<div class="flex items-center justify-center flex-1 text-center p-4">
			<div class="text-sm text-muted-foreground">
				<p>{m.file_list_empty()}</p>
			</div>
		</div>
	{:else}
		<!-- File groups - each takes equal space based on total number of projects -->
		{@const totalProjects = fileGroups.length}
		{@const maxHeightPercent = totalProjects > 0 ? 100 / totalProjects : 100}
		<div class="flex flex-col flex-1 min-h-0 gap-2 p-2">
			{#each fileGroups as group (group.projectPath)}
				{@const isExpanded = !collapsedProjects.has(group.projectPath)}
				{@const flattenedFiles = getFlattenedFiles(group)}
				<div
					class="flex flex-col overflow-hidden rounded"
					style={isExpanded
						? `flex: 0 1 auto; max-height: ${maxHeightPercent}%; min-height: 0;`
						: "flex: 0 0 auto;"}
				>
					<!-- Project header -->
					<div
						role="button"
						tabindex="0"
						class="cursor-pointer shrink-0"
						onclick={() => handleProjectHeaderClick(group.projectPath)}
						onkeydown={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								handleProjectHeaderClick(group.projectPath);
							}
						}}
					>
						<ProjectHeader
							projectColor={group.projectColor}
							projectIconSrc={group.projectIconSrc ?? null}
							projectName={group.projectName}
							expanded={isExpanded}
						>
							{#snippet actions()}
								<span
									class="inline-flex items-center justify-center h-7 px-2 text-[11px] text-muted-foreground tabular-nums"
								>
									{group.totalFiles}
								</span>
							{/snippet}
						</ProjectHeader>
					</div>

					<!-- Files - scrollable within allocated space -->
					{#if isExpanded}
						<div class="flex flex-col flex-1 min-h-0 overflow-y-auto project-files-scroll">
							{#if group.loading}
								<!-- Loading skeleton -->
								<div class="flex flex-col gap-0.5 p-1">
									{#each Array.from({ length: 5 }, (_, i) => i) as index (index)}
										<div class="px-2 py-1.5 flex items-center gap-2">
											<Skeleton class="h-4 w-4 shrink-0 rounded" />
											<Skeleton class="h-3 w-3/4" />
										</div>
									{/each}
								</div>
							{:else if group.error}
								<!-- Error state -->
								<div class="p-2 text-xs text-destructive">
									{group.error}
								</div>
							{:else if flattenedFiles.length === 0}
								<!-- Empty project -->
								<div class="p-2 text-xs text-muted-foreground">
									{m.file_list_empty()}
								</div>
							{:else}
								<!-- File tree -->
								<div class="flex flex-col gap-0.5 p-1">
									{#each flattenedFiles as { node, projectPath: projPath } (`${projPath}:${node.path}`)}
										<FileTreeItem
											{node}
											projectPath={projPath}
											isExpanded={expandedFolders.has(`${projPath}:${node.path}`)}
											{onToggleFolder}
											{onSelectFile}
										/>
									{/each}
								</div>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	/* Thin scrollbar for individual project file lists */
	:global(.project-files-scroll) {
		scrollbar-width: thin;
		scrollbar-color: hsl(var(--primary) / 0.3) transparent;
	}

	:global(.project-files-scroll::-webkit-scrollbar) {
		width: 3px;
	}

	:global(.project-files-scroll::-webkit-scrollbar-track) {
		background: transparent;
	}

	:global(.project-files-scroll::-webkit-scrollbar-thumb) {
		background: hsl(var(--primary) / 0.3);
		border-radius: 3px;
	}

	:global(.project-files-scroll:hover::-webkit-scrollbar) {
		width: 6px;
	}

	:global(.project-files-scroll:hover::-webkit-scrollbar-thumb) {
		background: hsl(var(--primary) / 0.5);
	}
</style>
