/**
 * Frontend service for GitHub integration.
 * Wraps Tauri commands with neverthrow error handling and caching.
 */

import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { Commands, invoke } from "../../utils/tauri-commands.js";
import type {
	CommitDiff,
	Diff,
	FileDiff,
	GitHubError,
	PrDiff,
	PrListItem,
	RepoContext,
} from "../types/github-integration.js";

// Re-export types for convenience
export type { CommitDiff, Diff, FileDiff, GitHubError, PrDiff, PrListItem, RepoContext };

/**
 * Cache for fetched diffs.
 * Commits are cached indefinitely, PRs with 5-minute TTL.
 */
const diffCache = new Map<
	string,
	{ diff: CommitDiff | PrDiff; timestamp: number; type: "commit" | "pr" }
>();

const CACHE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Gets the cache key for a reference.
 */
function getCacheKey(type: "commit" | "pr", value: string): string {
	return `${type}:${value}`;
}

/**
 * Checks if a cached entry is still valid.
 */
function isCacheValid(entry: { diff: unknown; timestamp: number; type: "commit" | "pr" }): boolean {
	if (entry.type === "commit") {
		// Commits never expire
		return true;
	}
	// PRs expire after 5 minutes
	return Date.now() - entry.timestamp < CACHE_EXPIRY_MS;
}

/**
 * Converts Tauri errors to GitHubError type.
 */
function tauriErrorToGitHubError(error: unknown): GitHubError {
	const msg = error instanceof Error ? error.message : String(error);

	if (msg.includes("git: not found") || msg.includes("git not found")) {
		return { type: "git_not_found", message: msg };
	}

	if (msg.includes("gh: not found") || msg.includes("gh not found")) {
		return { type: "gh_not_found", message: msg };
	}

	if (msg.includes("not authenticated") || msg.includes("401") || msg.includes("Unauthorized")) {
		return { type: "gh_not_authenticated", message: msg };
	}

	if (msg.includes("not found") || msg.includes("Not Found")) {
		return { type: "ref_not_found", message: msg };
	}

	if (msg.includes("not a git repo") || msg.includes("Not a git repository")) {
		return { type: "not_a_git_repo", message: msg };
	}

	if (msg.includes("parse") || msg.includes("JSON")) {
		return { type: "parse_error", message: msg };
	}

	if (msg.includes("network") || msg.includes("Connection")) {
		return { type: "network_error", message: msg };
	}

	return { type: "unknown_error", message: msg };
}

/**
 * Cache for repo context lookups.
 * Keyed by projectPath. Repo context rarely changes (owner/repo from git remote),
 * so we cache indefinitely and deduplicate in-flight requests.
 */
const repoContextCache = new Map<string, RepoContext>();
const repoContextInflight = new Map<string, ResultAsync<RepoContext, GitHubError>>();

/**
 * Gets repository context from git config.
 * Results are cached per projectPath for the lifetime of the app session,
 * and concurrent requests for the same path are deduplicated.
 */
export function getRepoContext(projectPath: string): ResultAsync<RepoContext, GitHubError> {
	// Return cached result immediately
	const cached = repoContextCache.get(projectPath);
	if (cached) {
		return okAsync(cached);
	}

	// Deduplicate in-flight requests
	const inflight = repoContextInflight.get(projectPath);
	if (inflight) {
		return inflight;
	}

	const request = ResultAsync.fromPromise(
		invoke<RepoContext>(Commands.github.get_github_repo_context, { projectPath }),
		(error) => tauriErrorToGitHubError(error)
	).map((ctx) => {
		repoContextCache.set(projectPath, ctx);
		repoContextInflight.delete(projectPath);
		return ctx;
	});

	// Clean up inflight on error too
	request.mapErr((err) => {
		repoContextInflight.delete(projectPath);
		return err;
	});

	repoContextInflight.set(projectPath, request);
	return request;
}

/**
 * Fetches commit diff via git or gh CLI (hybrid approach).
 * Results are cached indefinitely for commits.
 */
