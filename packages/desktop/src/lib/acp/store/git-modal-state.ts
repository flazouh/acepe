import type { WorktreeInfo } from "$lib/acp/types/worktree-info.js";

export interface WorktreeListItem {
	worktree: WorktreeInfo;
	isCurrent: boolean;
}

export function resolveCurrentWorktree(
	projectPath: string,
	worktrees: readonly WorktreeInfo[]
): WorktreeInfo | null {
	return worktrees.find((worktree) => worktree.directory === projectPath) ?? null;
}

export function buildWorktreeListItems(
	projectPath: string,
	worktrees: readonly WorktreeInfo[]
): WorktreeListItem[] {
	return worktrees
		.map((worktree) => ({
			worktree,
			isCurrent: worktree.directory === projectPath,
		}))
		.sort((left, right) => {
			if (left.isCurrent !== right.isCurrent) {
				return left.isCurrent ? -1 : 1;
			}

			return left.worktree.name.localeCompare(right.worktree.name);
		});
}

export function normalizeCommitLookupQuery(query: string): string | null {
	const normalized = query.trim();
	return normalized.length > 0 ? normalized : null;
}
