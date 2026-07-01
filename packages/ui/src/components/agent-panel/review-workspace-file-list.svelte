<script lang="ts">
	import { CircleDashed } from "phosphor-svelte";

	import type { ReviewWorkspaceFileItem } from "./types.js";

	import { DiffPill } from "../diff-pill/index.js";
	import { FilePathBadge } from "../file-path-badge/index.js";
	import { RoundedIcon } from "../icons/index.js";

	interface Props {
		files: readonly ReviewWorkspaceFileItem[];
		selectedIndex?: number | null;
		emptyStateLabel: string;
		onFileSelect?: (index: number) => void;
		onFileRevert?: (index: number) => void;
	}

	let {
		files,
		selectedIndex = null,
		emptyStateLabel,
		onFileSelect,
		onFileRevert,
	}: Props = $props();

	function reviewStatusLabel(file: ReviewWorkspaceFileItem): string {
		if (file.reviewStatus === "accepted") {
			return "Reviewed";
		}
		if (file.reviewStatus === "partial") {
			return "Partial";
		}
		if (file.reviewStatus === "denied") {
			return "Undone";
		}

		return "Not reviewed";
	}

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
			sourceIndex: file.sourceIndex,
			reviewStatus: file.reviewStatus,
			additions: file.additions,
			deletions: file.deletions,
			onSelect: () => onFileSelect?.(index),
		};
	}
</script>

<div class="flex h-full min-h-0 flex-col" data-testid="review-workspace-file-list">
	{#if files.length === 0}
		<div
			class="flex flex-1 items-center justify-center px-4 text-center text-sm text-muted-foreground"
			data-testid="review-workspace-file-list-empty"
		>
			{emptyStateLabel}
		</div>
	{:else}
		<div class="min-h-0 flex-1 overflow-y-auto p-1" data-testid="review-workspace-file-list-scroll">
			<div class="flex flex-col gap-0.5">
				{#each files as file, index (file.id)}
					{@const isSelected = index === selectedIndex}
					{@const row = createFileRow(file, index)}
					<div
						use:scrollSelectedIntoView={isSelected}
						class="group relative rounded"
						data-testid={"review-workspace-file-item-" + index}
					>
						<button
							type="button"
							onclick={() => row.onSelect?.()}
							data-selected={isSelected ? "true" : "false"}
							class="flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-left text-sm transition-colors {isSelected
								? 'bg-accent text-foreground font-medium'
								: 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'}"
							aria-label={row.fileName ?? row.filePath}
							title={reviewStatusLabel(row)}
						>
							<!-- Status icon — left of the file name -->
							<span
								class="shrink-0 {row.reviewStatus === 'accepted'
									? 'text-success'
									: row.reviewStatus === 'partial'
										? 'text-primary'
										: row.reviewStatus === 'denied'
											? 'text-destructive'
											: 'text-muted-foreground'}"
								aria-label={reviewStatusLabel(row)}
							>
								{#if row.reviewStatus === "accepted"}
									<RoundedIcon name="check-circle" class="h-3 w-3" />
								{:else if row.reviewStatus === "partial"}
									<CircleDashed class="h-3 w-3" weight="bold" />
								{:else if row.reviewStatus === "denied"}
									<RoundedIcon name="x-circle" class="h-3 w-3" />
								{:else}
									<!-- unreviewed: neutral dot so column width stays consistent -->
									<span class="block h-3 w-3 rounded-full border border-current opacity-30"></span>
								{/if}
							</span>

							<FilePathBadge
								filePath={row.filePath}
								fileName={row.fileName ?? undefined}
								interactive={false}
								class="!bg-transparent !border-transparent !px-0 min-w-0 flex-1"
							/>

							{#if row.additions > 0 || row.deletions > 0}
								<span class="shrink-0 transition-opacity {onFileRevert ? 'group-hover:opacity-0' : ''}">
									<DiffPill insertions={row.additions} deletions={row.deletions} variant="plain" />
								</span>
							{/if}
						</button>

						{#if onFileRevert}
							<button
								type="button"
								class="absolute right-1 top-1/2 -translate-y-1/2 flex items-center justify-center h-5 w-5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer"
								title="Discard changes"
								onclick={() => onFileRevert(index)}
							>
								<RoundedIcon name="undo" class="size-3" />
							</button>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>
