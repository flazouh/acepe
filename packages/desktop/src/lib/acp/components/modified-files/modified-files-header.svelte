<script lang="ts">
import { DiffPill } from "@acepe/ui";
import * as DropdownMenu from "@acepe/ui/dropdown-menu";
import ArrowsOut from "phosphor-svelte/lib/ArrowsOut";
import FileCode from "phosphor-svelte/lib/FileCode";
import GitPullRequest from "phosphor-svelte/lib/GitPullRequest";
import SidebarSimple from "phosphor-svelte/lib/SidebarSimple";
import { Spinner } from "$lib/components/ui/spinner/index.js";
import * as m from "$lib/paraglide/messages.js";
import { getReviewPreferenceStore } from "../../store/review-preference-store.svelte.js";
import { sessionReviewStateStore } from "../../store/session-review-state-store.svelte.js";
import AnimatedChevron from "../animated-chevron.svelte";
import type { FileReviewStatus } from "../review-panel/review-session-state.js";
import InlineModifiedFileRow from "./components/inline-modified-file-row.svelte";
import { getReviewStatusByFilePath } from "./logic/review-progress.js";
import type { ModifiedFilesState } from "./types/modified-files-state.js";

/**
 * Props for ModifiedFilesHeader.
 * Receives pre-computed modifiedFilesState from parent (avoids duplicate aggregateFileEdits calls).
 */
interface Props {
	/** Pre-computed modified files state from parent */
	modifiedFilesState: ModifiedFilesState | null;
	/** Session identity used for per-session review progress persistence */
	sessionId?: string | null;
	/** Called when Review button is clicked - enters panel review mode */
	onEnterReviewMode?: (modifiedFilesState: ModifiedFilesState, fileIndex: number) => void;
	/** Optional: when provided, shows expand icon to open full-screen review overlay */
	onOpenFullscreenReview?: (modifiedFilesState: ModifiedFilesState, fileIndex: number) => void;
	/** Optional: when provided, shows Create PR pill button */
	onCreatePr?: () => void;
	/** Disables the Create PR button when true (e.g. while request in flight) */
	createPrLoading?: boolean;
	/** Label to display on the Create PR button during loading (e.g. "Staging...", "Pushing...") */
	createPrLabel?: string | null;
}

let {
	modifiedFilesState,
	sessionId = null,
	onEnterReviewMode,
	onOpenFullscreenReview,
	onCreatePr,
	createPrLoading = false,
	createPrLabel = null,
}: Props = $props();

// Get review preference store at component initialization (not in handlers)
const reviewPreferenceStore = getReviewPreferenceStore();

let isExpanded = $state(false);

const totalAdded = $derived(
	modifiedFilesState?.files.reduce((sum, f) => sum + f.totalAdded, 0) ?? 0
);

const totalRemoved = $derived(
	modifiedFilesState?.files.reduce((sum, f) => sum + f.totalRemoved, 0) ?? 0
);

const reviewStatusByFilePath = $derived.by(
	(): ReadonlyMap<string, FileReviewStatus | undefined> => {
		if (!modifiedFilesState) return new Map<string, FileReviewStatus | undefined>();
		if (!sessionId) return new Map<string, FileReviewStatus | undefined>();
		if (!sessionReviewStateStore.isLoaded(sessionId))
			return new Map<string, FileReviewStatus | undefined>();

		return getReviewStatusByFilePath(
			modifiedFilesState.files,
			sessionReviewStateStore.getState(sessionId)
		);
	}
);
const reviewedFileCount = $derived.by(() => {
	if (!modifiedFilesState) return 0;
	return modifiedFilesState.files.reduce((count, file) => {
		const status = reviewStatusByFilePath.get(file.filePath);
		return status ? count + 1 : count;
	}, 0);
});

$effect(() => {
	if (!sessionId) return;
	sessionReviewStateStore.ensureLoaded(sessionId);
});

function toggleExpanded(): void {
	isExpanded = !isExpanded;
}

function handleReviewButtonClick(fileIndex: number): void {
	if (!modifiedFilesState) return;
	const preferFullscreen = reviewPreferenceStore.preferFullscreen;
	if (preferFullscreen && onOpenFullscreenReview) {
		onOpenFullscreenReview(modifiedFilesState, fileIndex);
	} else {
		onEnterReviewMode?.(modifiedFilesState, fileIndex);
	}
}
</script>

