<script lang="ts">
import { DiffPill } from "@acepe/ui";
import { FileIcon } from "$lib/components/ui/file-icon/index.js";
import type { FileExplorerRow } from "$lib/services/converted-session-types.js";

interface Props {
	row: FileExplorerRow;
	optionId: string;
	isSelected: boolean;
	onSelect: (row: FileExplorerRow) => void;
	onHover: () => void;
}

const { row, optionId, isSelected, onSelect, onHover }: Props = $props();

const hasDiff = $derived(
	row.gitStatus !== null && (row.gitStatus.insertions > 0 || row.gitStatus.deletions > 0)
);

const gitStatusLabel = $derived(row.gitStatus !== null ? row.gitStatus.status : null);

// Directory segments (everything except the last segment = filename)
const dirPath = $derived(row.pathSegments.slice(0, -1).join("/"));
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
	id={optionId}
	class="flex items-center gap-2 min-w-0 px-3 py-1.5 cursor-pointer {isSelected
		? 'bg-accent text-accent-foreground'
		: 'hover:bg-accent/50'}"
	onclick={() => onSelect(row)}
	onmouseenter={onHover}
	role="option"
	aria-selected={isSelected}
	tabindex={isSelected ? 0 : -1}
>
	<FileIcon extension={row.extension} class="h-3.5 w-3.5 shrink-0" />

	<div class="flex-1 min-w-0 flex items-center gap-1.5 overflow-hidden">
		<span
			class="font-mono text-[11px] leading-none shrink-0 max-w-[40%] truncate"
			title={row.path}
		>
			{row.fileName}
		</span>
		{#if dirPath}
			<span class="text-[10px] text-muted-foreground truncate min-w-0" title={row.path}>
				{dirPath}
			</span>
		{/if}
	</div>

	<div class="flex items-center gap-1 shrink-0">
		{#if gitStatusLabel !== null}
			<span
				class="text-[10px] font-mono font-medium px-1 rounded leading-none {gitStatusLabel === 'M'
					? 'text-yellow-500'
					: gitStatusLabel === 'A'
						? 'text-green-500'
						: gitStatusLabel === 'D'
							? 'text-red-500'
							: 'text-muted-foreground'}"
			>
				{gitStatusLabel}
			</span>
		{/if}
		{#if hasDiff}
			<DiffPill
				insertions={row.gitStatus!.insertions}
				deletions={row.gitStatus!.deletions}
				variant="plain"
			/>
		{/if}
	</div>
</div>
