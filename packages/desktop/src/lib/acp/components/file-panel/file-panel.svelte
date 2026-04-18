<script lang="ts">
import { FilePanelLayout } from "@acepe/ui/file-panel";
import type { GitGutterInput } from "$lib/components/ui/codemirror-editor/git-gutter.js";
import {
	CodeMirrorEditor,
	getLanguageFromFilename,
} from "$lib/components/ui/codemirror-editor/index.js";
import { FileReadError } from "$lib/components/ui/file-read-error/index.js";
import { Skeleton } from "$lib/components/ui/skeleton/index.js";
import { fileContentCache } from "../../services/file-content-cache.svelte.js";
import { gitStatusCache } from "../../services/git-status-cache.svelte.js";
import { findGitStatusForFile, getRelativeFilePath } from "../../utils/file-utils.js";
import { createLogger } from "../../utils/logger.js";
import FilePanelCsvView from "./file-panel-csv-view.svelte";
import { type FilePanelDisplayMode, getFilePanelDisplayOptions } from "./file-panel-format.js";
import FilePanelHeader from "./file-panel-header.svelte";
import { getRawEditorConfig } from "./file-panel-raw-editor-mode.js";
import FilePanelReadView from "./file-panel-read-view.svelte";
import FilePanelRenderedView from "./file-panel-rendered-view.svelte";
import { getFilePanelShellClass } from "./file-panel-shell-class.js";
import FilePanelStructuredView from "./file-panel-structured-view.svelte";

interface Props {
	panelId: string;
	filePath: string;
	projectPath: string;
	projectName: string;
	projectColor: string | undefined;
	projectIconSrc?: string | null;
	width: number;
	isFullscreenEmbedded?: boolean;
	hideProjectBadge?: boolean;
	hideHeader?: boolean;
	compactHeader?: boolean;
	useReadOnlyPierreView?: boolean;
	flatStyle?: boolean;
	onClose: () => void;
	onResize: (panelId: string, delta: number) => void;
}

let {
	panelId,
	filePath,
	projectPath,
	projectName,
	projectColor,
	projectIconSrc = null,
	width,
	isFullscreenEmbedded = false,
	hideProjectBadge = false,
	hideHeader = false,
	compactHeader = false,
	useReadOnlyPierreView = false,
	flatStyle = false,
	onClose,
	onResize,
}: Props = $props();

const logger = createLogger({ id: "file-panel", name: "FilePanel" });

// File content state
let content = $state<string | null>(null);
let loading = $state(true);
let error = $state<string | null>(null);

// Git status state - full object with insertions/deletions
let gitStatus = $state<{ status: string; insertions: number; deletions: number } | null>(null);

// Git gutter input for CodeMirror diff markers
let gitGutterInput = $state<GitGutterInput>(null);

// Resize state
let isDragging = $state(false);
let startX = $state(0);

// Extract filename from path
const fileName = $derived(filePath.split("/").pop() ?? filePath);

// Detect language for Monaco editor
const language = $derived(getLanguageFromFilename(filePath));
const displayOptions = $derived(getFilePanelDisplayOptions(filePath));
let displayMode = $state<FilePanelDisplayMode>("raw");
let editorMode = $state<"write" | "read">("read");
let lastDisplayOptionsKey = $state("");
const editorModes = ["write", "read"] as const;

// Width style
const widthStyle = $derived(
	isFullscreenEmbedded
		? "min-width: 0; width: 100%; max-width: 100%;"
		: `min-width: ${width}px; width: ${width}px; max-width: ${width}px;`
);

$effect(() => {
	const currentDisplayOptions = displayOptions;
	const nextKey = `${filePath}:${currentDisplayOptions.defaultMode}:${currentDisplayOptions.availableModes.join(",")}`;

	if (nextKey !== lastDisplayOptionsKey) {
		lastDisplayOptionsKey = nextKey;
		displayMode = currentDisplayOptions.defaultMode;
	}
});

$effect(() => {
	// Compact embedded mode should default to read whenever the viewed file changes.
	void panelId;
	void filePath;
	editorMode = "read";
});

$effect(() => {
	logger.info("File panel display mode state", {
		filePath,
		formatKind: displayOptions.formatKind,
		availableModes: displayOptions.availableModes,
		displayMode,
		willRenderCodeMirror: displayMode === "raw",
	});
});

