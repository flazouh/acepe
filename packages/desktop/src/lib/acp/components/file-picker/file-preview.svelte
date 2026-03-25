<script lang="ts">
import { DiffPill } from "@acepe/ui";
import { FileDiff, File as PierreFile } from "@pierre/diffs";
import { onDestroy } from "svelte";
import { useTheme } from "$lib/components/theme/context.svelte.js";
import { FileReadError } from "$lib/components/ui/file-read-error/index.js";
import { fileContentCache } from "../../services/file-content-cache.svelte.js";
import { getHighlighterPool } from "../../services/highlighter-pool.svelte.js";
import type { FilePickerEntry } from "../../types/file-picker-entry.js";
import {
	buildPierreDiffOptions,
	buildPierreFileOptions,
	ensurePierreThemeRegistered,
} from "../../utils/pierre-rendering.js";

interface Props {
	file: FilePickerEntry | null;
	projectPath: string;
}

const { file, projectPath }: Props = $props();

// Container element for rendering
let containerRef: HTMLDivElement | null = $state(null);

// Track instances for cleanup
let fileInstance: InstanceType<typeof PierreFile> | null = null;
let diffInstance: InstanceType<typeof FileDiff> | null = null;

// Loading and error state
let isLoading = $state(false);
let errorMessage = $state<string | null>(null);

// Get worker pool for background highlighting
const workerPool = getHighlighterPool();

const themeState = useTheme();
const effectiveTheme = $derived(themeState.effectiveTheme);

// Shared options for @pierre/diffs
const fileOptions = $derived(buildPierreFileOptions(effectiveTheme, "wrap", false));
const diffOptions = $derived(buildPierreDiffOptions(effectiveTheme, "unified", "wrap", false));

/**
 * Cleanup existing instances before rendering new content.
 */
function cleanup(): void {
	if (fileInstance) {
		fileInstance.cleanUp();
		fileInstance = null;
	}
	if (diffInstance) {
		diffInstance.cleanUp();
		diffInstance = null;
	}
}

/**
 * Render file content (no diff).
 */
function renderFileContent(content: string, fileName: string): void {
	if (!containerRef) return;

	if (fileInstance === null) {
		fileInstance = new PierreFile(fileOptions, workerPool);
	} else {
		fileInstance.setOptions(fileOptions);
	}
	fileInstance.setThemeType(effectiveTheme);

	const currentDiffInstance = diffInstance;
	if (currentDiffInstance) {
		currentDiffInstance.cleanUp();
		diffInstance = null;
	}

	fileInstance.render({
		file: {
			name: fileName,
			contents: content,
			cacheKey: `file-${projectPath}-${file?.path}`,
		},
		containerWrapper: containerRef,
	});
}

/**
 * Render file diff.
 */
function renderFileDiff(oldContent: string | null, newContent: string, fileName: string): void {
	if (!containerRef) return;

	if (diffInstance === null) {
		diffInstance = new FileDiff(diffOptions, workerPool);
	} else {
		diffInstance.setOptions(diffOptions);
	}
	diffInstance.setThemeType(effectiveTheme);

	const currentFileInstance = fileInstance;
	if (currentFileInstance) {
		currentFileInstance.cleanUp();
		fileInstance = null;
	}

	const oldFile = oldContent
		? {
				name: fileName,
				contents: oldContent,
				cacheKey: `diff-old-${projectPath}-${file?.path}`,
			}
		: {
				name: fileName,
				contents: "",
				cacheKey: `diff-old-empty-${projectPath}-${file?.path}`,
			};

	const newFile = {
		name: fileName,
		contents: newContent,
		cacheKey: `diff-new-${projectPath}-${file?.path}`,
	};

	diffInstance.render({
		oldFile,
		newFile,
		containerWrapper: containerRef,
	});
}

/**
 * Load and render the file.
 */
async function loadAndRender(): Promise<void> {
	if (!file || !containerRef) {
		cleanup();
		return;
	}

	await ensurePierreThemeRegistered();

	isLoading = true;
	errorMessage = null;

	// If file has git status, load diff
	if (file.gitStatus) {
		const result = await fileContentCache.getFileDiff(file.path, projectPath);

		result.match(
			(diff) => {
				renderFileDiff(diff.oldContent, diff.newContent, diff.fileName);
				isLoading = false;
			},
			(error) => {
				errorMessage = error.message;
				isLoading = false;
			}
		);
	} else {
		// No git status, just load file content
		const result = await fileContentCache.getFileContent(file.path, projectPath);

		result.match(
			(content) => {
				const fileName = file.path.split("/").pop() ?? file.path;
				renderFileContent(content, fileName);
				isLoading = false;
			},
			(error) => {
				errorMessage = error.message;
				isLoading = false;
			}
		);
	}
}

// React to file and theme changes
$effect(() => {
	// Track both file and effectiveTheme so re-renders happen on theme switches too
	void effectiveTheme;
	if (file && containerRef) {
		loadAndRender();
	} else {
		cleanup();
	}
});

// Cleanup on destroy
onDestroy(() => {
	cleanup();
});
</script>

<div class="h-full flex flex-col overflow-hidden bg-background">
	{#if !file}
		<div class="flex-1 flex items-center justify-center text-muted-foreground text-sm">
			Select a file to preview
		</div>
	{:else}
		<!-- Header - always show when file is selected -->
		<div class="px-3 py-2 border-b bg-muted/30 flex items-center gap-2 shrink-0">
			<span class="font-mono text-xs text-foreground truncate">{file.path}</span>
			{#if file.gitStatus}
				<DiffPill insertions={file.gitStatus.insertions} deletions={file.gitStatus.deletions} />
			{/if}
		</div>

		<!-- Content container - always mounted so containerRef is stable -->
		<div class="flex-1 overflow-auto relative">
			{#if isLoading}
				<div
					class="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm bg-background"
				>
					Loading...
				</div>
			{:else if errorMessage}
				<div class="absolute inset-0 flex items-center justify-center p-4 bg-background">
					<FileReadError message={errorMessage} path={file?.path ?? null} centered />
				</div>
			{/if}
			<!-- Always render container so ref stays stable -->
			<div class="h-full" bind:this={containerRef}></div>
		</div>
	{/if}
</div>
