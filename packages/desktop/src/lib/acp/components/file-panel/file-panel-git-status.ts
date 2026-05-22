import type { FileGitStatus } from "$lib/services/converted-session-types.js";
import { findGitStatusForFile, getRelativeFilePath } from "../../utils/file-utils.js";

export type FilePanelGitStatus = Pick<FileGitStatus, "status" | "insertions" | "deletions">;

export const EMPTY_FILE_PANEL_GIT_STATS = {
	added: 0,
	removed: 0,
} as const;

export function resolveFilePanelGitStatus(
	statusMap: ReadonlyMap<string, FileGitStatus>,
	filePath: string,
	projectPath: string
): FileGitStatus | null {
	const relativeFilePath = getRelativeFilePath(filePath, projectPath);
	const exactFileStatus = relativeFilePath ? (statusMap.get(relativeFilePath) ?? null) : null;
	return exactFileStatus ?? findGitStatusForFile(Array.from(statusMap.values()), filePath, projectPath);
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
