<script lang="ts">
	import AgentPanelModifiedFileRow from "./agent-panel-modified-file-row.svelte";
	import {
		resolveReviewWorkspaceSelectedIndex,
		type ReviewWorkspaceFileItem,
	} from "./types.js";

	interface Props {
		files: readonly ReviewWorkspaceFileItem[];
		selectedIndex?: number | null;
		emptyStateLabel: string;
		onFileSelect?: (index: number) => void;
	}

	let { files, selectedIndex = null, emptyStateLabel, onFileSelect }: Props = $props();

	const effectiveSelectedIndex = $derived.by(() =>
		resolveReviewWorkspaceSelectedIndex(files, selectedIndex)
	);

	function scrollSelectedIntoView(node: HTMLDivElement, isSelected: boolean) {
		function runScroll(nextSelected: boolean): void {
			if (!nextSelected) {
				return;
			}

			setTimeout(() => {
				node.scrollIntoView({ block: "nearest", behavior: "instant" });
			}, 0);
		}

		runScroll(isSelected);

		return {
			update(nextSelected: boolean): void {
				runScroll(nextSelected);
			},
		};
	}

	function createFileRow(file: ReviewWorkspaceFileItem, index: number): ReviewWorkspaceFileItem {
		return {
			id: file.id,
			filePath: file.filePath,
			fileName: file.fileName,
			reviewStatus: file.reviewStatus,
			additions: file.additions,
			deletions: file.deletions,
			onSelect: () => onFileSelect?.(index),
		};
	}
</script>

<div class="flex h-full min-h-0 flex-col bg-background/70" data-testid="review-workspace-file-list">
	{#if files.length === 0}
		<div
			class="flex flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground"
			data-testid="review-workspace-file-list-empty"
		>
			{emptyStateLabel}
		</div>
	{:else}
		<div class="flex-1 overflow-y-auto p-2">
			<div class="flex flex-col gap-1">
				{#each files as file, index (file.id)}
					{@const isSelected = index === effectiveSelectedIndex}
					<div
						use:scrollSelectedIntoView={isSelected}
						class="rounded-md"
						data-testid={"review-workspace-file-item-" + index}
					>
						<AgentPanelModifiedFileRow
							file={createFileRow(file, index)}
							{isSelected}
						/>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>
