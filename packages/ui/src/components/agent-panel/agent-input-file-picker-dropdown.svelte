<script lang="ts">
	import type { Snippet } from "svelte";

	import { DiffPill } from "../diff-pill/index.js";
	import { getFallbackIconSrc, getFileIconSrc } from "../../lib/file-icon/index.js";
	import { getIconBasePath } from "../../lib/icon-context.js";
	import {
		FILE_PICKER_DROPDOWN_HEIGHT,
		FILE_PICKER_DROPDOWN_WIDTH,
		getEffectiveFilePickerIndex,
		getFilePickerFileName,
		getFilePickerPosition,
		getFilePickerPreviewFile,
		getFilteredFilePickerFiles,
		getNextFilePickerIndex,
		shouldDeferFilePickerPreview,
		type AgentInputFilePickerEntry,
	} from "./agent-input-file-picker-dropdown-state.js";
	export type { AgentInputFilePickerEntry } from "./agent-input-file-picker-dropdown-state.js";

	interface Props {
		files: AgentInputFilePickerEntry[];
		isOpen: boolean;
		isLoading: boolean;
		query: string;
		position: { top: number; left: number };
		headerLabel?: string;
		loadingLabel?: string;
		noResultsLabel?: string;
		searchingLabel?: string;
		selectHintLabel?: string;
		closeHintLabel?: string;
		emptyPreviewLabel?: string;
		iconBasePath?: string;
		onSelect: (file: AgentInputFilePickerEntry) => void;
		onClose: () => void;
		preview?: Snippet<[AgentInputFilePickerEntry | null]>;
	}

	let {
		files,
		isOpen,
		isLoading,
		query,
		position,
		headerLabel = "Files",
		loadingLabel = "Loading files...",
		noResultsLabel = "No matching files",
		searchingLabel = "Searching files...",
		selectHintLabel = "Select",
		closeHintLabel = "Close",
		emptyPreviewLabel = "Select a file to preview",
		iconBasePath = getIconBasePath(),
		onSelect,
		onClose,
		preview,
	}: Props = $props();

	let selectedIndex = $state(0);
	let itemRefs = $state<Record<number, HTMLDivElement>>({});

	function portalToBody(node: HTMLElement): { destroy: () => void } {
		document.body.appendChild(node);

		return {
			destroy(): void {
				node.remove();
			},
		};
	}

	const computedPosition = $derived.by(() => {
		const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1920;
		return getFilePickerPosition({ position, viewportWidth });
	});

	const filteredFiles = $derived(getFilteredFilePickerFiles(files, query));
	const effectiveSelectedIndex = $derived(
		getEffectiveFilePickerIndex({
			selectedIndex,
			fileCount: filteredFiles.length,
		})
	);
	const deferPreview = $derived(shouldDeferFilePickerPreview(query));
	const previewFile = $derived(
		getFilePickerPreviewFile({
			filteredFiles,
			deferPreview,
			effectiveSelectedIndex,
		})
	);

	function scrollSelectedIntoView(): void {
		const item = itemRefs[effectiveSelectedIndex];
		if (item) {
			item.scrollIntoView({ block: "nearest", behavior: "instant" });
		}
	}

	export function handleKeyDown(event: KeyboardEvent): boolean {
		if (!isOpen) {
			return false;
		}

		if (event.key === "ArrowDown") {
			event.preventDefault();
			selectedIndex = getNextFilePickerIndex({
				currentIndex: effectiveSelectedIndex,
				fileCount: filteredFiles.length,
				direction: "down",
			});
			setTimeout(scrollSelectedIntoView, 0);
			return true;
		}

		if (event.key === "ArrowUp") {
			event.preventDefault();
			selectedIndex = getNextFilePickerIndex({
				currentIndex: effectiveSelectedIndex,
				fileCount: filteredFiles.length,
				direction: "up",
			});
			setTimeout(scrollSelectedIntoView, 0);
			return true;
		}

		if (event.key === "Enter" || event.key === "Tab") {
			if (filteredFiles.length > 0) {
				event.preventDefault();
				onSelect(filteredFiles[effectiveSelectedIndex]);
				return true;
			}
			return false;
		}

		if (event.key === "Escape") {
			event.preventDefault();
			onClose();
			return true;
		}

		return false;
	}
