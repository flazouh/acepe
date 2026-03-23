export { default as GitViewer } from "./git-viewer.svelte";
export { default as GitCommitHeader } from "./git-commit-header.svelte";
export { default as GitPrHeader } from "./git-pr-header.svelte";
export { default as GitFileTree } from "./git-file-tree.svelte";
export { default as GitDiffViewToggle } from "./git-diff-view-toggle.svelte";

export type { GitViewerFile, GitCommitData, GitPrData } from "./types.js";
export type { FileTreeNode } from "./file-tree-logic.js";
export { buildFileTree, flattenFileTree, compactSingleChildDirs } from "./file-tree-logic.js";
