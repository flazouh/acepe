<script lang="ts">
/**
 * FileExplorerPreviewPane
 *
 * Renders the preview panel on the right side of the file explorer modal.
 * Handles the three preview kinds: diff, text, and fallback.
 *
 * For diff/text kinds we use Pierre's FileDiff renderer directly from
 * before/after content strings (no patch parsing required).
 */
import { type FileContents, FileDiff, parseDiffFromFile } from "@pierre/diffs";
import { onDestroy, untrack } from "svelte";
import "@acepe/ui/markdown-prose.css";
import { useTheme } from "$lib/components/theme/context.svelte.js";
import type { FileExplorerPreviewResponse } from "$lib/services/converted-session-types.js";
import { isMarkdownInitialized, renderMarkdownSync } from "$lib/acp/utils/markdown-renderer.js";
import {
	buildPierreDiffOptions,
	ensurePierreThemeRegistered,
} from "../../utils/pierre-rendering.js";
import { getWorkerPool } from "../../utils/worker-pool-singleton.js";

interface Props {
	preview: FileExplorerPreviewResponse | null;
}

const props = $props<Props>();

let containerRef: HTMLDivElement | null = $state(null);
let fileDiffInstance: FileDiff<never> | null = $state(null);
let isDisposed = $state(false);
let renderError = $state<string | null>(null);
const themeState = useTheme();
const effectiveTheme = $derived(themeState.effectiveTheme);

// ---------------------------------------------------------------------------
// Derive before/after content from the preview response
// ---------------------------------------------------------------------------

type DiffInput = {
	fileName: string;
	oldContent: string;
	newContent: string;
};

function buildFileDiffOptions(theme: "light" | "dark") {
	return Object.assign(buildPierreDiffOptions<never>(theme, "unified", "wrap", false), {
		disableErrorHandling: true,
	});
}

const isMarkdownPreview = $derived.by(() => {
	if (props.preview === null || props.preview.kind !== "text") return false;
	if (props.preview.language_hint === "markdown") return true;
	return props.preview.file_name.toLowerCase().endsWith(".md");
});

const markdownHtml = $derived.by(() => {
	if (props.preview === null || props.preview.kind !== "text" || !isMarkdownPreview) return null;
	if (!isMarkdownInitialized()) return null;
	const result = renderMarkdownSync(props.preview.content);
	return result.html;
});

const textFallbackContent = $derived.by(() => {
	if (props.preview === null) return null;
	if (props.preview.kind === "diff") return props.preview.new_content;
	if (props.preview.kind !== "text") return null;
	return props.preview.content;
});

const diffInput = $derived.by((): DiffInput | null => {
	if (props.preview === null) return null;
	if (isMarkdownPreview) return null;
	if (props.preview.kind === "diff") {
		return {
			fileName: props.preview.file_name,
			oldContent: props.preview.old_content !== null ? props.preview.old_content : "",
			newContent: props.preview.new_content,
		};
	}
	if (props.preview.kind === "text") {
		// Show as diff with identical before/after so Pierre renders with syntax highlighting
		return {
			fileName: props.preview.file_name,
			oldContent: props.preview.content,
			newContent: props.preview.content,
		};
	}
	return null;
});

// Re-render when diffInput or theme changes
$effect(() => {
	const container = containerRef;
	const input = diffInput;
	const theme = effectiveTheme;

	if (!container || !input) return;

	untrack(() => {
		void renderDiff(container, input, theme);
	});
});

// Sync theme without full re-render
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
	input: DiffInput,
	theme: "light" | "dark"
): Promise<void> {
	if (isDisposed) return;
	renderError = null;

	await ensurePierreThemeRegistered();
	if (isDisposed) return;
	const parseStartedAt = performance.now();

	const oldFile: FileContents = { name: input.fileName, contents: input.oldContent };
	const newFile: FileContents = { name: input.fileName, contents: input.newContent };
	const fileDiffMetadata = parseDiffFromFile(oldFile, newFile);
	const parseElapsedMs = Math.round(performance.now() - parseStartedAt);
	const options = buildFileDiffOptions(theme);

	if (fileDiffInstance === null) {
		fileDiffInstance = new FileDiff<never>(options, getWorkerPool(), true);
	} else {
		fileDiffInstance.setOptions(options);
	}
	fileDiffInstance.setThemeType(theme);

	try {
		const renderStartedAt = performance.now();
		fileDiffInstance.render({
			fileDiff: fileDiffMetadata,
			containerWrapper: container,
			forceRender: true,
		});
		const renderElapsedMs = Math.round(performance.now() - renderStartedAt);
		if (renderElapsedMs > 16 || parseElapsedMs > 16) {
			console.debug("[file-explorer-preview] pierre render timing", {
				fileName: input.fileName,
				parseElapsedMs,
				renderElapsedMs,
			});
		}
	} catch (_error) {
		renderError = "Failed to render preview";
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

// ---------------------------------------------------------------------------
// Fallback reason label
// ---------------------------------------------------------------------------

const fallbackMessage = $derived.by(() => {
	if (props.preview === null) return null;
	if (props.preview.kind !== "fallback") return null;
	const kind = props.preview.preview_kind;
	if (kind === "binary") return "Binary file - cannot display preview";
	if (kind === "large") return "File is too large to preview";
	if (kind === "deleted") return "File has been deleted";
	return "Preview unavailable";
});
</script>

<div class="flex-1 min-h-0 overflow-hidden flex flex-col">
	{#if props.preview === null}
		<div class="flex-1 flex items-center justify-center text-sm text-muted-foreground">
			Select a file to preview
		</div>
	{:else if props.preview.kind === "fallback"}
		<div class="flex-1 flex flex-col items-center justify-center gap-2 p-6 text-center">
			<p class="text-sm text-muted-foreground">
				{fallbackMessage}
			</p>
			<p class="text-xs text-muted-foreground/60 font-mono">{props.preview.file_name}</p>
		</div>
	{:else if props.preview.kind === "text" && isMarkdownPreview && markdownHtml}
		<div class="flex-1 overflow-auto min-h-0 p-4">
			<div class="markdown-content prose prose-sm max-w-none">
				{@html markdownHtml}
			</div>
		</div>
	{:else if props.preview.kind === "text" && isMarkdownPreview && textFallbackContent !== null}
		<div class="flex-1 overflow-auto min-h-0 p-4">
			<pre class="text-xs leading-relaxed whitespace-pre-wrap break-words font-mono text-foreground">{textFallbackContent}</pre>
		</div>
	{:else if renderError && textFallbackContent !== null}
		<div class="flex-1 overflow-auto min-h-0 p-4">
			<pre class="text-xs leading-relaxed whitespace-pre-wrap break-words font-mono text-foreground">{textFallbackContent}</pre>
		</div>
	{:else if renderError}
		<div class="flex-1 flex items-center justify-center text-sm text-muted-foreground p-4">
			Preview unavailable
		</div>
	{:else}
		<!-- Pierre diff / text viewer -->
		<div class="flex-1 overflow-auto min-h-0">
			<div bind:this={containerRef} class="min-h-[200px]"></div>
		</div>
	{/if}
</div>
