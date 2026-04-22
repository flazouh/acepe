import type { ProjectInfo } from "$lib/utils/tauri-client/types.js";
import type { ProjectWithSessions } from "./open-project-dialog-props.js";

function isAcepeManagedWorktreePath(path: string): boolean {
	return path.includes("/.acepe/worktrees/");
}

function isAgentManagedDiscoveryPath(path: string): boolean {
	return path.includes("/.codecs/") || path.endsWith("/.codecs");
}

function hasHiddenPathSegment(path: string): boolean {
	return isAcepeManagedWorktreePath(path) || isAgentManagedDiscoveryPath(path);
}

export function shouldShowDiscoveredProject(info: ProjectInfo): boolean {
	return (
		info.path !== "/" &&
		info.path !== "global" &&
		!info.is_worktree &&
		!hasHiddenPathSegment(info.path)
	);
}

export function sortProjectsBySessionCount(projects: ProjectWithSessions[]): ProjectWithSessions[] {
	return projects.slice().sort((a, b) => {
		const aIsIncomplete = a.totalSessions === "loading" || a.totalSessions === "error";
		const bIsIncomplete = b.totalSessions === "loading" || b.totalSessions === "error";

		if (aIsIncomplete && bIsIncomplete) {
			return 0;
		}
		if (aIsIncomplete) {
			return 1;
		}
		if (bIsIncomplete) {
			return -1;
		}

		const aCount = typeof a.totalSessions === "number" ? a.totalSessions : 0;
		const bCount = typeof b.totalSessions === "number" ? b.totalSessions : 0;
		return bCount - aCount;
	});
}
