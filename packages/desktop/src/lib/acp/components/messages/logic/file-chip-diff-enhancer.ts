import type { ModifiedFilesState } from "$lib/acp/types/modified-files-state.js";
import type { FileGitStatus } from "$lib/services/converted-session-types.js";

export type DiffEnhancementOptions = {
	projectPath?: string;
	gitStatusByPath?: ReadonlyMap<string, FileGitStatus>;
	sessionState?: ModifiedFilesState | null;
};

export type DiffStats = {
	insertions: number;
	deletions: number;
};

export type ProjectFileReference = {
	filePath: string;
	targetLine?: number;
	targetColumn?: number;
};

const FILE_REFERENCE_LOCATION_PATTERN = /^(?<path>.+?):(?<line>\d+)(?::(?<column>\d+))?$/u;

/**
 * Resolves a file path to a project-relative path.
 */
export function normalizeToProjectRelativePath(filePath: string, projectPath: string): string {
	if (filePath.startsWith(`${projectPath}/`)) {
		return filePath.slice(projectPath.length + 1);
	}

	const pathWithoutLeadingSlash = filePath.startsWith("/") ? filePath.slice(1) : filePath;
	const pathSegments = pathWithoutLeadingSlash.split("/");

	for (let prefixLen = pathSegments.length - 1; prefixLen >= 1; prefixLen--) {
		const prefix = pathSegments.slice(0, prefixLen).join("/");
		if (projectPath.endsWith(`/${prefix}`) || projectPath === prefix) {
			return pathSegments.slice(prefixLen).join("/");
		}
	}

	return pathWithoutLeadingSlash;
}

export function parseProjectFileReference(fileReference: string): ProjectFileReference {
	const match = FILE_REFERENCE_LOCATION_PATTERN.exec(fileReference);
	if (!match?.groups?.path || !match.groups.line) {
		return { filePath: fileReference };
	}

	const targetLine = Number.parseInt(match.groups.line, 10);
	const targetColumn =
		match.groups.column === undefined ? undefined : Number.parseInt(match.groups.column, 10);

	if (targetLine < 1 || (targetColumn !== undefined && targetColumn < 1)) {
		return { filePath: fileReference };
	}

	return {
		filePath: match.groups.path,
		targetLine,
		targetColumn,
	};
}

export function resolveProjectFileReference(
	fileReference: string,
	projectPath: string
): ProjectFileReference {
	const parsed = parseProjectFileReference(fileReference);
	return {
		filePath: normalizeToProjectRelativePath(parsed.filePath, projectPath),
		targetLine: parsed.targetLine,
		targetColumn: parsed.targetColumn,
	};
}

function collectCandidatePaths(filePath: string, projectPath?: string): ReadonlyArray<string> {
	const parsed = parseProjectFileReference(filePath);
	const normalizedFilePath = parsed.filePath;
	const candidates = new Set<string>([normalizedFilePath]);

	const trimmed = normalizedFilePath.startsWith("/")
		? normalizedFilePath.slice(1)
		: normalizedFilePath;
	candidates.add(trimmed);

	if (projectPath) {
		const relativePath = normalizeToProjectRelativePath(normalizedFilePath, projectPath);
		candidates.add(relativePath);
		candidates.add(relativePath.startsWith("/") ? relativePath.slice(1) : relativePath);
		candidates.add(`${projectPath}/${relativePath}`);
	}

	return Array.from(candidates);
}

function resolveGitDiffStats(
	filePath: string,
	projectPath: string | undefined,
	gitStatusByPath: ReadonlyMap<string, FileGitStatus> | undefined
): DiffStats | null {
	if (!gitStatusByPath || !projectPath) {
		return null;
	}

	const candidates = collectCandidatePaths(filePath, projectPath);

	for (const candidate of candidates) {
		const status = gitStatusByPath.get(candidate);
		if (!status) {
			continue;
		}

		if (status.insertions === 0 && status.deletions === 0) {
			return null;
		}

		return {
			insertions: status.insertions,
			deletions: status.deletions,
		};
	}

	return null;
}

function resolveSessionDiffStats(
	filePath: string,
	projectPath: string | undefined,
	sessionState: ModifiedFilesState | null | undefined
): DiffStats | null {
	if (!sessionState) {
		return null;
	}

	const candidates = collectCandidatePaths(filePath, projectPath);

	for (const candidate of candidates) {
		const entry = sessionState.byPath.get(candidate);
		if (!entry) {
			continue;
		}

		if (entry.totalAdded === 0 && entry.totalRemoved === 0) {
			return null;
		}

		return {
			insertions: entry.totalAdded,
			deletions: entry.totalRemoved,
		};
	}

	return null;
}

/**
 * Resolves diff stats for a file path from git status or session state.
 * Used when enriching file_path_badge blocks for Svelte component rendering.
 */
export function resolveDiffStatsForFilePath(
	filePath: string,
	{ projectPath, gitStatusByPath, sessionState }: DiffEnhancementOptions
): DiffStats | null {
	const gitStats = resolveGitDiffStats(filePath, projectPath, gitStatusByPath);
	const sessionStats = resolveSessionDiffStats(filePath, projectPath, sessionState);
	return gitStats ?? sessionStats;
}
