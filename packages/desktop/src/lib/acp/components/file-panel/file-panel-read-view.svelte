<script lang="ts">
import { FileDiff, File as PierreFile } from "@pierre/diffs";
import { onDestroy } from "svelte";
import { useTheme } from "$lib/components/theme/context.svelte.js";
import type { GitGutterInput } from "$lib/components/ui/codemirror-editor/git-gutter.js";

import { getHighlighterPool } from "../../services/highlighter-pool.svelte.js";
import {
	buildPierreDiffOptions,
	buildPierreFileOptions,
	ensurePierreThemeRegistered,
} from "../../utils/pierre-rendering.js";

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

const fileOptions = $derived(buildPierreFileOptions(effectiveTheme, "scroll", false));
const diffOptions = $derived(buildPierreDiffOptions(effectiveTheme, "unified", "scroll", false));

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

	if (gitGutterInput?.kind === "modified") {
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
	void ensurePierreThemeRegistered().then(() => {
		render();
	});
});

onDestroy(() => {
	cleanup();
});
</script>

<div class="h-full overflow-auto" bind:this={containerRef}></div>
