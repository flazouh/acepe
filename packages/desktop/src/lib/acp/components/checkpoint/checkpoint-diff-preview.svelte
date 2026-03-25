<script lang="ts">
import type { FileDiff as CheckpointFileDiff } from "@acepe/ui";
import { FileDiff } from "@pierre/diffs";
import { onDestroy, untrack } from "svelte";
import { useTheme } from "$lib/components/theme/context.svelte.js";

import { getHighlighterPool } from "../../services/highlighter-pool.svelte.js";
import { buildPierreDiffOptions, ensurePierreThemeRegistered } from "../../utils/pierre-rendering.js";

interface Props {
	diff: CheckpointFileDiff;
}

let { diff }: Props = $props();

let containerRef: HTMLDivElement | null = $state(null);

let diffInstance: InstanceType<typeof FileDiff> | null = null;

const workerPool = getHighlighterPool();
const themeState = useTheme();
const effectiveTheme = $derived(themeState.effectiveTheme);

const diffOptions = $derived(buildPierreDiffOptions(effectiveTheme, "unified", "wrap", false));

function cleanup(): void {
	if (diffInstance) {
		diffInstance.cleanUp();
		diffInstance = null;
	}
}

function renderDiff(container: HTMLDivElement): void {
	if (!diff.content) return;

	if (diffInstance === null) {
		diffInstance = new FileDiff(diffOptions, workerPool);
	} else {
		diffInstance.setOptions(diffOptions);
	}
	diffInstance.setThemeType(effectiveTheme);

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

	diffInstance.render({
		oldFile,
		newFile,
		containerWrapper: container,
	});
}

$effect(() => {
	const container = containerRef;
	const d = diff;

	if (container && d?.content) {
		untrack(() => {
			void ensurePierreThemeRegistered().then(() => {
				renderDiff(container);
			});
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