// Load file content
$effect(() => {
	// Capture current values for stale closure prevention
	const currentFilePath = filePath;
	const currentProjectPath = projectPath;

	loading = true;
	error = null;

	fileContentCache.getFileContent(currentFilePath, currentProjectPath).match(
		(fileContent) => {
			// Only update if still relevant (file hasn't changed)
			if (filePath === currentFilePath && projectPath === currentProjectPath) {
				content = fileContent;
				loading = false;
			}
		},
		(err) => {
			// Only update if still relevant (file hasn't changed)
			if (filePath === currentFilePath && projectPath === currentProjectPath) {
				error = err.message;
				loading = false;
			}
		}
	);
});

// Load git status for the file
$effect(() => {
	const currentFilePath = filePath;
	const currentProjectPath = projectPath;

	// Reset git status when file changes
	gitStatus = null;
	logger.info("Loading git status for file panel", {
		currentFilePath,
		currentProjectPath,
	});

	gitStatusCache.getProjectGitStatusMap(currentProjectPath).match(
		(statusMap) => {
			// Find status for this specific file
			if (filePath === currentFilePath && projectPath === currentProjectPath) {
				const relativeFilePath = getRelativeFilePath(currentFilePath, currentProjectPath);
				const exactFileStatus = relativeFilePath ? (statusMap.get(relativeFilePath) ?? null) : null;
				const fileStatus =
					exactFileStatus ??
					findGitStatusForFile(Array.from(statusMap.values()), currentFilePath, currentProjectPath);
				logger.info("Git status lookup result", {
					currentFilePath,
					currentProjectPath,
					statusCount: statusMap.size,
					fileStatusPath: fileStatus?.path ?? null,
					fileStatusCode: fileStatus?.status ?? null,
					insertions: fileStatus?.insertions ?? null,
					deletions: fileStatus?.deletions ?? null,
				});
				gitStatus = fileStatus
					? {
							status: fileStatus.status,
							insertions: fileStatus.insertions,
							deletions: fileStatus.deletions,
						}
					: null;
			}
		},
		(error) => {
			// Silently ignore git status errors - file might not be in a git repo
			if (filePath === currentFilePath && projectPath === currentProjectPath) {
				logger.info("Git status fetch failed", {
					currentFilePath,
					currentProjectPath,
					error: String(error),
				});
				gitStatus = null;
			}
		}
	);
});

// Compute git gutter input from git status
$effect(() => {
	const currentFilePath = filePath;
	const currentProjectPath = projectPath;
	const currentGitStatus = gitStatus;
	const currentContent = content;

	// Need both content and git status to show gutter
	if (currentContent === null || !currentGitStatus) {
		logger.info("Skipping git gutter (missing content or git status)", {
			currentFilePath,
			currentProjectPath,
			hasContent: currentContent !== null,
			hasGitStatus: Boolean(currentGitStatus),
		});
		gitGutterInput = null;
		return;
	}

	const status = currentGitStatus.status;
	logger.info("Computing git gutter input", {
		currentFilePath,
		currentProjectPath,
		status,
		insertions: currentGitStatus.insertions,
		deletions: currentGitStatus.deletions,
	});

	if (status === "A" || status === "?" || status === "??") {
		// New/untracked file — all lines are additions
		logger.info("Using new-file gutter mode", { currentFilePath, status });
		gitGutterInput = { kind: "new-file" };
		return;
	}

	if (status === "M" || status === "MM") {
		// Modified file — fetch old content from HEAD
		logger.info("Fetching file diff for modified gutter mode", {
			currentFilePath,
			currentProjectPath,
		});
		fileContentCache.getFileDiff(currentFilePath, currentProjectPath).match(
			(diff) => {
				if (filePath === currentFilePath && projectPath === currentProjectPath) {
					logger.info("File diff loaded for gutter", {
						currentFilePath,
						currentProjectPath,
						hasOldContent: diff.oldContent !== null,
						oldLength: diff.oldContent?.length ?? 0,
						newLength: diff.newContent.length,
					});
					gitGutterInput = { kind: "modified", oldContent: diff.oldContent ?? "" };
				}
			},
			(error) => {
				if (filePath === currentFilePath && projectPath === currentProjectPath) {
					logger.info("File diff fetch failed for gutter", {
						currentFilePath,
						currentProjectPath,
						error: String(error),
					});
					gitGutterInput = null;
				}
			}
		);
		return;
	}

	logger.info("No gutter mode for git status", { currentFilePath, status });
	gitGutterInput = null;
});

