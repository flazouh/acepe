<script lang="ts">
import { ResultAsync } from "neverthrow";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { fileIndex } from "$lib/utils/tauri-client/file-index.js";

import type { Project } from "../../logic/project-manager.svelte.js";
import { createFileGroups, createFileTree } from "./file-list-logic.js";
import { FileListState } from "./file-list-state.svelte.js";
import type { FileTreeNode } from "./file-list-types.js";
import FileListUI from "./file-list-ui.svelte";

interface Props {
	projects: readonly Project[];
	onSelectFile: (filePath: string, projectPath: string) => void;
}

let { projects, onSelectFile }: Props = $props();

const uiState = new FileListState();

// File data per project
const filesByProject = new SvelteMap<string, FileTreeNode[]>();
const loadingProjects = new SvelteSet<string>();
const errorByProject = new SvelteMap<string, string>();

// Track loaded projects to avoid re-fetching
const loadedProjects = new SvelteSet<string>();

// Derived file groups
const fileGroups = $derived(
	createFileGroups(projects, filesByProject, loadingProjects, errorByProject)
);

// Load files when projects change
$effect(() => {
	for (const project of projects) {
		if (!loadedProjects.has(project.path) && !loadingProjects.has(project.path)) {
			loadProjectFiles(project.path);
		}
	}
});

function loadProjectFiles(projectPath: string): void {
	// Mark as loading
	loadingProjects.add(projectPath);
	errorByProject.delete(projectPath);

	fileIndex
		.getProjectFiles(projectPath)
		.mapErr((error) => new Error(String(error)))
		.match(
			(result) => {
				// Build file tree
				const tree = createFileTree(result.files);

				// Update state
				filesByProject.set(projectPath, tree);
				loadedProjects.add(projectPath);
				loadingProjects.delete(projectPath);
			},
			(error) => {
				errorByProject.set(projectPath, error.message);
				loadingProjects.delete(projectPath);
			}
		);
}

function handleToggleFolder(projectPath: string, folderPath: string): void {
	uiState.toggleFolder(projectPath, folderPath);
}

function handleToggleProject(projectPath: string): void {
	uiState.toggleProject(projectPath);
}
</script>

<FileListUI
	{fileGroups}
	expandedFolders={uiState.expandedFolders}
	collapsedProjects={uiState.collapsedProjects}
	onToggleFolder={handleToggleFolder}
	onToggleProject={handleToggleProject}
	{onSelectFile}
/>
