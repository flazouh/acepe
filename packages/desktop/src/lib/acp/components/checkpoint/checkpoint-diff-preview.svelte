<script lang="ts">
import type { FileDiff as CheckpointFileDiff } from "@acepe/ui";
import { FileDiff } from "@pierre/diffs";
import { onDestroy, untrack } from "svelte";
import { useTheme } from "$lib/components/theme/context.svelte.js";

import { getHighlighterPool } from "../../services/highlighter-pool.svelte.js";
import { pierreDiffsUnsafeCSS } from "../../utils/pierre-diffs-theme.js";

interface Props {
	diff: CheckpointFileDiff;
}

let { diff }: Props = $props();

let containerRef: HTMLDivElement | null = $state(null);

let diffInstance: InstanceType<typeof FileDiff> | null = null;

const workerPool = getHighlighterPool();
const themeState = useTheme();
const effectiveTheme = $derived(themeState.effectiveTheme);

const sharedOptions = $derived({
	theme: { dark: "Cursor Dark", light: "pierre-light" },
	themeType: effectiveTheme,
	overflow: "wrap" as const,
	unsafeCSS: pierreDiffsUnsafeCSS,
	disableFileHeader: true,
});

function cleanup(): void {
	if (diffInstance) {
		diffInstance.cleanUp();
		diffInstance = null;
	}
}

function renderDiff(container: HTMLDivElement): void {
	if (!diff.content) return;

	cleanup();

	const instance = new FileDiff(
		{
			...sharedOptions,
			diffStyle: "unified",
			disableLineNumbers: false,
			hunkSeparators: "line-info",
		},
		workerPool
	);

	const fileName = diff.filePath.split("/").pop() ?? diff.filePath;
	const cacheKey = `checkpoint-${diff.filePath}`;

	const oldFile = {
		name: fileName,
		contents: diff.oldContent ?? "",
		cacheKey: `${cacheKey}-old`,
	};

	const newFile = {
		name: fileName,
		contents: diff.content,
		cacheKey: `${cacheKey}-new`,
	};

	instance.render({
		oldFile,
		newFile,
		containerWrapper: container,
	});

	diffInstance = instance;
}

$effect(() => {
	const container = containerRef;
	const d = diff;

	if (container && d?.content) {
		untrack(() => {
			renderDiff(container);
		});
	}
});

$effect(() => {
	void effectiveTheme;
	const container = containerRef;
	if (diffInstance && container) {
		untrack(() => {
			renderDiff(container);
		});
	}
});

onDestroy(() => {
	cleanup();
});
</script>

<div class="min-h-[100px]">
	<div bind:this={containerRef}></div>
</div>
