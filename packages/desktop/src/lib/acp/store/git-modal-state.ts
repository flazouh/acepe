import type { WorktreeInfo } from "$lib/acp/types/worktree-info.js";

export interface GitModalPanel {
	id: string;
	projectPath: string;
	width: number;
}

interface OpenGitModalPanelResult<TPanel extends GitModalPanel> {
	panels: TPanel[];
	activePanel: TPanel;
}

export interface WorktreeListItem {
	worktree: WorktreeInfo;
	isCurrent: boolean;
}

export function openGitModalPanel<TPanel extends GitModalPanel>(
	existingPanels: TPanel[],
	projectPath: string,
	width: number,
	createId: () => string
): OpenGitModalPanelResult<TPanel> {
	const existing = existingPanels.find((panel) => panel.projectPath === projectPath);
	if (existing) {
		return {
			panels: existingPanels,
			activePanel: existing,
		};
	}

	const panel = {
		id: createId(),
		projectPath,
		width,
	} as TPanel;

	return {
		panels: [panel],
		activePanel: panel,
	};
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
