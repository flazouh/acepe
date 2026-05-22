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
import { MarkdownDisplay } from "@acepe/ui";
import "@acepe/ui/markdown-prose.css";
import { useTheme } from "$lib/components/theme/context.svelte.js";
import { CodeMirrorEditor } from "$lib/components/ui/codemirror-editor/index.js";
import type { FileExplorerPreviewResponse } from "$lib/services/converted-session-types.js";
import {
	buildPierreDiffOptions,
	ensurePierreThemeRegistered,
} from "../../utils/pierre-rendering.js";
import { getWorkerPool } from "../../utils/worker-pool-singleton.js";
import {
	buildFileExplorerDiffInput,
	getFileExplorerCodePreviewLanguage,
	getFileExplorerFallbackMessage,
	getFileExplorerTextFallbackContent,
	isFileExplorerMarkdownPreview,
	shouldRenderFileExplorerPlainText,
	type FileExplorerDiffInput,
} from "./file-explorer-preview-pane-state.js";

interface Props {
	preview: FileExplorerPreviewResponse | null;
	preferPlainText?: boolean;
}

const { preview, preferPlainText = false }: Props = $props();

let containerRef: HTMLDivElement | null = $state(null);
let fileDiffInstance: FileDiff<never> | null = $state(null);
let isDisposed = $state(false);
let renderError = $state<string | null>(null);
const themeState = useTheme();
const effectiveTheme = $derived(themeState.effectiveTheme);

// ---------------------------------------------------------------------------
// Derive before/after content from the preview response
// ---------------------------------------------------------------------------

function buildFileDiffOptions(theme: "light" | "dark") {
	return Object.assign(buildPierreDiffOptions<never>(theme, "unified", "wrap", false), {
		disableErrorHandling: true,
	});
}

const isMarkdownPreview = $derived(isFileExplorerMarkdownPreview(preview));
const textFallbackContent = $derived(getFileExplorerTextFallbackContent(preview));
const shouldRenderPlainText = $derived(
	shouldRenderFileExplorerPlainText({ preview, preferPlainText })
);
const codePreviewLanguage = $derived(getFileExplorerCodePreviewLanguage(preview));
const diffInput = $derived(
	buildFileExplorerDiffInput({
		preview,
		shouldRenderPlainText,
		isMarkdownPreview,
	})
);

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
	input: FileExplorerDiffInput,
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
	const isFirstRender = fileDiffInstance === null;
	if (isFirstRender) {
		fileDiffInstance = new FileDiff<never>(options, getWorkerPool(), true);
	} else {
		if (fileDiffInstance === null) {
			return;
		}
		fileDiffInstance.setOptions(options);
	}
	if (fileDiffInstance === null) {
		return;
	}
	fileDiffInstance.setThemeType(theme);

	try {
		const renderStartedAt = performance.now();
		fileDiffInstance.render({
			fileDiff: fileDiffMetadata,
			containerWrapper: isFirstRender ? container : undefined,
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

const fallbackMessage = $derived(getFileExplorerFallbackMessage(preview));
</script>

<div class="flex-1 min-h-0 overflow-hidden flex flex-col">
	{#if preview === null}
		<div class="flex-1 flex items-center justify-center text-sm text-muted-foreground">
			Select a file to preview
		</div>
	{:else if preview.kind === "fallback"}
		<div class="flex-1 flex flex-col items-center justify-center gap-2 p-6 text-center">
			<p class="text-sm text-muted-foreground">
				{fallbackMessage}
			</p>
			<p class="text-xs text-muted-foreground/60 font-mono">{preview.file_name}</p>
		</div>
	{:else if preview.kind === "text" && isMarkdownPreview}
		<div class="flex-1 overflow-auto min-h-0 p-4">
			<MarkdownDisplay
				content={preview.content}
				textSize="text-sm"
				contentPaddingClass="p-0"
				class="prose prose-sm max-w-none"
			/>
		</div>
	{:else if shouldRenderPlainText && textFallbackContent !== null}
		<CodeMirrorEditor value={textFallbackContent} language={codePreviewLanguage} readonly />
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
