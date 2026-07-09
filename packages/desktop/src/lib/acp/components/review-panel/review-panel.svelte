<script lang="ts">
import {
	Button,
	CloseAction,
	EmbeddedPanelHeader,
	HeaderActionCell,
	HeaderTitleCell,
	ReviewWorkspaceFileList,
	RoundedIcon,
} from "@acepe/ui";
import { CaretLeft } from "phosphor-svelte";
import { SvelteMap } from "svelte/reactivity";
import { Skeleton } from "$lib/components/ui/skeleton/index.js";
import { tauriClient } from "$lib/utils/tauri-client.js";
import { createReviewFileRevisionKey } from "../../review/review-file-revision.js";
import type { ModifiedFilesState } from "../../types/modified-files-state.js";
import ReviewBottomWidget from "./review-bottom-widget.svelte";
import ReviewPanelDiff from "./review-panel-diff.svelte";
import {
	type FileReviewStatus,
	nextSequentialFileIndex,
	nextUnreviewedFileIndex,
	prevSequentialFileIndex,
} from "./review-session-state.js";
import { buildReviewWorkspaceFileItems } from "./review-panel-state.js";

interface Props {
	panelId: string;
	projectPath: string;
	modifiedFilesState: ModifiedFilesState;
	selectedFileIndex: number;
	width: number;
	isFullscreenEmbedded?: boolean;
	onClose: () => void;
	onResize: (panelId: string, delta: number) => void;
	onSelectFile: (index: number) => void;
}

let {
	panelId,
	projectPath,
	modifiedFilesState,
	selectedFileIndex,
	width,
	isFullscreenEmbedded = false,
	onClose,
	onResize,
	onSelectFile,
}: Props = $props();

// Resize state
let isDragging = $state(false);
let startX = $state(0);

// Per-file reviewed set (UI session state, not persisted).
const reviewedKeys = new SvelteSet<string>();

const selectedFile = $derived(modifiedFilesState.files[selectedFileIndex]);
const files = $derived(modifiedFilesState.files);

const reviewFileItems = $derived.by(() => buildReviewWorkspaceFileItems(files, reviewedKeys));

const nextFileIdx = $derived(nextSequentialFileIndex(selectedFileIndex, files.length));
const prevFileIdx = $derived(prevSequentialFileIndex(selectedFileIndex));

const selectedFileIsReviewed = $derived.by(() => {
	if (!selectedFile) return false;
	return reviewedKeys.has(createReviewFileRevisionKey(selectedFile));
});

const fileCurrent = $derived(selectedFileIndex + 1);
const fileTotal = $derived(files.length);

const widthStyle = $derived(
	isFullscreenEmbedded
		? "min-width: 0; width: 100%; max-width: 100%;"
		: `min-width: ${width}px; width: ${width}px; max-width: ${width}px;`
);

function handleToggleReviewed(): void {
	if (!selectedFile) return;

	const fileKey = createReviewFileRevisionKey(selectedFile);
	const becameReviewed = !reviewedKeys.has(fileKey);
	if (becameReviewed) {
		reviewedKeys.add(fileKey);
	} else {
		reviewedKeys.delete(fileKey);
	}

	if (!becameReviewed) return;

	const fileStatuses: FileReviewStatus[] = files.map((file) =>
		reviewedKeys.has(createReviewFileRevisionKey(file)) ? "reviewed" : "unreviewed"
	);
	const nextIndex = nextUnreviewedFileIndex(selectedFileIndex, fileStatuses);
	if (nextIndex !== null) {
		onSelectFile(nextIndex);
	}
}

function handlePrevFile(): void {
	if (prevFileIdx !== null) {
		onSelectFile(prevFileIdx);
	}
}

function handleNextFile(): void {
	if (nextFileIdx !== null) {
		onSelectFile(nextFileIdx);
	}
}

$effect(() => {
	const validKeys = new Set(files.map((file) => createReviewFileRevisionKey(file)));
	for (const key of Array.from(reviewedKeys)) {
		if (!validKeys.has(key)) {
			reviewedKeys.delete(key);
		}
	}
});

