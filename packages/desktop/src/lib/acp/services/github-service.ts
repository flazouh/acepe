/**
 * Frontend service for GitHub integration.
 * Wraps Tauri commands with Effect error handling and caching.
 */

import { fromPromise } from "@acepe/effect-result/fromPromise";
import * as Effect from "effect/Effect";
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
	if (isGitHubError(error)) {
		return error;
	}

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

function isGitHubError(error: unknown): error is GitHubError {
	if (error === null || typeof error !== "object") {
		return false;
	}
	if (!("type" in error) || !("message" in error)) {
		return false;
	}
	return typeof error.type === "string" && typeof error.message === "string";
}

/**
 * Cache for repo context lookups.
 * Keyed by projectPath. Repo context rarely changes (owner/repo from git remote),
 * so we cache indefinitely and deduplicate in-flight requests.
 */
const repoContextCache = new Map<string, RepoContext>();
const repoContextInflight = new Map<string, Promise<RepoContext>>();

/**
 * Gets repository context from git config.
 * Results are cached per projectPath for the lifetime of the app session,
 * and concurrent requests for the same path are deduplicated.
 */
export function getRepoContext(projectPath: string): Effect.Effect<RepoContext, GitHubError> {
	// Return cached result immediately
	const cached = repoContextCache.get(projectPath);
	if (cached) {
		return Effect.succeed(cached);
	}

	// Deduplicate in-flight requests
	const inflight = repoContextInflight.get(projectPath);
	if (inflight) {
		return fromPromise(() => inflight, tauriErrorToGitHubError);
	}

	const pending = Effect.runPromise(
		fromPromise(
			() => invoke<RepoContext>(Commands.github.get_github_repo_context, { projectPath }),
			tauriErrorToGitHubError
		)
	).then(
		(ctx) => {
			repoContextCache.set(projectPath, ctx);
			repoContextInflight.delete(projectPath);
			return ctx;
		},
		(error: unknown) => {
			repoContextInflight.delete(projectPath);
			throw error;
		}
	);

	repoContextInflight.set(projectPath, pending);
	return fromPromise(() => pending, tauriErrorToGitHubError);
}

/**
 * Fetches commit diff via git or gh CLI (hybrid approach).
 * Results are cached indefinitely for commits.
 */
export function fetchCommitDiff(
	sha: string,
	projectPath: string,
	repoContext?: RepoContext
): Effect.Effect<CommitDiff, GitHubError> {
	const cacheKey = getCacheKey("commit", sha);

	// Check cache
	const cached = diffCache.get(cacheKey);
	if (cached && isCacheValid(cached)) {
		return Effect.succeed(cached.diff as CommitDiff);
	}

	return fromPromise(
		() =>
			invoke<CommitDiff>(Commands.github.fetch_commit_diff, { sha, projectPath, repoContext }),
		tauriErrorToGitHubError
	).pipe(
		Effect.map((diff) => {
			// Cache the result
			diffCache.set(cacheKey, { diff, timestamp: Date.now(), type: "commit" });
			return diff;
		})
	);
}

/**
 * Fetches PR diff via gh CLI.
 * Results are cached for 5 minutes.
 */
export function fetchPrDiff(
	owner: string,
	repo: string,
	prNumber: number
): Effect.Effect<PrDiff, GitHubError> {
	const cacheKey = getCacheKey("pr", `${owner}/${repo}#${prNumber}`);

	// Check cache
	const cached = diffCache.get(cacheKey);
	if (cached && isCacheValid(cached)) {
		return Effect.succeed(cached.diff as PrDiff);
	}

	return fromPromise(
		() => invoke<PrDiff>(Commands.github.fetch_pr_diff, { owner, repo, prNumber }),
		tauriErrorToGitHubError
	).pipe(
		Effect.map((diff) => {
			// Cache the result
			diffCache.set(cacheKey, { diff, timestamp: Date.now(), type: "pr" });
			return diff;
		})
	);
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
): Effect.Effect<PrListItem[], GitHubError> {
	return fromPromise(
		() =>
			invoke<PrListItem[]>(Commands.github.list_pull_requests, {
				owner,
				repo,
				state: state ?? "open",
				limit: limit ?? 30,
			}),
		tauriErrorToGitHubError
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
): Effect.Effect<Diff, GitHubError> {
	if (refType === "commit") {
		// For commits, first try without repo context (git), then fall back to gh
		return fetchCommitDiff(ref, projectPath);
	}

	// For PRs, parse owner/repo#number format
	const match = ref.match(/^([^/]+)\/([^#]+)#(\d+)$/);
	if (!match) {
		return Effect.fail({
			type: "parse_error",
			message: "Invalid PR reference format. Use owner/repo#123",
		} satisfies GitHubError);
	}

	const [, owner, repo, prNumber] = match;
	return fetchPrDiff(owner, repo, parseInt(prNumber, 10));
}

/**
 * Clears the diff cache (useful for debugging or forcing refresh).
 */
export function clearDiffCache(): void {
	diffCache.clear();
}

/**
 * Clears the cached repo-context entries.
 * Intended for deterministic tests and explicit cache resets.
 */
export function clearRepoContextCache(): void {
	repoContextCache.clear();
}

/**
 * Clears in-flight repo-context requests.
 * Intended for deterministic tests and explicit cache resets.
 */
export function clearRepoContextInflight(): void {
	repoContextInflight.clear();
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
	staged: boolean,
	status: FileDiff["status"],
	additions: number,
	deletions: number
): Effect.Effect<FileDiff, GitHubError> {
	return fromPromise(
		() =>
			invoke<FileDiff>(Commands.github.git_working_file_diff, {
				projectPath,
				filePath,
				staged,
				status,
				additions,
				deletions,
			}),
		tauriErrorToGitHubError
	);
}
