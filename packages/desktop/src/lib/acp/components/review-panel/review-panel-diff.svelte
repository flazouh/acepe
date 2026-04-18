<script lang="ts">
import { onDestroy, untrack } from "svelte";
import { useTheme } from "$lib/components/theme/context.svelte.js";
import { fileContentCache } from "../../services/file-content-cache.svelte.js";
import {
	type ReviewDiffData,
	ReviewDiffViewState,
} from "../modified-files/components/review-diff-view-state.svelte.js";
import type { ModifiedFileEntry } from "../modified-files/types/modified-file-entry.js";
import { createReviewDiffData } from "./review-diff-data.js";

interface Props {
	file: ModifiedFileEntry;
	projectPath?: string | null;
	isActive?: boolean;
	onHunkAccept?: (hunkIndex: number) => void;
	onHunkReject?: (hunkIndex: number, oldContent: string) => void;
	/** Called when diff is ready so parent can wire bottom widget controls. */
	onDiffStateReady?: (state: ReviewDiffViewState) => void;
}

let {
	file,
	projectPath = null,
	isActive = true,
	onHunkAccept,
	onHunkReject,
	onDiffStateReady,
}: Props = $props();

let containerRef: HTMLDivElement | null = $state(null);
let fetchedDiffData = $state<ReviewDiffData | null>(null);
const themeState = useTheme();
const effectiveTheme = $derived(themeState.effectiveTheme);
const diffViewState = new ReviewDiffViewState();
let lastRequestedDiffKey = 0;

const embeddedDiffData = $derived.by(() =>
	createReviewDiffData(file, file.originalContent, file.finalContent)
);

const diffData = $derived.by(() => fetchedDiffData ?? embeddedDiffData);

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
	const currentFile = file;
	const currentProjectPath = projectPath;
	const requestKey = lastRequestedDiffKey + 1;
	lastRequestedDiffKey = requestKey;
	fetchedDiffData = null;

	if (!currentProjectPath) {
		return;
	}

	fileContentCache.getFileDiff(currentFile.filePath, currentProjectPath).match(
		(diff) => {
			if (requestKey !== lastRequestedDiffKey) {
				return;
			}

			fetchedDiffData = createReviewDiffData(currentFile, diff.oldContent, diff.newContent);
		},
		(error) => {
			if (requestKey !== lastRequestedDiffKey) {
				return;
			}

			console.error(`Failed to load full diff for ${currentFile.filePath}:`, error.message);
			fetchedDiffData = null;
		}
	);
});

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
