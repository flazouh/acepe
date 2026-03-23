/**
 * Type definitions for GitHub integration.
 * Includes repo context, commit/PR diff data, and error types.
 */

/**
 * Repository context extracted from git config.
 * Used for resolving bare commit SHAs and @refs.
 */
export interface RepoContext {
	/** GitHub owner (e.g., "anthropics") */
	owner: string;
	/** Repository name (e.g., "acepe") */
	repo: string;
	/** Full GitHub remote URL (e.g., "https://github.com/anthropics/acepe") */
	remoteUrl: string;
}

/**
 * Single file diff in a commit or PR.
 * Contains the unified diff format patch.
 */
export interface FileDiff {
	/** File path relative to repo root */
	path: string;
	/** File change status */
	status: "added" | "modified" | "deleted" | "renamed";
	/** Number of lines added */
	additions: number;
	/** Number of lines deleted */
	deletions: number;
	/** Unified diff format patch for this file */
	patch: string;
}

/**
 * Complete diff for a single commit.
 * Includes metadata and all changed files.
 */
export interface CommitDiff {
	/** Full commit SHA (40 hex chars) */
	sha: string;
	/** Short commit SHA (7 hex chars) - for display */
	shortSha: string;
	/** Commit message first line */
	message: string;
	/** Full commit message body (may be multi-line) */
	messageBody?: string;
	/** Commit author name */
	author: string;
	/** Commit author email */
	authorEmail: string;
	/** Commit date (ISO 8601 format) */
	date: string;
	/** All changed files in the commit */
	files: FileDiff[];
	/** Repo context for this commit (owner/repo) */
	repoContext?: RepoContext;
}

/**
 * Summary entry for a pull request in a listing.
 */
export interface PrListItem {
	/** PR number */
	number: number;
	/** PR title */
	title: string;
	/** PR author (GitHub username) */
	author: string;
	/** PR state: open, closed, or merged */
	state: "open" | "closed" | "merged";
	/** Head branch ref */
	headRef: string;
	/** Base branch ref */
	baseRef: string;
	/** Last updated date (ISO 8601) */
	updatedAt: string;
	/** Lines added */
	additions: number;
	/** Lines deleted */
	deletions: number;
	/** Number of changed files */
	changedFiles: number;
}

/**
 * PR metadata.
 * May be partial depending on data source (gh CLI provides more info).
 */
export interface PrMetadata {
	/** PR number */
	number: number;
	/** PR title */
	title: string;
	/** PR author (GitHub username) */
	author: string;
	/** PR state: open, closed, or merged */
	state: "open" | "closed" | "merged";
	/** PR description/body */
	description?: string;
}

/**
 * Complete diff for a PR.
 * Includes PR metadata and all changed files.
 */
export interface PrDiff {
	/** PR metadata */
	pr: PrMetadata;
	/** All changed files in the PR */
	files: FileDiff[];
	/** Repo context for this PR (owner/repo) */
	repoContext: RepoContext;
}

/**
 * Union of possible diff types.
 * Used for polymorphic handling of commit/PR diffs.
 */
export type Diff = CommitDiff | PrDiff;

/**
 * Error types for GitHub operations.
 */
export type GitHubError =
	| { type: "git_not_found"; message: string }
	| { type: "gh_not_found"; message: string }
	| { type: "gh_not_authenticated"; message: string }
	| { type: "not_a_git_repo"; message: string }
	| { type: "ref_not_found"; message: string }
	| { type: "network_error"; message: string }
	| { type: "parse_error"; message: string }
	| { type: "unknown_error"; message: string };

/**
 * Type guard to check if a diff is a commit diff.
 */
export function isCommitDiff(diff: Diff): diff is CommitDiff {
	return "sha" in diff;
}

/**
 * Type guard to check if a diff is a PR diff.
 */
export function isPrDiff(diff: Diff): diff is PrDiff {
	return "pr" in diff;
}
