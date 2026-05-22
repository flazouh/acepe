import type { GitHubReference } from "../constants/github-badge-html.js";
import type { FileDiff } from "../types/github-integration.js";

export interface GitHubRepoContext {
	readonly owner: string;
	readonly repo: string;
}

export interface GitHubDiffStats {
	readonly insertions: number;
	readonly deletions: number;
}

export function enhanceGitHubReference(
	ref: GitHubReference,
	repoContext: GitHubRepoContext | undefined
): GitHubReference {
	if (ref.type === "commit" && repoContext && !ref.owner) {
		return {
			type: "commit",
			sha: ref.sha,
			owner: repoContext.owner,
			repo: repoContext.repo,
		};
	}

	return ref;
}

export function getGitHubStatsKey(input: {
	readonly ref: GitHubReference;
	readonly projectPath: string | undefined;
}): string {
	const projectPath = input.projectPath ?? "";

	if (input.ref.type === "commit") {
		return `commit:${projectPath}:${input.ref.sha}`;
	}

	if (input.ref.type === "pr") {
		return `pr:${projectPath}:${input.ref.owner}/${input.ref.repo}#${input.ref.number}`;
	}

	return `issue:${input.ref.owner}/${input.ref.repo}#${input.ref.number}`;
}

export function shouldLoadGitHubStats(input: {
	readonly ref: GitHubReference;
	readonly hasLoadedStats: boolean;
	readonly statsLoading: boolean;
	readonly projectPath: string | undefined;
}): boolean {
	return (
		!input.hasLoadedStats &&
		!input.statsLoading &&
		input.projectPath !== undefined &&
		input.projectPath.length > 0 &&
		input.ref.type !== "issue"
	);
}

export function getGitHubDiffStats(files: readonly Pick<FileDiff, "additions" | "deletions">[]): GitHubDiffStats {
	return files.reduce<GitHubDiffStats>(
		(stats, file) => ({
			insertions: stats.insertions + (file.additions ?? 0),
			deletions: stats.deletions + (file.deletions ?? 0),
		}),
		{ insertions: 0, deletions: 0 }
	);
}

export function getGitHubBadgeCopyText(ref: GitHubReference): string {
	if (ref.type === "commit") return ref.sha;
	return `${ref.owner}/${ref.repo}#${ref.number}`;
}
