import type { IndexedFile } from "$lib/services/converted-session-types.js";

type ProjectFileSystemPierreStatus =
	| "added"
	| "deleted"
	| "ignored"
	| "modified"
	| "renamed"
	| "untracked";

interface ProjectFileSystemGitStatusEntry {
	path: string;
	status: ProjectFileSystemPierreStatus;
}

interface ProjectFileSystemRowDecoration {
	text: string;
	title?: string;
}

interface AggregateDiff {
	insertions: number;
	deletions: number;
}

export interface ProjectFileSystemTreeModel {
	paths: readonly string[];
	gitStatus: readonly ProjectFileSystemGitStatusEntry[];
	filesByPath: ReadonlyMap<string, IndexedFile>;
	decorationsByPath: ReadonlyMap<string, ProjectFileSystemRowDecoration>;
	firstFilePath: string | null;
}

export function createProjectFileSystemTreeModel(
	files: readonly IndexedFile[]
): ProjectFileSystemTreeModel {
	const paths: string[] = [];
	const gitStatus: ProjectFileSystemGitStatusEntry[] = [];
	const filesByPath = new Map<string, IndexedFile>();
	const decorationsByPath = new Map<string, ProjectFileSystemRowDecoration>();
	const aggregateByDirectoryPath = new Map<string, AggregateDiff>();

	for (const file of files) {
		paths.push(file.path);
		filesByPath.set(file.path, file);

		if (!file.gitStatus) {
			continue;
		}

		const status = mapFileIndexStatusToPierreStatus(file.gitStatus.status);
		if (status) {
			gitStatus.push({
				path: file.path,
				status,
			});
		}

		addDecoration(decorationsByPath, file.path, file.gitStatus.insertions, file.gitStatus.deletions);
		addAggregates(aggregateByDirectoryPath, file.path, {
			insertions: file.gitStatus.insertions,
			deletions: file.gitStatus.deletions,
		});
	}

	for (const entry of aggregateByDirectoryPath.entries()) {
		const directoryPath = entry[0];
		const aggregate = entry[1];
		gitStatus.push({
			path: directoryPath,
			status: "modified",
		});
		addDecoration(decorationsByPath, directoryPath, aggregate.insertions, aggregate.deletions);
	}

	return {
		paths,
		gitStatus,
		filesByPath,
		decorationsByPath,
		firstFilePath: files[0]?.path ?? null,
	};
}

export function mapFileIndexStatusToPierreStatus(
	status: string
): ProjectFileSystemPierreStatus | null {
	switch (status) {
		case "M":
			return "modified";
		case "A":
			return "added";
		case "?":
			return "untracked";
		case "D":
			return "deleted";
		case "R":
			return "renamed";
		default:
			return null;
	}
}

function addAggregates(
	aggregateByDirectoryPath: Map<string, AggregateDiff>,
	filePath: string,
	diff: AggregateDiff
): void {
	const segments = filePath.split("/");
	const parents: string[] = [];

	for (let index = 0; index < segments.length - 1; index += 1) {
		parents.push(segments[index]);
		const parentPath = parents.join("/");
		const previous = aggregateByDirectoryPath.get(parentPath);

		if (!previous) {
			aggregateByDirectoryPath.set(parentPath, {
				insertions: diff.insertions,
				deletions: diff.deletions,
			});
			continue;
		}

		previous.insertions += diff.insertions;
		previous.deletions += diff.deletions;
	}
}

function addDecoration(
	decorationsByPath: Map<string, ProjectFileSystemRowDecoration>,
	path: string,
	insertions: number,
	deletions: number
): void {
	if (insertions === 0 && deletions === 0) {
		return;
	}

	const additionLabel = insertions === 1 ? "addition" : "additions";
	const deletionLabel = deletions === 1 ? "deletion" : "deletions";
	decorationsByPath.set(path, {
		text: `+${insertions} -${deletions}`,
		title: `${path}: ${insertions} ${additionLabel}, ${deletions} ${deletionLabel}`,
	});
}