function handlePointerDown(e: PointerEvent) {
	isDragging = true;
	startX = e.clientX;
	(e.target as HTMLElement).setPointerCapture(e.pointerId);
}

function handlePointerMove(e: PointerEvent) {
	if (!isDragging) return;
	const delta = e.clientX - startX;
	startX = e.clientX;
	onResize(panelId, delta);
}

function handlePointerUp() {
	isDragging = false;
}
</script>

<div
	class="flex flex-col h-full shrink-0 grow-0 min-h-0 bg-background border border-border rounded-lg overflow-hidden relative {isDragging
		? 'select-none'
		: ''}"
	style={widthStyle}
>
	<EmbeddedPanelHeader>
		<HeaderActionCell withDivider={false}>
			<Button
				variant="ghost"
				size="icon-chrome"
				data-header-control
				onclick={onClose}
				title="Back"
				aria-label="Back"
			>
				{#snippet children()}
					<CaretLeft size={12} weight="regular" class="size-3 shrink-0" />
				{/snippet}
			</Button>
		</HeaderActionCell>

		<HeaderTitleCell>
			<span class="text-xs font-medium text-foreground">Review</span>
			{#if fileTotal > 0}
				<span class="text-xs text-muted-foreground">{fileCurrent}/{fileTotal}</span>
			{/if}
		</HeaderTitleCell>

		<HeaderActionCell withDivider={true}>
			<CloseAction onClose={onClose} title={"Close"} />
		</HeaderActionCell>
	</EmbeddedPanelHeader>

	<!-- Two-pane body: left file list sidebar + right diff view -->
	<div class="flex flex-1 min-h-0">
		<!-- Left sidebar: file list with review status -->
		<div class="w-44 shrink-0 border-r border-border overflow-y-auto">
			<ReviewWorkspaceFileList
				files={reviewFileItems}
				selectedIndex={selectedFileIndex}
				emptyStateLabel="No files"
				onFileSelect={onSelectFile}
				onFileRevert={(index) => {
					const file = files[index];
					if (!file) return;
					tauriClient.git.discardChanges(projectPath, [file.filePath]).match(
						() => toast.success(`Discarded changes in ${file.fileName ?? file.filePath.split("/").pop()}`),
						(err) => toast.error(`Failed to discard: ${err.message}`)
					);
				}}
			/>
		</div>

		<!-- Right pane: diff content + floating toolbar -->
		<div class="relative flex-1 min-w-0 overflow-auto">
			{#if selectedFile}
				{#key selectedFile.filePath}
					<ReviewPanelDiff file={selectedFile} {projectPath} />
				{/key}
			{:else}
				<div class="flex flex-col gap-2 p-4">
					{#each Array.from({ length: 10 }, (_, i) => i) as index (index)}
						<Skeleton class="h-4 w-full" />
					{/each}
				</div>
			{/if}

			<!-- Floating review toolbar — positioned over the diff pane -->
			{#if selectedFile}
				<ReviewBottomWidget
					{fileCurrent}
					{fileTotal}
					isReviewed={selectedFileIsReviewed}
					hasPrevFile={prevFileIdx !== null}
					hasNextFile={nextFileIdx !== null}
					onToggleReviewed={handleToggleReviewed}
					onPrevFile={handlePrevFile}
					onNextFile={handleNextFile}
				/>
			{/if}
		</div>
	</div>

	{#if !isFullscreenEmbedded}
		<!-- Resize Edge -->
		<div
			class="absolute top-0 right-0 w-1 h-full cursor-ew-resize hover:bg-primary/20 active:bg-primary/40 transition-colors"
			role="separator"
			aria-orientation="vertical"
			tabindex="-1"
			onpointerdown={handlePointerDown}
			onpointermove={handlePointerMove}
			onpointerup={handlePointerUp}
			onpointercancel={handlePointerUp}
		></div>
	{/if}
</div>