function handlePointerDown(e: PointerEvent) {
	isDragging = true;
	startX = e.clientX;
	(e.target as HTMLElement).setPointerCapture(e.pointerId);
}

function handlePointerMove(e: PointerEvent) {
	if (!isDragging) return;
	const delta = e.clientX - startX;
	startX = e.clientX;
	onResize(panelId, delta);
}

function handlePointerUp() {
	isDragging = false;
}

function handleDisplayModeChange(nextMode: FilePanelDisplayMode): void {
	displayMode = nextMode;
}

function handleEditorModeChange(nextMode: "write" | "read"): void {
	editorMode = nextMode;
}

const shellClass = $derived(
	getFilePanelShellClass({
		flatStyle,
		isDragging,
	})
);
</script>

<div class={shellClass} style={widthStyle}>
	<FilePanelLayout {loading} {error} hasContent={content !== null}>
		{#snippet header()}
			{#if !hideHeader}
				<FilePanelHeader
					{fileName}
					{filePath}
					{projectPath}
					{projectName}
					{projectColor}
					{projectIconSrc}
					{content}
					{gitStatus}
					compact={compactHeader}
					{hideProjectBadge}
					displayModes={displayOptions.availableModes}
					activeDisplayMode={displayMode}
					onDisplayModeChange={handleDisplayModeChange}
					{editorModes}
					activeEditorMode={editorMode}
					onEditorModeChange={displayMode === "raw" && !useReadOnlyPierreView
						? handleEditorModeChange
						: undefined}
					{onClose}
				/>
			{/if}
		{/snippet}

		{#snippet loadingSkeleton()}
			<div class="flex flex-col gap-2 p-4">
				{#each Array.from({ length: 10 }, (_, i) => i) as index (index)}
					<Skeleton class="h-4 w-full" />
				{/each}
			</div>
		{/snippet}

		{#snippet errorDisplay()}
			<div class="p-4">
				<FileReadError message={error ?? ""} path={filePath} />
			</div>
		{/snippet}

		{#snippet fileViewer()}
			{@const fileContent = content!}
			{#if displayMode === "rendered"}
				<div class="h-full overflow-auto p-4">
					<FilePanelRenderedView
						content={fileContent}
						{projectPath}
						formatKind={displayOptions.formatKind}
					/>
				</div>
			{:else if displayMode === "structured"}
				<div class="h-full overflow-hidden">
					<FilePanelStructuredView
						content={fileContent}
						{filePath}
						formatKind={displayOptions.formatKind}
					/>
				</div>
			{:else if displayMode === "table"}
				<div class="h-full overflow-auto p-3">
					<FilePanelCsvView content={fileContent} formatKind={displayOptions.formatKind} />
				</div>
			{:else if useReadOnlyPierreView}
				<FilePanelReadView {filePath} {projectPath} content={fileContent} {gitGutterInput} />
			{:else}
				{@const rawEditorConfig = getRawEditorConfig(editorMode)}
				<CodeMirrorEditor
					value={fileContent}
					{language}
					readonly={rawEditorConfig.readonly}
					{gitGutterInput}
				/>
			{/if}
		{/snippet}

		{#snippet emptyDisplay()}
			<div class="p-4 text-sm text-muted-foreground">
				{"No files found"}
			</div>
		{/snippet}
	</FilePanelLayout>

	{#if !isFullscreenEmbedded}
		<!-- Resize Edge -->
		<div
			class="absolute top-0 right-0 w-1 h-full cursor-ew-resize hover:bg-primary/20 active:bg-primary/40 transition-colors"
			role="separator"
			aria-orientation="vertical"
			tabindex="-1"
			onpointerdown={handlePointerDown}
			onpointermove={handlePointerMove}
			onpointerup={handlePointerUp}
			onpointercancel={handlePointerUp}
		></div>
	{/if}
</div>
