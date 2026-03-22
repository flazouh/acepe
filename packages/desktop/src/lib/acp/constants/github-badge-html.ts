/**
 * HTML strings and utilities for GitHub reference badges.
 * Detects and renders PR/commit references as interactive badges.
 *
 * Supports 4 reference patterns:
 * 1. PR/Issue shorthand: owner/repo#123
 * 2. Full GitHub URLs: https://github.com/owner/repo/pull/123
 * 3. Commit SHAs: abc1234 (7-40 hex chars)
 * 4. Git references: @abc1234
 */

/** Base badge classes for GitHub badges */
export const GITHUB_BADGE_BASE_CLASSES =
	"inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-xs bg-muted text-muted-foreground";

/** Phosphor GitCommit icon - for commit references */
export const GITHUB_ICON_COMMIT = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 256 256"><path d="M216,128a40,40,0,1,1-40-40A40,40,0,0,1,216,128ZM88,96a24,24,0,1,0,24,24A24,24,0,0,0,88,96Zm0,40a16,16,0,1,1,16-16A16,16,0,0,1,88,136Zm128-8H216a40,40,0,0,0-40-40V64a8,8,0,0,0-16,0v24a40,40,0,0,0-40,40H104a8,8,0,0,0,0,16h24a40,40,0,0,0,40,40v24a8,8,0,0,0,16,0V184a40,40,0,0,0,40-40h24a8,8,0,0,0,0-16Z"></path></svg>`;

/** Phosphor GitPullRequest icon - for PR references */
export const GITHUB_ICON_PR = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 256 256"><path d="M104,160a24,24,0,1,1,24-24A24,24,0,0,1,104,160ZM212,112h-20V80a36,36,0,0,0-36-36H144V24a8,8,0,0,0-16,0V44H104a36,36,0,0,0-36,36V96H56a8,8,0,0,0-8,8v8a64,64,0,0,0,0,128,8,8,0,0,0,0-16,48,48,0,0,1,0-96h8v80a8,8,0,0,0,16,0V128h60v80a8,8,0,0,0,16,0V128h8a48,48,0,0,1,0,96,8,8,0,0,0,0,16,64,64,0,0,0,0-128h8V112A8,8,0,0,0,212,112Z"></path></svg>`;

/**
 * Regex patterns for GitHub reference detection.
 * Tested in order of specificity.
 */

/** Matches PR/Issue shorthand: owner/repo#123 */
export const GITHUB_PR_SHORTHAND_PATTERN = /\b([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)#(\d+)\b/g;

/** Matches commit SHAs: 7-40 hex characters (not preceded by @) */
export const GITHUB_COMMIT_SHA_PATTERN = /(?<!@)\b([a-f0-9]{7,40})\b/g;

/** Matches git references: @abc1234 */
export const GITHUB_GIT_REF_PATTERN = /@([a-f0-9]{7,40})\b/g;

/** Matches full GitHub URLs for commits and PRs */
export const GITHUB_URL_PATTERN =
	/https?:\/\/github\.com\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)\/(pull|commit|issues?)\/([a-zA-Z0-9]+)/gi;

/** Discriminated union for parsed GitHub references */
export type GitHubReference =
	| { type: "pr"; owner: string; repo: string; number: number }
	| { type: "commit"; sha: string; owner?: string; repo?: string }
	| { type: "issue"; owner: string; repo: string; number: number };

/**
 * Parses a PR shorthand reference (owner/repo#123).
 */
export function parsePRShorthand(owner: string, repo: string, number: string): GitHubReference {
	return { type: "pr", owner, repo, number: parseInt(number, 10) };
}

/**
 * Parses a commit SHA reference.
 */
export function parseCommitSHA(sha: string): GitHubReference {
	return { type: "commit", sha };
}

/**
 * Parses a GitHub URL reference.
 */
export function parseGitHubURL(
	owner: string,
	repo: string,
	refType: string,
	ref: string
): GitHubReference {
	if (refType === "pull") {
		return { type: "pr", owner, repo, number: parseInt(ref, 10) };
	} else if (refType === "commit") {
		return { type: "commit", sha: ref, owner, repo };
	} else {
		// issues or issue
		return { type: "issue", owner, repo, number: parseInt(ref, 10) };
	}
}

/**
 * Gets the GitHub URL for a reference.
 */
export function getGitHubURL(ref: GitHubReference): string {
	if (ref.type === "pr") {
		return `https://github.com/${ref.owner}/${ref.repo}/pull/${ref.number}`;
	} else if (ref.type === "commit") {
		if (ref.owner && ref.repo) {
			return `https://github.com/${ref.owner}/${ref.repo}/commit/${ref.sha}`;
		}
		// If repo context not available, return empty
		return "";
	} else {
		// issue
		return `https://github.com/${ref.owner}/${ref.repo}/issues/${ref.number}`;
	}
}

/**
 * Gets the display label for a reference.
 */
export function getGitHubLabel(ref: GitHubReference): string {
	if (ref.type === "pr") {
		return `${ref.owner}/${ref.repo}#${ref.number}`;
	} else if (ref.type === "commit") {
		return ref.sha.slice(0, 7);
	} else {
		// issue
		return `${ref.owner}/${ref.repo}#${ref.number}`;
	}
}

/**
 * Gets the appropriate icon for a reference type.
 */
function getGitHubIcon(type: string): string {
	if (type === "commit") {
		return GITHUB_ICON_COMMIT;
	}
	return GITHUB_ICON_PR; // Both PR and issue use the same icon
}

/**
 * Creates a GitHub badge HTML string.
 * Displays an icon and label (no external link).
 *
 * @param ref - The parsed GitHub reference
 * @param repoContext - Optional repo context for commit references
 */
export function createGitHubBadgeHtml(
	ref: GitHubReference,
	repoContext?: { owner: string; repo: string }
): string {
	// Add repo context to commit refs if needed
	if (ref.type === "commit" && repoContext && !ref.owner) {
		ref = { ...ref, owner: repoContext.owner, repo: repoContext.repo };
	}

	const githubURL = getGitHubURL(ref);
	const label = getGitHubLabel(ref);
	const icon = getGitHubIcon(ref.type);

	// If no GitHub URL available (e.g., commit without repo context), return plain text
	if (!githubURL) {
		return `<span class="${GITHUB_BADGE_BASE_CLASSES}" title="${label}">${icon}<code>${label}</code></span>`;
	}

	return `<button type="button" class="github-badge" data-github-type="${ref.type}" data-github-url="${githubURL}" data-github-ref="${JSON.stringify(ref).replace(/"/g, "&quot;")}" title="${label}">
		${icon}
		<code>${label}</code>
	</button>`;
}

/**
 * Creates a placeholder for a GitHub badge component.
 * Used during markdown rendering; the placeholder is later parsed and rendered as a Svelte component.
 *
 * @param ref - The parsed GitHub reference
 * @param repoContext - Optional repo context for commit references
 */
export function createGitHubBadgePlaceholder(
	ref: GitHubReference,
	repoContext?: { owner: string; repo: string }
): string {
	// Add repo context to commit refs if needed
	if (ref.type === "commit" && repoContext && !ref.owner) {
		ref = { ...ref, owner: repoContext.owner, repo: repoContext.repo };
	}

	// Use URL encoding for the JSON to avoid HTML entity parsing issues.
	// Inline <span> so placeholders stay inside parent elements (like file-path-badge); mounted by mountGitHubBadges.
	const refJson = encodeURIComponent(JSON.stringify(ref));
	return `<span class="github-badge-placeholder" data-reveal-skip data-github-ref="${refJson}"></span>`;
}
