<script lang="ts">
import {
	type FileDiffMetadata,
	type FileContents,
	parseDiffFromFile,
	FileDiff,
} from "@pierre/diffs";
import type { WorkerPoolManager } from "@pierre/diffs/worker";
import { onDestroy, untrack } from "svelte";
import {
	getEditDiffCacheKey,
	getEditDiffContainerClass,
	getEditDiffFileContents,
	isEditDiffClickable,
} from "./agent-tool-edit-diff-state.js";

interface AgentToolEditDiffProps {
	/** The old string content (what was replaced). */
	oldString: string | null;
	/** The new string content (the replacement). */
	newString: string | null;
	/** File name for language detection. */
	fileName: string | null;
	/** Whether the diff view is expanded. */
	isExpanded: boolean;
	/** Whether content is currently streaming. */
	isStreaming: boolean;
	/** Click handler for expand action when collapsed. */
	onExpandClick?: () => void;
	/** Theme type for syntax highlighting. Defaults to "dark". */
	theme?: "light" | "dark";
	/** Theme names to use. Defaults to pierre built-in themes. */
	themeNames?: { dark: string; light: string };
	/** Optional worker pool for non-blocking syntax highlighting. */
	workerPool?: WorkerPoolManager;
	/** Optional async callback invoked before first render (e.g. for theme registration). */
	onBeforeRender?: () => Promise<void>;
	/** Optional CSS injected into the Pierre diffs shadow DOM. */
	unsafeCSS?: string;
}

let {
	oldString,
	newString,
	fileName,
	isExpanded,
	isStreaming,
	onExpandClick,
	theme = "dark",
	themeNames = { dark: "pierre-dark", light: "pierre-light" },
	workerPool,
	onBeforeRender,
	unsafeCSS = "",
}: AgentToolEditDiffProps = $props();

let containerRef: HTMLDivElement | null = $state(null);
let scrollContainerRef: HTMLDivElement | null = $state(null);
let fileDiffInstance: FileDiff<never> | null = $state(null);
let isDisposed = $state(false);
let renderGeneration = 0;

const isClickable = $derived(isEditDiffClickable({ isExpanded, isStreaming }));

const cacheKey = $derived.by(() => {
	return getEditDiffCacheKey({ oldString, newString, fileName });
});

const diffData = $derived.by(() => {
	const files = getEditDiffFileContents({
		oldString,
		newString,
		fileName,
		cacheKey,
	});
	if (!files) return null;

	const fileDiff = parseDiffFromFile(files.oldFile, files.newFile);

	return { oldFile: files.oldFile, newFile: files.newFile, fileDiff };
});

// Auto-scroll to bottom during streaming
$effect(() => {
	if (isStreaming && isExpanded && newString && scrollContainerRef) {
		scrollContainerRef.scrollTop = scrollContainerRef.scrollHeight;
	}
});

// Render diff when container and data are ready.
$effect(() => {
	const container = containerRef;
	const diff = diffData;
	const currentTheme = theme;
	const currentThemeNames = themeNames;

	if (!container || !diff) {
		return;
	}

	untrack(() => {
		renderDiff(container, diff, currentTheme, currentThemeNames);
	});
});

async function renderDiff(
	container: HTMLDivElement,
	data: {
		oldFile: FileContents;
		newFile: FileContents;
		fileDiff: FileDiffMetadata;
	},
	currentTheme: "light" | "dark",
	currentThemeNames: { dark: string; light: string }
): Promise<void> {
	if (isDisposed) return;
	renderGeneration += 1;
	const generation = renderGeneration;

	// Run optional pre-render hook (e.g. theme registration)
	if (onBeforeRender) {
		await onBeforeRender();
	}

	if (isDisposed || generation !== renderGeneration) return;

	// Clean up existing instance
	if (fileDiffInstance) {
		fileDiffInstance.cleanUp();
		fileDiffInstance = null;
	}

	fileDiffInstance = new FileDiff<never>(
		{
			theme: currentThemeNames,
			themeType: currentTheme,
			diffStyle: "unified",
			disableFileHeader: true,
			hunkSeparators: "simple",
			overflow: "wrap",
			unsafeCSS,
			expandUnchanged: false,
			disableBackground: false,
			disableLineNumbers: true,
			diffIndicators: "bars",
			lineDiffType: "word-alt",
		},
		workerPool
	);

	try {
		fileDiffInstance.render({
			fileDiff: data.fileDiff,
			containerWrapper: container,
		});
	} catch (error) {
		console.error("[AgentToolEditDiff] Failed to render diff:", error);
	}
}

function handleContentClick(): void {
	if (isClickable && onExpandClick) {
		onExpandClick();
	}
}

const containerClass = $derived.by(() => {
	return getEditDiffContainerClass({ isExpanded, isClickable });
});

onDestroy(() => {
	isDisposed = true;
	renderGeneration += 1;
	if (fileDiffInstance) {
		fileDiffInstance.cleanUp();
		fileDiffInstance = null;
	}
});
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
	bind:this={scrollContainerRef}
	onclick={handleContentClick}
	class={containerClass}
	data-scrollable={isExpanded ? "" : undefined}
	role="button"
	tabindex="0"
>
	<div bind:this={containerRef} class="min-h-[40px]"></div>
</div>
