<script lang="ts">
import { ProjectLetterBadge } from "@acepe/ui/project-letter-badge";
import type { FileExplorerRow } from "$lib/services/converted-session-types.js";
import type { FileExplorerProjectInfo } from "$lib/components/main-app-view/logic/file-explorer-context.js";
import type { FileExplorerModalState } from "./file-explorer-modal-state.svelte.js";
import FileExplorerResultRow from "./file-explorer-result-row.svelte";

interface Props {
	state: FileExplorerModalState;
	projectInfoByPath: Record<string, FileExplorerProjectInfo>;
	onSelect: (row: FileExplorerRow) => void;
}

const { state, projectInfoByPath, onSelect }: Props = $props();

type GroupedRows = {
	projectPath: string;
	projectInfo: FileExplorerProjectInfo;
	items: Array<{ row: FileExplorerRow; index: number }>;
};

const groupedRows = $derived.by((): GroupedRows[] => {
	const groups: GroupedRows[] = [];
	for (let index = 0; index < state.rows.length; index += 1) {
		const row = state.rows[index];
		if (!row) continue;
		const lastGroup = groups[groups.length - 1];
		if (lastGroup && lastGroup.projectPath === row.projectPath) {
			lastGroup.items.push({ row, index });
			continue;
		}
		groups.push({
			projectPath: row.projectPath,
			projectInfo: projectInfoForPath(row.projectPath),
			items: [{ row, index }],
		});
	}
	return groups;
});

function projectInfoForPath(projectPath: string): FileExplorerProjectInfo {
	const info = projectInfoByPath[projectPath];
	if (info) return info;
	const segments = projectPath.split("/").filter((segment) => segment.length > 0);
	const name = segments[segments.length - 1];
	return {
		name: name ? name : projectPath,
		color: "#22c55e",
		iconSrc: null,
	};
}

// Element refs for scroll-into-view
let itemRefs: Record<number, HTMLDivElement> = {};

function scrollSelectedIntoView() {
	const el = itemRefs[state.selectedIndex];
	if (el) {
		el.scrollIntoView({ block: "nearest", behavior: "instant" });
	}
}

function handleHover(index: number) {
	state.selectedIndex = index;
	scrollSelectedIntoView();
}

function handleSelect(row: FileExplorerRow) {
	onSelect(row);
}
</script>

<div
	id="file-explorer-results"
	class="flex-1 overflow-y-auto min-h-0"
	role="listbox"
	aria-label="File results"
>
	{#if state.isLoading}
		<div class="flex items-center justify-center py-8 text-sm text-muted-foreground">
			Searching…
		</div>
	{:else if state.rows.length === 0 && state.query.length > 0}
		<div class="flex items-center justify-center py-8 text-sm text-muted-foreground">
			No files found
		</div>
	{:else if state.rows.length === 0}
		<div class="flex items-center justify-center py-8 text-sm text-muted-foreground">
			Type to search files
		</div>
	{:else}
		{#each groupedRows as group (group.projectPath)}
			<div class="border-b border-border/40 last:border-b-0">
				<div class="sticky top-0 z-[1] flex items-center gap-1.5 bg-background/95 px-2 py-1.5 backdrop-blur-sm">
					<ProjectLetterBadge
						name={group.projectInfo.name}
						color={group.projectInfo.color}
						iconSrc={group.projectInfo.iconSrc}
						size={14}
					/>
					<div class="min-w-0 flex items-center gap-1.5 text-[10px] leading-none">
						<div class="truncate font-medium text-foreground">{group.projectInfo.name}</div>
						<div class="truncate text-muted-foreground">{group.projectPath}</div>
					</div>
				</div>
				{#each group.items as item (item.row.projectPath + ":" + item.row.path)}
					<div bind:this={itemRefs[item.index]} role="presentation">
						<FileExplorerResultRow
							row={item.row}
							optionId={`file-explorer-row-${item.index}`}
							isSelected={item.index === state.selectedIndex}
							onSelect={handleSelect}
							onHover={() => handleHover(item.index)}
						/>
					</div>
				{/each}
			</div>
		{/each}
	{/if}
</div>