{#if modifiedFilesState}
	<div class="w-full px-5 mb-2">
		<!-- Inline Expanded File List (in document flow) -->
		{#if isExpanded}
			<div class="rounded-t-md bg-muted/30 overflow-hidden border border-b-0 border-border">
				<!-- File list -->
				<div class="flex flex-col p-1 max-h-[300px] overflow-y-auto">
					{#each modifiedFilesState.files as file, index (file.filePath)}
						<InlineModifiedFileRow
							{file}
							fileIndex={index}
							reviewStatus={reviewStatusByFilePath.get(file.filePath)}
							onOpenReviewPanel={handleReviewButtonClick}
						/>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Header Bar (whole component clickable to expand/collapse) -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			role="button"
			tabindex="0"
			onclick={toggleExpanded}
			onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpanded(); } }}
			class="w-full flex items-center justify-between px-3 py-1 rounded-md border border-border bg-muted/30 hover:bg-muted/40 transition-colors cursor-pointer {isExpanded
				? 'rounded-t-none border-t-0'
				: ''}"
		>
			<div class="flex items-center gap-1.5 text-[0.6875rem] min-w-0">
				<span class="text-foreground">
					{m.modified_files_count({ count: modifiedFilesState.fileCount })}
				</span>
				<!-- Diff stats summary -->
				<DiffPill insertions={totalAdded} deletions={totalRemoved} variant="plain" />
			</div>

			<div class="flex items-center gap-3 shrink-0">
				<!-- PR button: "Open PR" trigger (PrStatusCard above shows created PR details) -->
				{#if onCreatePr}
					<button
						type="button"
						disabled={createPrLoading}
						onclick={(e: MouseEvent) => {
							e.stopPropagation();
							onCreatePr();
						}}
						class="flex items-center gap-1 px-2 py-0.5 rounded border border-border/50 bg-muted text-[0.6875rem] font-medium text-foreground/80 hover:text-foreground hover:bg-muted/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
					>
						{#if createPrLoading}
							<Spinner class="size-3 shrink-0" />
							{createPrLabel ?? m.agent_panel_open_pr()}
						{:else}
							<GitPullRequest size={11} weight="bold" class="shrink-0" style="color: var(--success)" />
							{m.agent_panel_open_pr()}
						{/if}
					</button>
				{/if}

				<!-- Review split button -->
				<DropdownMenu.Root>
					<div
						class="flex items-center rounded border border-border/50 bg-muted overflow-hidden text-[0.6875rem] shrink-0"
						onclick={(e: MouseEvent) => e.stopPropagation()}
						role="none"
					>
						<button
							type="button"
							class="flex items-center gap-1 px-2 py-0.5 font-medium text-foreground/80 hover:text-foreground hover:bg-muted/80 transition-colors"
							onclick={() => handleReviewButtonClick(0)}
						>
							<FileCode size={11} weight="fill" class="shrink-0" />
							{m.modified_files_review_button()}
						</button>
						<DropdownMenu.Trigger
							class="self-stretch flex items-center px-1 border-l border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors outline-none"
							onclick={(e: MouseEvent) => e.stopPropagation()}
						>
							<svg class="size-2.5" viewBox="0 0 10 10" fill="none">
								<path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
							</svg>
						</DropdownMenu.Trigger>
					</div>
					<DropdownMenu.Content align="end" class="min-w-[140px]">
						<DropdownMenu.Item
							onSelect={() => {
								void reviewPreferenceStore.setPreferFullscreen(false);
								if (modifiedFilesState) onEnterReviewMode?.(modifiedFilesState, 0);
							}}
							class="cursor-pointer text-[0.6875rem]"
						>
							<SidebarSimple size={12} weight="fill" class="shrink-0" />
							{m.modified_files_review_panel()}
						</DropdownMenu.Item>
						<DropdownMenu.Item
							onSelect={() => {
								void reviewPreferenceStore.setPreferFullscreen(true);
								if (modifiedFilesState) onOpenFullscreenReview?.(modifiedFilesState, 0);
							}}
							class="cursor-pointer text-[0.6875rem]"
						>
							<ArrowsOut size={12} weight="bold" class="shrink-0" />
							{m.modified_files_review_fullscreen()}
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>

				<!-- Reviewed count -->
				<span class="text-muted-foreground tabular-nums text-[0.6875rem]">
					{reviewedFileCount}/{modifiedFilesState.fileCount}
				</span>

				<!-- Expand/collapse chevron -->
				<AnimatedChevron isOpen={isExpanded} class="size-3.5 text-muted-foreground" />
			</div>
		</div>
	</div>
{/if}
