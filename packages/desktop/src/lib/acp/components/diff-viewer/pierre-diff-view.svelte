<script lang="ts">
/**
 * PierreDiffView — Renders a unified diff using @pierre/diffs.
 * Takes a patch string and filename, reconstructs before/after content,
 * and renders with syntax highlighting and word-level diffs.
 */
import { type FileContents, FileDiff, parseDiffFromFile } from "@pierre/diffs";
import { onDestroy, untrack } from "svelte";
import { useTheme } from "$lib/components/theme/context.svelte.js";

import type { FileDiff as FileDiffType } from "../../types/github-integration.js";
import { parsePatchToBeforeAfter } from "../../utils/diff-patch-parser.js";
import {
	buildPierreDiffOptions,
	ensurePierreThemeRegistered,
} from "../../utils/pierre-rendering.js";
import { getWorkerPool } from "../../utils/worker-pool-singleton.js";

interface Props {
	diff: FileDiffType;
	viewMode: "inline" | "side-by-side";
}

let { diff, viewMode }: Props = $props();

let containerRef: HTMLDivElement | null = $state(null);
let fileDiffInstance: FileDiff<never> | null = $state(null);
let isDisposed = $state(false);
let renderError = $state<string | null>(null);

const themeState = useTheme();
const effectiveTheme = $derived(themeState.effectiveTheme);

const diffData = $derived.by(() => {
	const parseResult = parsePatchToBeforeAfter(diff.patch, diff.status);
	if (parseResult.isErr()) {
		return null;
	}

	const { before, after } = parseResult.value;

	const oldFile: FileContents = {
		name: diff.path,
		contents: before,
	};

	const newFile: FileContents = {
		name: diff.path,
		contents: after,
	};

	const fileDiffMetadata = parseDiffFromFile(oldFile, newFile);

	return { oldFile, newFile, fileDiffMetadata };
});

$effect(() => {
	const container = containerRef;
	const data = diffData;
	const mode = viewMode;
	const theme = effectiveTheme;

	if (!container || !data) return;

	untrack(() => {
		renderDiff(container, data, mode, theme);
	});
});

// Sync theme changes
$effect(() => {
	const theme = effectiveTheme;
	untrack(() => {
		if (fileDiffInstance) {
			fileDiffInstance.setThemeType(theme);
		}
	});
});

async function renderDiff(
	container: HTMLDivElement,
	data: NonNullable<typeof diffData>,
	mode: "inline" | "side-by-side",
	theme: "light" | "dark"
): Promise<void> {
	if (isDisposed) return;
	renderError = null;

	await ensurePierreThemeRegistered();

	if (isDisposed) return;

	const nextOptions = buildPierreDiffOptions<never>(
		theme,
		mode === "side-by-side" ? "split" : "unified",
		"wrap",
		false
	);

	if (fileDiffInstance === null) {
		fileDiffInstance = new FileDiff<never>(nextOptions, getWorkerPool());
	} else {
		fileDiffInstance.setOptions(nextOptions);
	}
	fileDiffInstance.setThemeType(theme);

	try {
		fileDiffInstance.render({
			fileDiff: data.fileDiffMetadata,
			containerWrapper: container,
		});
	} catch (error) {
		console.error("[PierreDiffView] Failed to render diff:", error);
		renderError = error instanceof Error ? error.message : "Failed to render diff";
	}
}

onDestroy(() => {
	isDisposed = true;
	const currentFileDiffInstance = fileDiffInstance;
	if (currentFileDiffInstance) {
		currentFileDiffInstance.cleanUp();
		fileDiffInstance = null;
	}
});
</script>

<div class="flex-1 overflow-auto min-h-0">
	{#if renderError}
		<div class="flex items-center justify-center h-full text-muted-foreground text-sm p-4">
			{renderError}
		</div>
	{:else if !diffData}
		<div class="flex items-center justify-center h-full text-muted-foreground text-sm">
			{#if diff.patch.includes("Binary files")}
				Binary file — cannot display diff
			{:else}
				Unable to parse diff
			{/if}
		</div>
	{:else}
		<div bind:this={containerRef} class="min-h-[200px]"></div>
	{/if}
</div>