export function fetchCommitDiff(
	sha: string,
	projectPath: string,
	repoContext?: RepoContext
): ResultAsync<CommitDiff, GitHubError> {
	const cacheKey = getCacheKey("commit", sha);

	// Check cache
	const cached = diffCache.get(cacheKey);
	if (cached && isCacheValid(cached)) {
		return okAsync(cached.diff as CommitDiff);
	}

	return ResultAsync.fromPromise(
		invoke<CommitDiff>(Commands.github.fetch_commit_diff, { sha, projectPath, repoContext }),
		(error) => tauriErrorToGitHubError(error)
	).map((diff) => {
		// Cache the result
		diffCache.set(cacheKey, { diff, timestamp: Date.now(), type: "commit" });
		return diff;
	});
}

/**
 * Fetches PR diff via gh CLI.
 * Results are cached for 5 minutes.
 */
export function fetchPrDiff(
	owner: string,
	repo: string,
	prNumber: number
): ResultAsync<PrDiff, GitHubError> {
	const cacheKey = getCacheKey("pr", `${owner}/${repo}#${prNumber}`);

	// Check cache
	const cached = diffCache.get(cacheKey);
	if (cached && isCacheValid(cached)) {
		return okAsync(cached.diff as PrDiff);
	}

	return ResultAsync.fromPromise(
		invoke<PrDiff>(Commands.github.fetch_pr_diff, { owner, repo, prNumber }),
		(error) => tauriErrorToGitHubError(error)
	).map((diff) => {
		// Cache the result
		diffCache.set(cacheKey, { diff, timestamp: Date.now(), type: "pr" });
		return diff;
	});
}

/**
 * Lists pull requests for a repository.
 * Not cached — always fetches fresh data.
 */
export function listPullRequests(
	owner: string,
	repo: string,
	state?: "open" | "closed" | "all",
	limit?: number
): ResultAsync<PrListItem[], GitHubError> {
	return ResultAsync.fromPromise(
		invoke<PrListItem[]>(Commands.github.list_pull_requests, {
			owner,
			repo,
			state: state ?? "open",
			limit: limit ?? 30,
		}),
		(error) => tauriErrorToGitHubError(error)
	);
}

/**
 * Fetches diff by commit SHA or PR reference.
 * Automatically determines repo context if needed.
 */
export function fetchDiff(
	ref: string,
	projectPath: string,
	refType: "commit" | "pr"
): ResultAsync<Diff, GitHubError> {
	if (refType === "commit") {
		// For commits, first try without repo context (git), then fall back to gh
		return fetchCommitDiff(ref, projectPath);
	} else {
		// For PRs, parse owner/repo#number format
		const match = ref.match(/^([^/]+)\/([^#]+)#(\d+)$/);
		if (!match) {
			return errAsync({
				type: "parse_error",
				message: "Invalid PR reference format. Use owner/repo#123",
			} satisfies GitHubError);
		}

		const [, owner, repo, prNumber] = match;
		return fetchPrDiff(owner, repo, parseInt(prNumber, 10)) as ResultAsync<Diff, GitHubError>;
	}
}

/**
 * Clears the diff cache (useful for debugging or forcing refresh).
 */
export function clearDiffCache(): void {
	diffCache.clear();
}

/**
 * Gets current cache size (for monitoring).
 */
export function getCacheSize(): number {
	return diffCache.size;
}

/**
 * Fetches the diff patch for a single working-tree file.
 * Not cached — always fetches fresh data (working tree changes frequently).
 */
export function fetchWorkingFileDiff(
	projectPath: string,
	filePath: string,
	staged: boolean
): ResultAsync<FileDiff, GitHubError> {
	return ResultAsync.fromPromise(
		invoke<FileDiff>(Commands.github.git_working_file_diff, {
			projectPath,
			filePath,
			staged,
		}),
		(error) => tauriErrorToGitHubError(error)
	);
}
