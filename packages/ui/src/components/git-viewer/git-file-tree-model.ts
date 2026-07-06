import type { FileTreeRowDecoration, GitStatus, GitStatusEntry } from "@pierre/trees";

import type { GitViewerFile } from "./types.js";

export interface GitFileTreeModel {
	paths: readonly string[];
	gitStatus: readonly GitStatusEntry[];
	filesByPath: ReadonlyMap<string, GitViewerFile>;
}

export function createGitFileTreeModel(files: readonly GitViewerFile[]): GitFileTreeModel {
	const paths: string[] = [];
	const gitStatus: GitStatusEntry[] = [];
	const filesByPath = new Map<string, GitViewerFile>();

	for (const file of files) {
		paths.push(file.path);
		filesByPath.set(file.path, file);
		gitStatus.push({
			path: file.path,
			status: mapGitViewerStatusToPierreStatus(file.status),
		});
	}

	return {
		paths,
		gitStatus,
		filesByPath,
	};
}

export function mapGitViewerStatusToPierreStatus(status: GitViewerFile["status"]): GitStatus {
	switch (status) {
		case "added":
			return "added";
		case "deleted":
			return "deleted";
		case "renamed":
			return "renamed";
		case "modified":
			return "modified";
	}
}

export function createGitFileTreeDiffDecoration(
	file: GitViewerFile
): FileTreeRowDecoration {
	const text = `+${file.additions} -${file.deletions}`;
	const additionLabel = file.additions === 1 ? "addition" : "additions";
	const deletionLabel = file.deletions === 1 ? "deletion" : "deletions";

	return {
		text,
		title: `${file.path}: ${file.additions} ${additionLabel}, ${file.deletions} ${deletionLabel}`,
	};
}
