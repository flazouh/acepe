<script lang="ts">
import { Button } from "$lib/components/ui/button/index.js";
import DialogFrame from "$lib/components/ui/dialog-frame.svelte";
import ProjectSelector from "../project-selector.svelte";
import type { Project } from "$lib/acp/logic/project-manager.svelte.js";
import type {
	FileExplorerPreviewResponse,
	PreviewKind,
} from "$lib/services/converted-session-types.js";
import { tauriClient } from "$lib/utils/tauri-client.js";
import { DiffPill } from "@acepe/ui";
import { Colors } from "@acepe/ui/colors";
import { onMount } from "svelte";
import FileExplorerPreviewPane from "./file-explorer-preview-pane.svelte";
import { createProjectFileSystemTreeModel } from "./project-file-system-tree-model.js";

const FILE_DIALOG_TREE_UNSAFE_CSS = `
	button[data-type='item'] {
		font-size: 12px;
		line-height: 18px;
		min-height: 24px;
	}

	button[data-type='item'][data-item-selected] {
		border-left: 2px solid hsl(var(--primary));
	}
`;

interface Props {
	open: boolean;
	projectPath: string;
	projectName: string;
	projectColor?: string;
	projectIconSrc?: string | null;
	/** Projects available in the top-left picker (omit to hide the picker). */
	recentProjects?: readonly Project[];
	onProjectChange?: (project: Project) => void;
	onClose: () => void;
	onOpenFile?: (projectPath: string, filePath: string) => void;
}

let {
	open,
	projectPath,
	projectName,
	projectColor = Colors.red,
	projectIconSrc = null,
	recentProjects = [],
	onProjectChange,
	onClose,
	onOpenFile,
}: Props = $props();

const selectedProject = $derived(
	recentProjects.find((project) => project.path === projectPath) ?? null
);

let files = $state<FileTreeNode[]>([]);
let loading = $state(false);
let error = $state<string | null>(null);
let selectedFilePathOverride = $state<string | null>(null);
const selectedFilePath = $derived(selectedFilePathOverride ?? initialFilePath);
let preview = $state<FileExplorerPreviewResponse | null>(null);
let previewRequestSeq = 0;
function getPreviewFallbackFileName(filePath: string): string {
	const segments = filePath.split("/");
	const fileName = segments[segments.length - 1];
	return fileName ? fileName : filePath;
}

function fallbackPreview(filePath: string, reason: string): FileExplorerPreviewResponse {
	return {
		kind: "fallback",
		file_path: filePath,
		file_name: getPreviewFallbackFileName(filePath),
		reason,
		size_bytes: null,
		git_status: null,
		preview_kind: "unsupported" satisfies PreviewKind,
	};
}

function handleOpenSelectedFile(): void {
	if (selectedFilePath === null || onOpenFile === undefined) {
		return;
	}

	onOpenFile(projectPath, selectedFilePath);
}

function loadProjectFiles(refresh: boolean): void {
	loading = true;
	error = null;
	const load = refresh
		? tauriClient.fileIndex
				.invalidateProjectFiles(projectPath)
				.andThen(() => tauriClient.fileIndex.getProjectFiles(projectPath))
		: tauriClient.fileIndex.getProjectFiles(projectPath);

	void load.match(
		(result) => {
			const nextTreeModel = createProjectFileSystemTreeModel(result.files);
			treeModel = nextTreeModel;
			loading = false;
			const nextSelected = selectedFilePath ?? nextTreeModel.firstFilePath;
			if (nextSelected !== null) {
				selectFile(nextSelected);
			}
		},
		(loadError) => {
			error = loadError.message;
			loading = false;
		}
	);
}

function handleTreeSelectionChange(selectedPaths: readonly string[]): void {
	const selectedPath = selectedPaths[selectedPaths.length - 1];
	if (!selectedPath) {
		return;
	}

	if (treeModel.filesByPath.has(selectedPath)) {
		selectFile(selectedPath);
	}
}

function selectFile(filePath: string): void {
	selectedFilePathOverride = filePath;
	preview = null;
	const seq = previewRequestSeq + 1;
	previewRequestSeq = seq;
	void tauriClient.fileIndex.getFileExplorerPreview(projectPath, filePath).match(
		(result) => {
			if (seq !== previewRequestSeq) return;
			preview = result;
		},
		(previewError) => {
			if (seq !== previewRequestSeq) return;
			preview = fallbackPreview(filePath, previewError.message);
		}
	);
}

onMount(() => {
	loadProjectFiles(true);
});
</script>

<DialogFrame
	{open}
	title={title ?? `File system for ${projectName}`}
	closeLabel="Close file system"
	hideHeader={true}
	onOpenChange={(nextOpen) => {
		if (!nextOpen) {
			onClose();
		}
	}}
