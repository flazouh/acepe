import type { FileGitStatus } from "$lib/services/converted-session-types.js";
import { getRelativeFilePath } from "../../utils/file-utils.js";

export type FilePanelGitStatus = Pick<FileGitStatus, "status" | "insertions" | "deletions">;

export const EMPTY_FILE_PANEL_GIT_STATS = {
	added: 0,
	removed: 0,
} as const;

function normalizeGitStatusLookupKey(path: string): string {
	const normalizedSlashes = path.replaceAll("\\", "/");
	if (normalizedSlashes.startsWith("./")) {
		return normalizedSlashes.slice(2);
	}
	if (normalizedSlashes.startsWith("/")) {
		return normalizedSlashes.slice(1);
	}
	return normalizedSlashes;
}

function getStatusByLikelyKey(
	statusMap: ReadonlyMap<string, FileGitStatus>,
	path: string | null
): FileGitStatus | null {
	if (!path) {
		return null;
	}

	const exactStatus = statusMap.get(path);
	if (exactStatus) {
		return exactStatus;
	}

	const normalizedPath = normalizeGitStatusLookupKey(path);
	if (normalizedPath === path) {
		return null;
	}

	return statusMap.get(normalizedPath) ?? null;
}

export function resolveFilePanelGitStatus(
	statusMap: ReadonlyMap<string, FileGitStatus>,
	filePath: string,
	projectPath: string
): FileGitStatus | null {
	const relativeFilePath = getRelativeFilePath(filePath, projectPath);
	return getStatusByLikelyKey(statusMap, relativeFilePath) ?? getStatusByLikelyKey(statusMap, filePath);
}

export function toFilePanelGitStatus(
	status: FileGitStatus | null
): FilePanelGitStatus | null {
	if (status === null) {
		return null;
	}

	return {
		status: status.status,
		insertions: status.insertions,
		deletions: status.deletions,
	};
}

export function getFilePanelGitStats(
	statusMap: ReadonlyMap<string, FileGitStatus>,
	filePath: string,
	projectPath: string
): { added: number; removed: number } {
	const fileStatus = resolveFilePanelGitStatus(statusMap, filePath, projectPath);
	return {
		added: fileStatus?.insertions ?? EMPTY_FILE_PANEL_GIT_STATS.added,
		removed: fileStatus?.deletions ?? EMPTY_FILE_PANEL_GIT_STATS.removed,
	};
}
