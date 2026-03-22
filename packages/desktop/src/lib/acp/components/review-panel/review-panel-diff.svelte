<script lang="ts">
import { type FileContents, parseDiffFromFile } from "@pierre/diffs";
import { onDestroy, untrack } from "svelte";
import { useTheme } from "$lib/components/theme/context.svelte.js";
import {
	type ReviewDiffData,
	ReviewDiffViewState,
} from "../modified-files/components/review-diff-view-state.svelte.js";
import type { ModifiedFileEntry } from "../modified-files/types/modified-file-entry.js";

interface Props {
	file: ModifiedFileEntry;
	projectPath?: string;
	isActive?: boolean;
	onHunkAccept?: (hunkIndex: number) => void;
	onHunkReject?: (hunkIndex: number, oldContent: string) => void;
	/** Called when diff is ready so parent can wire bottom widget controls. */
	onDiffStateReady?: (state: ReviewDiffViewState) => void;
}

let {
	file,
	projectPath: _projectPath = "",
	isActive = true,
	onHunkAccept,
	onHunkReject,
	onDiffStateReady,
}: Props = $props();

let containerRef: HTMLDivElement | null = $state(null);
const themeState = useTheme();
const effectiveTheme = $derived(themeState.effectiveTheme);
const diffViewState = new ReviewDiffViewState();

// Compute the combined diff for original and final file content
const diffData = $derived.by((): ReviewDiffData | null => {
	if (file.originalContent === null && file.finalContent === null) return null;

	const originalContent = file.originalContent ?? "";
	const finalContent = file.finalContent ?? "";

	const cacheKey = `review-${file.filePath}`;

	const oldFile: FileContents = {
		name: file.fileName,
		contents: originalContent,
		cacheKey: `${cacheKey}-old`,
	};

	const newFile: FileContents = {
		name: file.fileName,
		contents: finalContent,
		cacheKey: `${cacheKey}-new`,
	};

	// Pre-parse to get FileDiffMetadata which enables:
	// - Full file rendering with expandable hunks
	// - Accept/reject hunk functionality
	const fileDiffMetadata = parseDiffFromFile(oldFile, newFile);

	return {
		oldFile,
		newFile,
		fileDiffMetadata,
	};
});

function handleHunkAction(
	hunkIndex: number,
	action: "accept" | "reject",
	hunkOldContent: string
): void {
	// Apply the action to the diff view — bail if state isn't ready
	const result = diffViewState.applyHunkAction(hunkIndex, action);
	if (!result) return;

	if (action === "accept") {
		onHunkAccept?.(hunkIndex);
	} else {
		// Pass the specific hunk's old content for per-hunk revert
		onHunkReject?.(hunkIndex, hunkOldContent);
	}
}

function renderDiff(container: HTMLDivElement): void {
	if (!diffData) return;

	diffViewState.themeType = effectiveTheme;
	diffViewState
		.initializeDiff(
			diffData,
			container,
			undefined, // onStyleChange
			handleHunkAction
		)
		.then(() => {
			onDiffStateReady?.(diffViewState);
		});
}

$effect(() => {
	const container = containerRef;
	const currentFile = file;
	const diff = diffData;

	if (container && currentFile && diff) {
		untrack(() => {
			renderDiff(container);
		});
	}
});

// Sync theme changes to the pierre diffs instance
$effect(() => {
	const theme = effectiveTheme;
	untrack(() => {
		diffViewState.setThemeType(theme);
	});
});

function handleKeydown(event: KeyboardEvent): void {
	if (!isActive) return;
	if (event.key === "y" && event.metaKey) {
		event.preventDefault();
		diffViewState.acceptFirstPendingHunk();
	} else if (event.key === "n" && event.metaKey) {
		event.preventDefault();
		diffViewState.rejectFirstPendingHunk();
	}
}

onDestroy(() => {
	diffViewState.cleanup();
});
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex-1 overflow-auto min-h-0">
	<div bind:this={containerRef} class="min-h-[200px]"></div>
</div>