>
	{#snippet topLeft()}
		{#if onProjectChange}
			<ProjectSelector
				selectedProject={selectedProject}
				recentProjects={recentProjects}
				onProjectChange={onProjectChange}
				showLabel
			/>
		{/if}
	{/snippet}
	<div class="flex h-full min-h-0 w-full overflow-hidden">
		<div class="flex w-72 shrink-0 flex-col border-r border-border/50 bg-card/40">
			<div class="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border/50 px-2.5">
				<span class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
					Files
				</span>
				{#if loading && files.length > 0}
					<span class="text-[10px] text-muted-foreground">Refreshing…</span>
				{/if}
			</div>
			<div class="min-h-0 flex-1 overflow-auto p-1">
				{#if loading && files.length === 0}
					<div class="px-2 py-2 text-xs text-muted-foreground">Loading files...</div>
				{:else if error !== null}
					<div class="px-2 py-2 text-xs text-destructive">{error}</div>
				{:else if flattenedFiles.length === 0}
					<div class="px-2 py-2 text-xs text-muted-foreground">No files found</div>
				{:else}
					<div class="flex flex-col gap-0.5">
						{#each flattenedFiles as { node } (`${projectPath}:${node.path}`)}
							{@const nodeGitStatus = getNodeGitStatus(node)}
							<button
								type="button"
								class="group flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-xs transition-colors hover:bg-muted/40 {selectedFilePath === node.path
									? 'bg-accent text-foreground'
									: 'text-muted-foreground'}"
								style="padding-left: {node.depth * 12 + 8}px"
								aria-expanded={node.isDirectory
									? expandedFolders.has(`${projectPath}:${node.path}`)
									: undefined}
								onclick={() => {
									if (node.isDirectory) {
										toggleFolder(node.path);
									} else {
										selectFile(node.path);
									}
								}}
							>
								{#if node.isDirectory}
									<span class="flex size-4 shrink-0 items-center justify-center">
										<FolderOpen
											class="size-3.5"
											weight={expandedFolders.has(`${projectPath}:${node.path}`)
												? "fill"
												: "regular"}
										/>
									</span>
								{:else}
									<FileIcon
										extension={node.extension}
										isDirectory={false}
										isExpanded={false}
										class="size-4 shrink-0"
									/>
								{/if}
								<span class="min-w-0 flex-1 truncate" style:color={getNodeColor(node)}>
									{node.name}
								</span>
								{#if nodeGitStatus && (nodeGitStatus.insertions > 0 || nodeGitStatus.deletions > 0)}
									<DiffPill
										insertions={nodeGitStatus.insertions}
										deletions={nodeGitStatus.deletions}
										variant="plain"
										class="shrink-0"
									/>
								{/if}
							</button>
						{/each}
					</div>
					{#if loading && treeModel.paths.length > 0}
						<span class="shrink-0 text-[10px] text-muted-foreground">Refreshing…</span>
					{/if}
				</div>
				<div class="min-h-0 flex-1 overflow-auto p-1">
					{#if loading && treeModel.paths.length === 0}
						<div class="px-2 py-2 text-xs text-muted-foreground">Loading files...</div>
					{:else if error !== null}
						<div class="px-2 py-2 text-xs text-destructive">{error}</div>
					{:else if treeModel.paths.length === 0}
						<div class="px-2 py-2 text-xs text-muted-foreground">No files found</div>
					{:else}
						<PierreFileTree
							paths={treeModel.paths}
							gitStatus={treeModel.gitStatus}
							selectedPath={selectedFilePath}
							revealPath={selectedFilePath}
							onSelectionChange={handleTreeSelectionChange}
							rowDecoration={(item) => treeModel.decorationsByPath.get(item.path) ?? null}
							flattenEmptyDirectories={true}
							unsafeCSS={FILE_DIALOG_TREE_UNSAFE_CSS}
							class="h-full bg-transparent"
							testId="project-file-system-tree"
							ariaLabel="Project files"
						/>
					{/if}
				</div>
			</div>
			<div class="flex min-w-0 flex-1 flex-col">
				<div class="flex h-9 shrink-0 items-center gap-2 border-b border-border/60 px-3">
					<div class="min-w-0 flex-1 truncate text-xs text-muted-foreground">
						{selectedFilePath ?? "Select a file"}
					</div>
					{#if selectedFilePath !== null && onOpenFile}
						<Button
							type="button"
							variant="outline"
							size="sm"
							class="h-6 px-2 text-[11px]"
							onclick={handleOpenSelectedFile}
						>
							Open
						</Button>
					{/if}
					{@render closeControl()}
				</div>
				{#if preview === null && selectedFilePath !== null}
					<div class="flex-1 bg-background"></div>
				{:else}
					<FileExplorerPreviewPane {preview} preferPlainText />
				{/if}
			</div>
		</div>
	{/snippet}
</DialogFrame>
