/** Status of a file in the git index (staged area) relative to HEAD. */
export type GitIndexStatus = "added" | "modified" | "deleted" | "renamed";

/** Status of a file in the working tree relative to the index. */
export type GitWorktreeStatus = "modified" | "deleted" | "untracked";

export interface GitStatusFile {
	path: string;
	/** Staged status (index vs HEAD). Null if not staged. */
	indexStatus: GitIndexStatus | null;
	/** Unstaged status (worktree vs index). Null if not modified in worktree. */
	worktreeStatus: GitWorktreeStatus | null;
	additions: number;
	deletions: number;
}

export interface GitStashEntry {
	index: number;
	message: string;
	date: string;
}

export interface GitLogEntry {
	sha: string;
	shortSha: string;
	message: string;
	author: string;
	date: string;
}

export interface GitLogEntryFile {
	path: string;
	status: string;
	additions: number;
	deletions: number;
	/** Unified diff patch (for inline diff rendering) */
	patch?: string;
}

export interface GitRemoteStatus {
	ahead: number;
	behind: number;
	remote: string;
	trackingBranch: string;
}
