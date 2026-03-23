<script lang="ts">
import { DiffPill } from "@acepe/ui";
import { FileIcon } from "$lib/components/ui/file-icon/index.js";

import type { FilePickerEntry } from "../../types/file-picker-entry.js";

interface Props {
	file: FilePickerEntry;
	isSelected: boolean;
	onSelect: (file: FilePickerEntry) => void;
	onHover: () => void;
}

const { file, isSelected, onSelect, onHover }: Props = $props();

const fileName = $derived(file.path.split("/").pop() ?? file.path);
const extension = $derived(file.extension || (file.path.split(".").pop()?.toLowerCase() ?? ""));
const hasDiff = $derived(
	!!file.gitStatus && (file.gitStatus.insertions > 0 || file.gitStatus.deletions > 0)
);
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
	class="flex items-center gap-2 min-w-0 px-3 py-2 cursor-pointer {isSelected
		? 'bg-accent text-accent-foreground'
		: 'hover:bg-accent/50'}"
	onclick={() => onSelect(file)}
	onmouseenter={onHover}
	role="option"
	aria-selected={isSelected}
	tabindex={isSelected ? 0 : -1}
>
	<FileIcon {extension} class="h-3.5 w-3.5 shrink-0" />
	<span class="file-name min-w-0 truncate font-mono text-[11px] leading-none" title={file.path}
		>{fileName}</span
	>
	{#if hasDiff}
		<DiffPill
			insertions={file.gitStatus!.insertions}
			deletions={file.gitStatus!.deletions}
			variant="plain"
			class="shrink-0"
		/>
	{/if}
</div>
