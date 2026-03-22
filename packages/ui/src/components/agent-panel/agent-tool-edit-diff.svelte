<script lang="ts">
	import {
		type FileDiffMetadata,
		type FileContents,
		parseDiffFromFile,
		FileDiff,
	} from "@pierre/diffs";
	import type { WorkerPoolManager } from "@pierre/diffs/worker";
	import { onDestroy, untrack } from "svelte";

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

	const isClickable = $derived(!isExpanded && !isStreaming);

	// Simple FNV-1a hash for cache keys
	function hashContent(content: string): string {
		let hash = 2_166_136_261;
		for (let i = 0; i < content.length; i += 1) {
			hash ^= content.charCodeAt(i);
			hash = Math.imul(hash, 16_777_619);
		}
		return (hash >>> 0).toString(36);
	}

	function createCacheKey(...parts: (string | null | undefined)[]): string {
		return parts.map((p) => hashContent(p ?? "")).join("-");
	}

	const cacheKey = $derived.by(() => {
		if (!oldString && !newString) return null;
		return `edit-inline-${createCacheKey(oldString, newString, fileName)}`;
	});

	const diffData = $derived.by(() => {
		if (newString === null) return null;

		const effectiveFileName = fileName || "file.txt";

		const oldFile: FileContents = {
			name: effectiveFileName,
			contents: oldString || "",
			cacheKey: cacheKey ? `${cacheKey}-old` : undefined,
		};

		const newFile: FileContents = {
			name: effectiveFileName,
			contents: newString,
			cacheKey: cacheKey ? `${cacheKey}-new` : undefined,
		};

		const fileDiff = parseDiffFromFile(oldFile, newFile);

		return { oldFile, newFile, fileDiff };
	});

	// Auto-scroll to bottom during streaming
	$effect(() => {
		if (isStreaming && isExpanded && newString && scrollContainerRef) {
			scrollContainerRef.scrollTop = scrollContainerRef.scrollHeight;
		}
	});

	// Render diff when container and data are ready (skip during streaming)
	$effect(() => {
		const container = containerRef;
		const diff = diffData;
		const streaming = isStreaming;
		const currentTheme = theme;
		const currentThemeNames = themeNames;

		if (streaming || !container || !diff) {
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

		// Run optional pre-render hook (e.g. theme registration)
		if (onBeforeRender) {
			await onBeforeRender();
		}

		if (isDisposed) return;

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
		const base = "border-t border-border font-mono text-xs transition-colors duration-150";
		const expandedClasses = isExpanded
			? "max-h-[200px] overflow-y-auto"
			: "h-[72px] overflow-hidden";
		const clickableClasses = isClickable ? "cursor-pointer hover:bg-muted/50" : "";
		return `${base} ${expandedClasses} ${clickableClasses}`;
	});

	onDestroy(() => {
		isDisposed = true;
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
	{#if isStreaming && newString}
		<div class="px-2.5 py-0.5 text-muted-foreground whitespace-pre-wrap break-all">
			{newString}
		</div>
	{:else}
		<div bind:this={containerRef} class="min-h-[40px]"></div>
	{/if}
</div>
