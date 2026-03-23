import type MarkdownIt from "markdown-it";

import {
	createGitHubBadgePlaceholder,
	GITHUB_COMMIT_SHA_PATTERN,
	GITHUB_GIT_REF_PATTERN,
	GITHUB_PR_SHORTHAND_PATTERN,
	GITHUB_URL_PATTERN,
	type GitHubReference,
	parseCommitSHA,
	parseGitHubURL,
	parsePRShorthand,
} from "../../constants/github-badge-html.js";
import { rendererRepoContext } from "../renderer-repo-context.js";

/**
 * Renders GitHub reference badges for PR/commit references.
 * Transforms GitHub references into styled badge elements.
 *
 * Supported patterns:
 * - PR shorthand: anthropics/acepe#42
 * - Full URLs: https://github.com/anthropics/acepe/pull/42
 * - Commit SHAs: abc1234 (7-40 hex chars)
 * - Git refs: @abc1234
 */
export function githubBadgePlugin(md: MarkdownIt): void {
	md.core.ruler.push("github_badges", (state) => {
		const repoContext = rendererRepoContext.get(md);

		for (const blockToken of state.tokens) {
			if (blockToken.type !== "inline" || !blockToken.children) {
				continue;
			}

			const newChildren: typeof blockToken.children = [];

			for (const token of blockToken.children) {
				if (token.type === "code_inline") {
					if (/^[a-f0-9]{7,40}$/.test(token.content)) {
						const sha = token.content;
						let parsedRef = parseCommitSHA(sha);
						if (repoContext && !parsedRef.owner) {
							parsedRef = { ...parsedRef, owner: repoContext.owner, repo: repoContext.repo };
						}
						const htmlToken = new state.Token("html_inline", "", 0);
						htmlToken.content = createGitHubBadgePlaceholder(parsedRef, repoContext);
						newChildren.push(htmlToken);
						continue;
					}
					newChildren.push(token);
					continue;
				}

				if (token.type !== "text") {
					newChildren.push(token);
					continue;
				}

				const hasPRShorthand = GITHUB_PR_SHORTHAND_PATTERN.test(token.content);
				const hasCommitSHA = GITHUB_COMMIT_SHA_PATTERN.test(token.content);
				const hasGitRef = GITHUB_GIT_REF_PATTERN.test(token.content);
				const hasURL = GITHUB_URL_PATTERN.test(token.content);

				if (!hasPRShorthand && !hasCommitSHA && !hasGitRef && !hasURL) {
					newChildren.push(token);
					continue;
				}

				let lastIndex = 0;
				const processedChildren: typeof blockToken.children = [];

				const matches: Array<{ index: number; endIndex: number; ref: GitHubReference }> = [];

				GITHUB_URL_PATTERN.lastIndex = 0;
				let urlMatch: RegExpExecArray | null;
				// biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop
				while ((urlMatch = GITHUB_URL_PATTERN.exec(token.content)) !== null) {
					const [fullMatch, owner, repo, refType, ref] = urlMatch;
					const parsedRef = parseGitHubURL(owner, repo, refType, ref);
					matches.push({
						index: urlMatch.index,
						endIndex: urlMatch.index + fullMatch.length,
						ref: parsedRef,
					});
				}

				GITHUB_PR_SHORTHAND_PATTERN.lastIndex = 0;
				let prMatch: RegExpExecArray | null;
				// biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop
				while ((prMatch = GITHUB_PR_SHORTHAND_PATTERN.exec(token.content)) !== null) {
					const [, owner, repo, number] = prMatch;
					const parsedRef = parsePRShorthand(owner, repo, number);
					matches.push({
						index: prMatch.index,
						endIndex: prMatch.index + prMatch[0].length,
						ref: parsedRef,
					});
				}

				GITHUB_GIT_REF_PATTERN.lastIndex = 0;
				let gitRefMatch: RegExpExecArray | null;
				// biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop
				while ((gitRefMatch = GITHUB_GIT_REF_PATTERN.exec(token.content)) !== null) {
					const [, sha] = gitRefMatch;
					const parsedRef = parseCommitSHA(sha);
					matches.push({
						index: gitRefMatch.index,
						endIndex: gitRefMatch.index + gitRefMatch[0].length,
						ref: parsedRef,
					});
				}

				GITHUB_COMMIT_SHA_PATTERN.lastIndex = 0;
				let shaMatch: RegExpExecArray | null;
				// biome-ignore lint/suspicious/noAssignInExpressions: standard regex exec loop
				while ((shaMatch = GITHUB_COMMIT_SHA_PATTERN.exec(token.content)) !== null) {
					const currentMatch = shaMatch;
					const isCovered = matches.some(
						(m) => m.index <= currentMatch.index && currentMatch.index < m.endIndex
					);
					if (!isCovered) {
						const sha = currentMatch[1];
						let parsedRef = parseCommitSHA(sha);
						if (repoContext && parsedRef.type === "commit" && !parsedRef.owner) {
							parsedRef = { ...parsedRef, owner: repoContext.owner, repo: repoContext.repo };
						}
						matches.push({
							index: currentMatch.index,
							endIndex: currentMatch.index + currentMatch[0].length,
							ref: parsedRef,
						});
					}
				}

				matches.sort((a, b) => a.index - b.index);

				const uniqueMatches: Array<{ index: number; endIndex: number; ref: GitHubReference }> = [];
				for (const match of matches) {
					const overlaps = uniqueMatches.some(
						(m) =>
							(match.index >= m.index && match.index < m.endIndex) ||
							(m.index >= match.index && m.index < match.endIndex)
					);
					if (!overlaps) {
						uniqueMatches.push(match);
					}
				}

				lastIndex = 0;
				for (const match of uniqueMatches) {
					if (match.index > lastIndex) {
						const textToken = new state.Token("text", "", 0);
						textToken.content = token.content.slice(lastIndex, match.index);
						processedChildren.push(textToken);
					}

					const htmlToken = new state.Token("html_inline", "", 0);
					htmlToken.content = createGitHubBadgePlaceholder(match.ref, repoContext);
					processedChildren.push(htmlToken);

					lastIndex = match.endIndex;
				}

				if (lastIndex < token.content.length) {
					const textToken = new state.Token("text", "", 0);
					textToken.content = token.content.slice(lastIndex);
					processedChildren.push(textToken);
				}

				newChildren.push(...processedChildren);
			}

			blockToken.children = newChildren;
		}
	});
}
