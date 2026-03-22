<script lang="ts">
import { FileDiff, File as PierreFile } from "@pierre/diffs";
import { onDestroy } from "svelte";
import { useTheme } from "$lib/components/theme/context.svelte.js";
import type { GitGutterInput } from "$lib/components/ui/codemirror-editor/git-gutter.js";

import { getHighlighterPool } from "../../services/highlighter-pool.svelte.js";
import { pierreDiffsUnsafeCSS } from "../../utils/pierre-diffs-theme.js";

interface Props {
	filePath: string;
	projectPath: string;
	content: string;
	gitGutterInput: GitGutterInput;
}

let { filePath, projectPath, content, gitGutterInput }: Props = $props();

let containerRef: HTMLDivElement | null = $state(null);
let fileInstance: InstanceType<typeof PierreFile> | null = null;
let diffInstance: InstanceType<typeof FileDiff> | null = null;

const workerPool = getHighlighterPool();
const themeState = useTheme();
const effectiveTheme = $derived(themeState.effectiveTheme);
const fileName = $derived(filePath.split("/").pop() ?? filePath);

const sharedOptions = $derived({
	theme: { dark: "Cursor Dark", light: "pierre-light" },
	themeType: effectiveTheme,
	overflow: "scroll" as const,
	unsafeCSS: pierreDiffsUnsafeCSS,
	disableFileHeader: true,
	disableLineNumbers: false,
});

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

function render(): void {
	if (!containerRef) return;

	cleanup();

	if (gitGutterInput?.kind === "modified") {
		diffInstance = new FileDiff(
			{
				...sharedOptions,
				diffStyle: "unified",
				hunkSeparators: "line-info",
			},
			workerPool
		);
		diffInstance.render({
			oldFile: {
				name: fileName,
				contents: gitGutterInput.oldContent,
				cacheKey: `file-panel-read-old-${projectPath}-${filePath}`,
			},
			newFile: {
				name: fileName,
				contents: content,
				cacheKey: `file-panel-read-new-${projectPath}-${filePath}`,
			},
			containerWrapper: containerRef,
		});
		return;
	}

	if (gitGutterInput?.kind === "new-file") {
		diffInstance = new FileDiff(
			{
				...sharedOptions,
				diffStyle: "unified",
				hunkSeparators: "line-info",
			},
			workerPool
		);
		diffInstance.render({
			oldFile: {
				name: fileName,
				contents: "",
				cacheKey: `file-panel-read-old-empty-${projectPath}-${filePath}`,
			},
			newFile: {
				name: fileName,
				contents: content,
				cacheKey: `file-panel-read-new-${projectPath}-${filePath}`,
			},
			containerWrapper: containerRef,
		});
		return;
	}

	fileInstance = new PierreFile(sharedOptions, workerPool);
	fileInstance.render({
		file: {
			name: fileName,
			contents: content,
			cacheKey: `file-panel-read-file-${projectPath}-${filePath}`,
		},
		containerWrapper: containerRef,
	});
}

$effect(() => {
	void effectiveTheme;
	void content;
	void gitGutterInput;
	void filePath;
	void projectPath;
	render();
});

onDestroy(() => {
	cleanup();
});
</script>

<div class="h-full overflow-auto" bind:this={containerRef}></div>
