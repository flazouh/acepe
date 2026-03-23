<script lang="ts">
import * as m from "$lib/paraglide/messages.js";
import { portal } from "../../actions/portal.js";
import type { FilePickerEntry } from "../../types/file-picker-entry.js";
import { fuzzyMatchFiles } from "../../utils/fuzzy-match.js";
import FilePickerItem from "./file-picker-item.svelte";
import FilePreview from "./file-preview.svelte";

interface Props {
	files: FilePickerEntry[];
	isOpen: boolean;
	isLoading: boolean;
	query: string;
	position: { top: number; left: number };
	projectPath: string;
	onSelect: (file: FilePickerEntry) => void;
	onClose: () => void;
}

const { files, isOpen, isLoading, query, position, projectPath, onSelect, onClose }: Props =
	$props();

// Dropdown dimensions
const DROPDOWN_WIDTH = 900;
const DROPDOWN_HEIGHT = 400;
const PADDING = 16;

// Calculate position - use full viewport, position above caret
const computedPosition = $derived.by(() => {
	const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1920;

	// Start at caret position, but ensure it fits in viewport
	let left = Math.max(PADDING, Math.min(position.left, viewportWidth - DROPDOWN_WIDTH - PADDING));

	// Position above the caret
	const top = position.top - DROPDOWN_HEIGHT - 8;

	return { top, left };
});

// Filter files based on query
// Files are already pre-sorted by Rust: modified files first, then alphabetically
const filteredFiles = $derived.by(() => {
	if (query.length === 0) {
		// Empty query: just slice since files are pre-sorted by Rust
		return files.slice(0, 10);
	}

	// With query: fuzzy match and limit to 10
	// gitStatus is already included in each file from Rust
	const matches = fuzzyMatchFiles(query, files, 10);
	return matches.map((match) => match.item);
});

// Track selected index for keyboard navigation
let selectedIndex = $state(0);

// Store references to items for scrolling
let itemRefs: Record<number, HTMLDivElement> = {};

// Reset selection when filtered files change
$effect(() => {
	if (filteredFiles.length > 0) {
		selectedIndex = 0;
	}
});

// Scroll selected item into view
function scrollSelectedIntoView() {
	const itemEl = itemRefs[selectedIndex];
	if (itemEl) {
		itemEl.scrollIntoView({ block: "nearest", behavior: "instant" });
	}
}

// Handle keyboard navigation
export function handleKeyDown(event: KeyboardEvent): boolean {
	if (!isOpen) {
		return false;
	}

	switch (event.key) {
		case "ArrowDown":
			event.preventDefault();
			selectedIndex = (selectedIndex + 1) % filteredFiles.length;
			setTimeout(scrollSelectedIntoView, 0);
			return true;
		case "ArrowUp":
			event.preventDefault();
			selectedIndex = selectedIndex <= 0 ? filteredFiles.length - 1 : selectedIndex - 1;
			setTimeout(scrollSelectedIntoView, 0);
			return true;
		case "Enter":
		case "Tab":
			if (filteredFiles.length > 0) {
				event.preventDefault();
				onSelect(filteredFiles[selectedIndex]);
				return true;
			}
			break;
		case "Escape":
			event.preventDefault();
			onClose();
			return true;
	}
	return false;
}

function handleItemClick(file: FilePickerEntry) {
	onSelect(file);
}

function handleItemHover(index: number) {
	selectedIndex = index;
}
</script>

{#if isOpen}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		use:portal
		class="fixed z-[100] rounded-lg border bg-popover shadow-lg overflow-hidden flex"
		style="top: {computedPosition.top}px; left: {computedPosition.left}px; width: {DROPDOWN_WIDTH}px; height: {DROPDOWN_HEIGHT}px;"
		onmousedown={(e) => e.preventDefault()}
	>
		<!-- Left: File list -->
		<div class="w-72 flex flex-col border-r shrink-0">
			{#if filteredFiles.length > 0}
				<!-- Header -->
				<div class="px-3 py-2 border-b bg-muted/30 flex items-center justify-between shrink-0">
					<span class="text-xs font-medium text-muted-foreground">
						{m.file_picker_header()}
					</span>
					<span class="text-xs text-muted-foreground tabular-nums">
						{filteredFiles.length}
					</span>
				</div>

				<!-- Files list -->
				<div class="flex-1 overflow-y-auto">
					{#each filteredFiles as file, index (file.path)}
						{@const isSelected = index === selectedIndex}
						<div bind:this={itemRefs[index]}>
							<FilePickerItem
								{file}
								{isSelected}
								onSelect={handleItemClick}
								onHover={() => handleItemHover(index)}
							/>
						</div>
					{/each}
				</div>

				<!-- Footer hint -->
				<div class="px-3 py-1.5 border-t bg-muted/30 flex items-center gap-2 shrink-0">
					<kbd class="px-1.5 py-0.5 text-[10px] font-medium bg-muted rounded border"> Enter </kbd>
					<span class="text-[10px] text-muted-foreground">{m.file_picker_select_hint()}</span>
					<kbd class="px-1.5 py-0.5 text-[10px] font-medium bg-muted rounded border ml-2">
						Esc
					</kbd>
					<span class="text-[10px] text-muted-foreground">{m.file_picker_close_hint()}</span>
				</div>
			{:else if isLoading}
				<!-- Files are being loaded -->
				<div class="flex-1 flex items-center justify-center text-sm text-muted-foreground">
					Loading files...
				</div>
			{:else if query.length > 0}
				<!-- Files loaded but no matches -->
				<div class="flex-1 flex items-center justify-center text-sm text-muted-foreground">
					{m.file_picker_no_results()}
				</div>
			{/if}
		</div>

		<!-- Right: File preview -->
		<div class="flex-1 min-w-0">
			<FilePreview
				file={filteredFiles.length > 0 ? filteredFiles[selectedIndex] : null}
				{projectPath}
			/>
		</div>
	</div>
{/if}
