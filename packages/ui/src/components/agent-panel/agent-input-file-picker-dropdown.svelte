<script lang="ts">
	import type { Snippet } from "svelte";

	import { DiffPill } from "../diff-pill/index.js";

	export interface AgentInputFilePickerEntry {
		path: string;
		extension: string;
		lineCount: number;
		gitStatus: {
			path: string;
			status: string;
			insertions: number;
			deletions: number;
		} | null;
	}

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
		onSelect: (file: AgentInputFilePickerEntry) => void;
		onClose: () => void;
		preview?: Snippet<[AgentInputFilePickerEntry | null]>;
	}

	const DROPDOWN_WIDTH = 900;
	const DROPDOWN_HEIGHT = 400;
	const PADDING = 16;

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

	function getFileName(path: string): string {
		const lastSlash = path.lastIndexOf("/");
		return lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
	}

	function calculateScore(queryValue: string, file: AgentInputFilePickerEntry): number | null {
		const lowerQuery = queryValue.toLowerCase();
		const fileName = getFileName(file.path).toLowerCase();
		const filePath = file.path.toLowerCase();

		const fileNameIndex = fileName.indexOf(lowerQuery);
		if (fileNameIndex >= 0) {
			return 1000 + (100 - fileNameIndex);
		}

		const pathIndex = filePath.indexOf(lowerQuery);
		if (pathIndex >= 0) {
			return 500 + (100 - pathIndex);
		}

		let queryIndex = 0;
		let score = 0;
		let consecutiveBonus = 0;

		for (let index = 0; index < fileName.length && queryIndex < lowerQuery.length; index += 1) {
			if (fileName[index] === lowerQuery[queryIndex]) {
				score += 10 + consecutiveBonus;
				consecutiveBonus += 5;
				queryIndex += 1;
			} else {
				consecutiveBonus = 0;
			}
		}

		if (queryIndex === lowerQuery.length) {
			return score;
		}

		queryIndex = 0;
		score = 0;
		consecutiveBonus = 0;

		for (let index = 0; index < filePath.length && queryIndex < lowerQuery.length; index += 1) {
			if (filePath[index] === lowerQuery[queryIndex]) {
				score += 1 + consecutiveBonus;
				consecutiveBonus += 1;
				queryIndex += 1;
			} else {
				consecutiveBonus = 0;
			}
		}

		return queryIndex === lowerQuery.length ? score : null;
	}

	const computedPosition = $derived.by(() => {
		const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1920;
		const left = Math.max(
			PADDING,
			Math.min(position.left, viewportWidth - DROPDOWN_WIDTH - PADDING)
		);
		const top = position.top - DROPDOWN_HEIGHT - 8;

		return { top, left };
	});

	const filteredFiles = $derived.by(() => {
		if (query.length === 0) {
			return files.slice(0, 10);
		}

		const results: Array<{ item: AgentInputFilePickerEntry; score: number }> = [];

		for (const file of files) {
			const score = calculateScore(query, file);
			if (score !== null) {
				results.push({ item: file, score });
			}
		}

		results.sort((left, right) => {
			if (right.score !== left.score) {
				return right.score - left.score;
			}
			return left.item.path.length - right.item.path.length;
		});

		return results.slice(0, 10).map((result) => result.item);
	});

	const effectiveSelectedIndex = $derived.by(() => {
		if (filteredFiles.length === 0) {
			return 0;
		}

		return Math.max(0, Math.min(selectedIndex, filteredFiles.length - 1));
	});

	const deferPreview = $derived(query.trim().length > 0);
	const previewFile = $derived.by(() => {
		if (filteredFiles.length === 0 || deferPreview) {
			return null;
		}

		return filteredFiles[effectiveSelectedIndex] ?? null;
	});

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
			selectedIndex =
				filteredFiles.length === 0 ? 0 : (effectiveSelectedIndex + 1) % filteredFiles.length;
			setTimeout(scrollSelectedIntoView, 0);
			return true;
		}

		if (event.key === "ArrowUp") {
			event.preventDefault();
			selectedIndex =
				filteredFiles.length === 0
					? 0
					: effectiveSelectedIndex <= 0
						? filteredFiles.length - 1
						: effectiveSelectedIndex - 1;
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
		class="fixed z-[var(--overlay-z)] flex overflow-hidden rounded-lg border bg-popover shadow-lg"
		style="top: {computedPosition.top}px; left: {computedPosition.left}px; width: {DROPDOWN_WIDTH}px; height: {DROPDOWN_HEIGHT}px;"
		onmousedown={(event) => event.preventDefault()}
	>
		<div class="flex w-72 shrink-0 flex-col border-r">
			{#if filteredFiles.length > 0}
				<div class="flex items-center justify-between border-b bg-muted/30 px-3 py-2 shrink-0">
					<span class="text-xs font-medium text-muted-foreground">{headerLabel}</span>
					<span class="text-xs tabular-nums text-muted-foreground">{filteredFiles.length}</span>
				</div>

				<div class="flex-1 overflow-y-auto">
					{#each filteredFiles as file, index (file.path)}
						{@const isSelected = index === effectiveSelectedIndex}
						{@const extension = file.extension || (file.path.split(".").pop()?.toLowerCase() ?? "")}
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<div
							bind:this={itemRefs[index]}
							class="flex cursor-pointer items-center gap-2 min-w-0 px-3 py-2 {isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'}"
							onclick={() => onSelect(file)}
							onmouseenter={() => {
								selectedIndex = index;
							}}
							role="option"
							aria-selected={isSelected}
							tabindex={isSelected ? 0 : -1}
						>
							<span class="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded bg-background/60 text-[8px] font-mono uppercase text-muted-foreground">
								{extension ? extension.slice(0, 3) : "?"}
							</span>
							<span class="min-w-0 truncate font-mono text-[11px] leading-none" title={file.path}>
								{getFileName(file.path)}
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

				<div class="flex items-center gap-2 border-t bg-muted/30 px-3 py-1.5 shrink-0">
					<kbd class="rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium">Enter</kbd>
					<span class="text-[10px] text-muted-foreground">{selectHintLabel}</span>
					<kbd class="ml-2 rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium">Esc</kbd>
					<span class="text-[10px] text-muted-foreground">{closeHintLabel}</span>
				</div>
			{:else if isLoading}
				<div class="flex flex-1 items-center justify-center text-sm text-muted-foreground">
					{loadingLabel}
				</div>
			{:else if query.length > 0}
				<div class="flex flex-1 items-center justify-center text-sm text-muted-foreground">
					{noResultsLabel}
				</div>
			{/if}
		</div>

		<div class="flex-1 min-w-0 bg-background">
			{#if preview}
				{@render preview(previewFile)}
			{:else if deferPreview}
				<div class="flex h-full items-center justify-center text-sm text-muted-foreground">
					{searchingLabel}
				</div>
			{:else}
				<div class="flex h-full items-center justify-center text-sm text-muted-foreground">
					{emptyPreviewLabel}
				</div>
			{/if}
		</div>
	</div>
{/if}
