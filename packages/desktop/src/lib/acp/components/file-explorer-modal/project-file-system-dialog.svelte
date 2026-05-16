<script lang="ts">
import { Button } from "$lib/components/ui/button/index.js";
import WorkspaceDialogFrame from "$lib/components/ui/workspace-dialog-frame.svelte";
import type {
	FileExplorerPreviewResponse,
	FileGitStatus,
	PreviewKind,
} from "$lib/services/converted-session-types.js";
import { tauriClient } from "$lib/utils/tauri-client.js";
import { DiffPill, ProjectLetterBadge } from "@acepe/ui";
import { Colors } from "@acepe/ui/colors";
import { FolderOpen } from "phosphor-svelte";
import { onMount } from "svelte";
import { SvelteSet } from "svelte/reactivity";
import FileIcon from "../file-list/file-icon.svelte";
import { createFileTree, flattenFileTree } from "../file-list/file-list-logic.js";
import type { FileTreeNode } from "../file-list/file-list-types.js";
import FileExplorerPreviewPane from "./file-explorer-preview-pane.svelte";

interface Props {
	open: boolean;
	projectPath: string;
	projectName: string;
	projectColor?: string;
	projectIconSrc?: string | null;
	onClose: () => void;
	onOpenFile?: (projectPath: string, filePath: string) => void;
}

let {
	open,
	projectPath,
	projectName,
	projectColor = Colors.red,
	projectIconSrc = null,
	onClose,
	onOpenFile,
}: Props = $props();

let files = $state<FileTreeNode[]>([]);
let loading = $state(false);
let error = $state<string | null>(null);
let selectedFilePath = $state<string | null>(null);
let preview = $state<FileExplorerPreviewResponse | null>(null);
let previewRequestSeq = 0;
const expandedFolders = new SvelteSet<string>();

const flattenedFiles = $derived(flattenFileTree(files, expandedFolders, projectPath));
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

function findFirstFile(nodes: FileTreeNode[]): FileTreeNode | null {
	for (const node of nodes) {
		if (!node.isDirectory) {
			return node;
		}
		const child = findFirstFile(node.children);
		if (child !== null) {
			return child;
		}
	}
	return null;
}

function expandParents(filePath: string): void {
	const segments = filePath.split("/");
	const parents: string[] = [];
	for (let index = 0; index < segments.length - 1; index += 1) {
		parents.push(segments[index]);
		expandedFolders.add(`${projectPath}:${parents.join("/")}`);
	}
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
			const nextFiles = createFileTree(result.files);
			files = nextFiles;
			loading = false;
			const nextSelected = selectedFilePath ?? findFirstFile(nextFiles)?.path ?? null;
			if (nextSelected !== null) {
				expandParents(nextSelected);
				selectFile(nextSelected);
			}
		},
		(loadError) => {
			error = loadError.message;
			loading = false;
		}
	);
}

function toggleFolder(folderPath: string): void {
	const key = `${projectPath}:${folderPath}`;
	if (expandedFolders.has(key)) {
		expandedFolders.delete(key);
		return;
	}
	expandedFolders.add(key);
}

function selectFile(filePath: string): void {
	selectedFilePath = filePath;
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

function getNodeGitStatus(node: FileTreeNode): FileGitStatus | null {
	const status = node.gitStatus;
	if (!status) return null;
	return {
		path: node.path,
		status: status.status,
		insertions: status.insertions,
		deletions: status.deletions,
	};
}

function getNodeColor(node: FileTreeNode): string | null {
	if (node.isDirectory) {
		return node.hasModifiedDescendants ? "#E2BF8D" : null;
	}
	const status = node.gitStatus?.status;
	if (status === "M") return "#E2BF8D";
	if (status === "A" || status === "?") return "var(--success)";
	if (status === "D") return "#FF5D5A";
	if (status === "R") return "#E2BF8D";
	return null;
}

onMount(() => {
	loadProjectFiles(true);
});
</script>

<WorkspaceDialogFrame
	{open}
	title={`File system for ${projectName}`}
	closeLabel="Close file system"
	onOpenChange={(nextOpen) => {
		if (!nextOpen) {
			onClose();
		}
	}}
>
	<div class="flex h-full min-h-0 w-full overflow-hidden rounded-md border border-border/60 bg-background shadow-[0_30px_80px_rgba(0,0,0,0.5)]">
		<div class="flex w-80 shrink-0 flex-col border-r border-border/60 bg-card/80">
			<div class="flex h-9 shrink-0 items-center gap-2 border-b border-border/60 pr-2.5">
				<div class="inline-flex h-9 w-9 shrink-0 items-center justify-center border-r border-border/60">
					<ProjectLetterBadge
						name={projectName}
						color={projectColor}
						iconSrc={projectIconSrc}
						size={28}
						fontSize={15}
						class="!rounded-none"
					/>
				</div>
				<div class="min-w-0 flex-1 truncate text-xs font-medium">{projectName}</div>
				{#if loading && files.length > 0}
					<span class="text-[10px] text-muted-foreground">Refreshing</span>
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
						onclick={() => onOpenFile(projectPath, selectedFilePath)}
					>
						Open
					</Button>
				{/if}
			</div>
			{#if preview === null && selectedFilePath !== null}
				<div class="flex-1 bg-background"></div>
			{:else}
				<FileExplorerPreviewPane {preview} preferPlainText />
			{/if}
		</div>
	</div>
</WorkspaceDialogFrame>
