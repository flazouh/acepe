/**
 * Pure functions for file list operations.
 */

import type { IndexedFile } from "$lib/services/converted-session-types.js";

import type { Project } from "../../logic/project-manager.svelte.js";
import type { FileGroup, FileTreeNode } from "./file-list-types.js";

/**
 * Create a file tree from a flat list of indexed files.
 */
export function createFileTree(files: IndexedFile[]): FileTreeNode[] {
	const root: Map<string, FileTreeNode> = new Map();

	for (const file of files) {
		const parts = file.path.split("/");
		let currentLevel = root;
		let currentPath = "";

		for (let i = 0; i < parts.length; i++) {
			const part = parts[i];
			const isLast = i === parts.length - 1;
			currentPath = currentPath ? `${currentPath}/${part}` : part;

			if (!currentLevel.has(part)) {
				const node: FileTreeNode = {
					name: part,
					path: currentPath,
					isDirectory: !isLast,
					children: [],
					extension: isLast ? file.extension : "",
					depth: i,
					gitStatus: isLast ? (file.gitStatus ?? null) : null,
				};

				if (i === 0) {
					root.set(part, node);
				} else {
					// Find parent and add as child
					const parentPath = parts.slice(0, i).join("/");
					const parent = findNodeByPath(root, parentPath);
					if (parent) {
						parent.children.push(node);
					}
				}
			}

			if (!isLast) {
				// Navigate to children map for next iteration
				const node = i === 0 ? root.get(part) : findNodeByPath(root, currentPath);
				if (node) {
					currentLevel = new Map(node.children.map((c) => [c.name, c]));
				}
			}
		}
	}

	// Convert root map to sorted array
	const result = Array.from(root.values());
	sortFileTree(result);
	propagateGitStatus(result);
	return result;
}

/**
 * Find a node by its path in the tree.
 */
function findNodeByPath(root: Map<string, FileTreeNode>, path: string): FileTreeNode | null {
	const parts = path.split("/");
	let current: FileTreeNode | undefined;

	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		if (i === 0) {
			current = root.get(part);
		} else if (current) {
			current = current.children.find((c) => c.name === part);
		}
		if (!current) return null;
	}

	return current ?? null;
}

/**
 * Sort file tree nodes: directories first, then alphabetically.
 */
function sortFileTree(nodes: FileTreeNode[]): void {
	nodes.sort((a, b) => {
		// Directories first
		if (a.isDirectory && !b.isDirectory) return -1;
		if (!a.isDirectory && b.isDirectory) return 1;
		// Then alphabetically
		return a.name.localeCompare(b.name);
	});

	// Recursively sort children
	for (const node of nodes) {
		if (node.children.length > 0) {
			sortFileTree(node.children);
		}
	}
}

/**
 * Propagate git status up to parent directories.
 * Sets hasModifiedDescendants and aggregated gitStatus on directories.
 */
function propagateGitStatus(nodes: FileTreeNode[]): {
	hasModified: boolean;
	insertions: number;
	deletions: number;
} {
	let hasModified = false;
	let totalInsertions = 0;
	let totalDeletions = 0;

	for (const node of nodes) {
		if (node.isDirectory) {
			const result = propagateGitStatus(node.children);
			node.hasModifiedDescendants = result.hasModified;
			if (result.hasModified) {
				hasModified = true;
				totalInsertions += result.insertions;
				totalDeletions += result.deletions;
				node.gitStatus = {
					status: "M",
					insertions: result.insertions,
					deletions: result.deletions,
				};
			}
		} else if (node.gitStatus) {
			hasModified = true;
			totalInsertions += node.gitStatus.insertions;
			totalDeletions += node.gitStatus.deletions;
		}
	}

	return { hasModified, insertions: totalInsertions, deletions: totalDeletions };
}

/**
 * Create file groups from projects.
 */
export function createFileGroups(
	projects: readonly Project[],
	filesByProject: Map<string, FileTreeNode[]>,
	loadingProjects: Set<string>,
	errorByProject: Map<string, string>
): FileGroup[] {
	return projects.map((project) => ({
		projectPath: project.path,
		projectName: project.name,
		projectColor: project.color,
		projectIconSrc: project.iconPath ?? null,
		files: filesByProject.get(project.path) ?? [],
		totalFiles: countFilesInTree(filesByProject.get(project.path) ?? []),
		loading: loadingProjects.has(project.path),
		error: errorByProject.get(project.path) ?? null,
	}));
}

/**
 * Count total files in a file tree (excluding directories).
 */
function countFilesInTree(nodes: FileTreeNode[]): number {
	let count = 0;
	for (const node of nodes) {
		if (node.isDirectory) {
			count += countFilesInTree(node.children);
		} else {
			count += 1;
		}
	}
	return count;
}

/**
 * Flatten a file tree to a list of visible nodes based on expanded folders.
 */
export function flattenFileTree(
	nodes: FileTreeNode[],
	expandedFolders: Set<string>,
	projectPath: string
): Array<{ node: FileTreeNode; projectPath: string }> {
	const result: Array<{ node: FileTreeNode; projectPath: string }> = [];

	function traverse(nodeList: FileTreeNode[]): void {
		for (const node of nodeList) {
			result.push({ node, projectPath });

			if (node.isDirectory && expandedFolders.has(`${projectPath}:${node.path}`)) {
				traverse(node.children);
			}
		}
	}

	traverse(nodes);
	return result;
}
