import type MarkdownIt from "markdown-it";

import {
	createGitHubBadgePlaceholder,
	GITHUB_COMMIT_SHA_PATTERN,
	GITHUB_GIT_REF_PATTERN,
	GITHUB_PR_SHORTHAND_PATTERN,
	GITHUB_URL_PATTERN,
	parseCommitSHA,
	parseGitHubURL,
	parsePRShorthand,
	type GitHubReference,
} from "../github-badge.js";

/**
 * Shared GitHub badge plugin. Transforms PR shorthands, commit SHAs, git refs, and
 * full GitHub URLs into placeholder spans. No repo context dependency — bare commit
 * SHAs produce badges without a URL; PR shorthands and full URLs always resolve.
 *
 * Placeholder mounting is handled by the consumer:
 * - MarkdownDisplay: static HTML link badges (website / skill preview)
 * - markdown-text.svelte: interactive GitHubBadge Svelte components (desktop)
 */
export function githubBadgePlugin(md: MarkdownIt): void {
	md.core.ruler.push("github_badges", (state) => {
		for (const blockToken of state.tokens) {
			if (blockToken.type !== "inline" || !blockToken.children) continue;

			const newChildren: typeof blockToken.children = [];

			for (const token of blockToken.children) {
				// Backtick-wrapped bare commit SHAs: `abc1234`
				if (token.type === "code_inline" && /^[a-f0-9]{7,40}$/.test(token.content)) {
					const htmlToken = new state.Token("html_inline", "", 0);
					htmlToken.content = createGitHubBadgePlaceholder(parseCommitSHA(token.content));
					newChildren.push(htmlToken);
					continue;
				}

				if (token.type !== "text") {
					newChildren.push(token);
					continue;
				}

				GITHUB_PR_SHORTHAND_PATTERN.lastIndex = 0;
				GITHUB_COMMIT_SHA_PATTERN.lastIndex = 0;
				GITHUB_GIT_REF_PATTERN.lastIndex = 0;
				GITHUB_URL_PATTERN.lastIndex = 0;

				const hasPR = GITHUB_PR_SHORTHAND_PATTERN.test(token.content);
				const hasSHA = GITHUB_COMMIT_SHA_PATTERN.test(token.content);
				const hasRef = GITHUB_GIT_REF_PATTERN.test(token.content);
				const hasURL = GITHUB_URL_PATTERN.test(token.content);

				if (!hasPR && !hasSHA && !hasRef && !hasURL) {
					newChildren.push(token);
					continue;
				}

				// Collect all matches in order, deduplicated
				const matches: Array<{ index: number; endIndex: number; ref: GitHubReference }> = [];

				GITHUB_URL_PATTERN.lastIndex = 0;
				let urlMatch: RegExpExecArray | null;
				while ((urlMatch = GITHUB_URL_PATTERN.exec(token.content)) !== null) {
					const [full, owner, repo, refType, ref] = urlMatch;
					matches.push({
						index: urlMatch.index,
						endIndex: urlMatch.index + full.length,
						ref: parseGitHubURL(owner, repo, refType, ref),
					});
				}

				GITHUB_PR_SHORTHAND_PATTERN.lastIndex = 0;
				let prMatch: RegExpExecArray | null;
				while ((prMatch = GITHUB_PR_SHORTHAND_PATTERN.exec(token.content)) !== null) {
					const [, owner, repo, number] = prMatch;
					matches.push({
						index: prMatch.index,
						endIndex: prMatch.index + prMatch[0].length,
						ref: parsePRShorthand(owner, repo, number),
					});
				}

				GITHUB_GIT_REF_PATTERN.lastIndex = 0;
				let gitRefMatch: RegExpExecArray | null;
				while ((gitRefMatch = GITHUB_GIT_REF_PATTERN.exec(token.content)) !== null) {
					const [, sha] = gitRefMatch;
					matches.push({
						index: gitRefMatch.index,
						endIndex: gitRefMatch.index + gitRefMatch[0].length,
						ref: parseCommitSHA(sha),
					});
				}

				GITHUB_COMMIT_SHA_PATTERN.lastIndex = 0;
				let shaMatch: RegExpExecArray | null;
				while ((shaMatch = GITHUB_COMMIT_SHA_PATTERN.exec(token.content)) !== null) {
					const covered = matches.some(
						(m) => m.index <= shaMatch!.index && shaMatch!.index < m.endIndex
					);
					if (!covered) {
						matches.push({
							index: shaMatch.index,
							endIndex: shaMatch.index + shaMatch[0].length,
							ref: parseCommitSHA(shaMatch[1]),
						});
					}
				}

				matches.sort((a, b) => a.index - b.index);

				// De-overlap
				const unique: typeof matches = [];
				for (const m of matches) {
					if (!unique.some((u) => m.index >= u.index && m.index < u.endIndex)) {
						unique.push(m);
					}
				}

				let lastIndex = 0;
				for (const m of unique) {
					if (m.index > lastIndex) {
						const t = new state.Token("text", "", 0);
						t.content = token.content.slice(lastIndex, m.index);
						newChildren.push(t);
					}
					const htmlToken = new state.Token("html_inline", "", 0);
					htmlToken.content = createGitHubBadgePlaceholder(m.ref);
					newChildren.push(htmlToken);
					lastIndex = m.endIndex;
				}

				if (lastIndex < token.content.length) {
					const t = new state.Token("text", "", 0);
					t.content = token.content.slice(lastIndex);
					newChildren.push(t);
				}
			}

			blockToken.children = newChildren;
		}
	});
}