</script>

{#if isOpen}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		use:portalToBody
		class="fixed z-[var(--overlay-z)] flex overflow-hidden rounded border bg-popover shadow-lg"
		style="top: {computedPosition.top}px; left: {computedPosition.left}px; width: {FILE_PICKER_DROPDOWN_WIDTH}px; height: {FILE_PICKER_DROPDOWN_HEIGHT}px;"
		onmousedown={(event) => event.preventDefault()}
	>
		<div class="flex w-56 shrink-0 flex-col border-r">
			{#if filteredFiles.length > 0}
				<div class="flex items-center justify-between border-b bg-muted/30 px-2 py-1 shrink-0">
					<span class="text-[11px] font-medium text-muted-foreground">{headerLabel}</span>
					<span class="text-[11px] tabular-nums text-muted-foreground">{filteredFiles.length}</span>
				</div>

				<div class="flex-1 overflow-y-auto">
					{#each filteredFiles as file, index (file.path)}
						{@const isSelected = index === effectiveSelectedIndex}
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<div
							bind:this={itemRefs[index]}
							class="flex cursor-pointer items-center gap-1.5 min-w-0 px-2 py-1 {isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}"
							onclick={() => onSelect(file)}
							onmouseenter={() => {
								selectedIndex = index;
							}}
							role="option"
							aria-selected={isSelected}
							tabindex={isSelected ? 0 : -1}
						>
							<img
								src={getFileIconSrc(getFilePickerFileName(file.path), iconBasePath)}
								alt=""
								class="h-3.5 w-3.5 shrink-0 object-contain"
								aria-hidden="true"
								onerror={(e) => { (e.currentTarget as HTMLImageElement).src = getFallbackIconSrc(iconBasePath); }}
							/>
							<span class="min-w-0 truncate font-mono text-[10px] leading-none" title={file.path}>
								{getFilePickerFileName(file.path)}
							</span>
							{#if file.gitStatus && (file.gitStatus.insertions > 0 || file.gitStatus.deletions > 0)}
								<DiffPill
									insertions={file.gitStatus.insertions}
									deletions={file.gitStatus.deletions}
									variant="plain"
									class="shrink-0"
								/>
							{/if}
						</div>
					{/each}
				</div>

				<div class="flex items-center gap-1.5 border-t bg-muted/30 px-2 py-1 shrink-0">
					<kbd class="rounded border bg-muted px-1 py-px text-[10px] font-medium">Enter</kbd>
					<span class="text-[10px] text-muted-foreground">{selectHintLabel}</span>
					<kbd class="ml-1.5 rounded border bg-muted px-1 py-px text-[10px] font-medium">Esc</kbd>
					<span class="text-[10px] text-muted-foreground">{closeHintLabel}</span>
				</div>
			{:else if isLoading}
				<div class="flex flex-1 items-center justify-center text-xs text-muted-foreground">
					{loadingLabel}
				</div>
			{:else if query.length > 0}
				<div class="flex flex-1 items-center justify-center text-xs text-muted-foreground">
					{noResultsLabel}
				</div>
			{/if}
		</div>

		<div class="flex-1 min-w-0 bg-background">
			{#if preview}
				{@render preview(previewFile)}
			{:else if deferPreview}
				<div class="flex h-full items-center justify-center text-xs text-muted-foreground">
					{searchingLabel}
				</div>
			{:else}
				<div class="flex h-full items-center justify-center text-xs text-muted-foreground">
					{emptyPreviewLabel}
				</div>
			{/if}
		</div>
	</div>
{/if}
