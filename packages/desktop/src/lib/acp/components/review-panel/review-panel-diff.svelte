<script lang="ts">
import { onDestroy, tick, untrack } from "svelte";
import { useTheme } from "$lib/components/theme/context.svelte.js";
import { fileContentCache } from "../../services/file-content-cache.svelte.js";
import {
	DEFAULT_REVIEW_DIFF_OPTIONS,
	type DiffViewStyle,
	type ReviewDiffData,
	type ReviewDiffDensity,
	type ReviewDiffOptions,
	ReviewDiffViewState,
} from "../modified-files/components/review-diff-view-state.svelte.js";
import type { ModifiedFileEntry } from "../../types/modified-file-entry.js";
import {
	createReviewDiffData,
	createReviewDiffDataFromBaseAndEdits,
	selectReviewDiffData,
} from "./review-diff-data.js";

interface Props {
	file: ModifiedFileEntry;
	projectPath?: string | null;
	isActive?: boolean;
	density?: ReviewDiffDensity;
	diffStyle?: DiffViewStyle;
	diffOptions?: ReviewDiffOptions;
}

let {
	file,
	projectPath = null,
	isActive: _isActive = true,
	density = "default",
	diffStyle = "unified",
	diffOptions = DEFAULT_REVIEW_DIFF_OPTIONS,
}: Props = $props();

let containerRef: HTMLDivElement | null = $state(null);
let fetchedDiffData = $state<ReviewDiffData | null>(null);
let fetchedDiffSettled = $state(false);
const themeState = useTheme();
const effectiveTheme = $derived(themeState.effectiveTheme);
const diffViewState = new ReviewDiffViewState();
let lastRequestedDiffKey = 0;

const embeddedDiffData = $derived.by(() =>
	createReviewDiffData(file, file.originalContent, file.finalContent)
);

const reconstructedDiffData = $derived.by(() =>
	createReviewDiffDataFromBaseAndEdits(file, fetchedDiffData?.newFile.contents ?? null)
);

const diffData = $derived.by(() =>
	selectReviewDiffData(fetchedDiffData, embeddedDiffData, {
		preferFetchedDiff: projectPath !== null,
		fetchedDiffSettled,
		file,
		reconstructedDiffData,
	})
);

function waitForContainerLayout(container: HTMLElement): Promise<void> {
	if (container.clientWidth > 0 && container.clientHeight > 0) {
		return Promise.resolve();
	}

	return new Promise((resolve) => {
		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (!entry) {
				return;
			}

			const width = entry.contentRect.width;
			const height = entry.contentRect.height;
			if (width > 0 && height > 0) {
				observer.disconnect();
				resolve();
			}
		});
		observer.observe(container);
	});
}

async function renderDiff(
	container: HTMLDivElement,
	style: DiffViewStyle,
	options: ReviewDiffOptions
): Promise<void> {
	if (!diffData) return;

	await tick();
	await waitForContainerLayout(container);

	diffViewState.themeType = effectiveTheme;
	await diffViewState.initializeDiff(diffData, container, density, style, options);
}

$effect(() => {
	const currentFile = file;
	const currentProjectPath = projectPath;
	const requestKey = lastRequestedDiffKey + 1;
	lastRequestedDiffKey = requestKey;
	fetchedDiffData = null;
	fetchedDiffSettled = false;

	if (!currentProjectPath) {
		fetchedDiffSettled = true;
		return;
	}

	fileContentCache.getFileDiff(currentFile.filePath, currentProjectPath).match(
		(diff) => {
			if (requestKey !== lastRequestedDiffKey) {
				return;
			}

			fetchedDiffData = createReviewDiffData(currentFile, diff.oldContent, diff.newContent);
			fetchedDiffSettled = true;
		},
		(error) => {
			if (requestKey !== lastRequestedDiffKey) {
				return;
			}

			console.error(`Failed to load full diff for ${currentFile.filePath}:`, error.message);
			fetchedDiffData = null;
			fetchedDiffSettled = true;
		}
	);
});

$effect(() => {
	const container = containerRef;
	const currentFile = file;
	const diff = diffData;
	const currentDiffStyle = diffStyle;
	const currentDiffOptions = diffOptions;

	if (container && currentFile && diff) {
		untrack(() => {
			void renderDiff(container, currentDiffStyle, currentDiffOptions);
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

onDestroy(() => {
	diffViewState.cleanup();
});
</script>

<div class="flex h-full min-h-0 flex-1 flex-col overflow-auto">
	<div bind:this={containerRef} class="min-h-[200px]"></div>
</div>
