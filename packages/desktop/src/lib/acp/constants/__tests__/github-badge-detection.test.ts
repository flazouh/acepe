import { describe, expect, it } from "bun:test";

import {
	createGitHubBadgeHtml,
	GITHUB_COMMIT_SHA_PATTERN,
	GITHUB_GIT_REF_PATTERN,
	GITHUB_PR_SHORTHAND_PATTERN,
	GITHUB_URL_PATTERN,
	getGitHubLabel,
	getGitHubURL,
	parseCommitSHA,
	parseGitHubURL,
	parsePRShorthand,
} from "../github-badge-html.js";

describe("GitHub Badge Detection - Regex Patterns", () => {
	describe("PR Shorthand Pattern (owner/repo#123)", () => {
		it("should match simple PR shorthand", () => {
			const text = "anthropics/acepe#123";
			const matches = [...text.matchAll(GITHUB_PR_SHORTHAND_PATTERN)];
			expect(matches).toHaveLength(1);
			expect(matches[0][1]).toBe("anthropics");
			expect(matches[0][2]).toBe("acepe");
			expect(matches[0][3]).toBe("123");
		});

		it("should match PR shorthand with hyphens and underscores", () => {
			const text = "my-org/my_repo#456";
			const matches = [...text.matchAll(GITHUB_PR_SHORTHAND_PATTERN)];
			expect(matches).toHaveLength(1);
			expect(matches[0][1]).toBe("my-org");
			expect(matches[0][2]).toBe("my_repo");
		});

		it("should match multiple PR shorthands in text", () => {
			const text = "Check anthropics/acepe#123 and vercel/nextjs#456";
			const matches = [...text.matchAll(GITHUB_PR_SHORTHAND_PATTERN)];
			expect(matches).toHaveLength(2);
			expect(matches[0][3]).toBe("123");
			expect(matches[1][3]).toBe("456");
		});

		it("should match PR shorthand at word boundaries", () => {
			const text = "In anthropics/acepe#123, we fixed...";
			const matches = [...text.matchAll(GITHUB_PR_SHORTHAND_PATTERN)];
			expect(matches).toHaveLength(1);
		});

		it("should match after forward slash boundary", () => {
			// "/" creates a word boundary, so this matches
			const text = "see/anthropics/acepe#123";
			const matches = [...text.matchAll(GITHUB_PR_SHORTHAND_PATTERN)];
			expect(matches).toHaveLength(1);
		});

		it("should handle edge case: multiple refs in succession", () => {
			const text = "anthropics/acepe#123 vercel/nextjs#456 supabase/supabase#789";
			const matches = [...text.matchAll(GITHUB_PR_SHORTHAND_PATTERN)];
			expect(matches).toHaveLength(3);
		});
	});

	describe("Commit SHA Pattern (7-40 hex chars, not @prefixed)", () => {
		it("should match 7-character commit SHA", () => {
			const text = "abc1234 is the commit";
			const matches = [...text.matchAll(GITHUB_COMMIT_SHA_PATTERN)];
			expect(matches).toHaveLength(1);
			expect(matches[0][1]).toBe("abc1234");
		});

		it("should match full 40-character SHA", () => {
			const text = "abc1234567890123456789012345678901234567 is here";
			const matches = [...text.matchAll(GITHUB_COMMIT_SHA_PATTERN)];
			expect(matches).toHaveLength(1);
			expect(matches[0][1]).toHaveLength(40);
		});

		it("should NOT match 6-character SHA (too short)", () => {
			const text = "abc123 is too short";
			const matches = [...text.matchAll(GITHUB_COMMIT_SHA_PATTERN)];
			expect(matches).toHaveLength(0);
		});

		it("should NOT match @prefixed refs (those match git ref pattern)", () => {
			const text = "@abc1234 is a git ref, not a commit pattern";
			const matches = [...text.matchAll(GITHUB_COMMIT_SHA_PATTERN)];
			expect(matches).toHaveLength(0);
		});

		it("should match multiple SHAs in text", () => {
			const text = "Fixed in abc1234 and def5678 commits";
			const matches = [...text.matchAll(GITHUB_COMMIT_SHA_PATTERN)];
			expect(matches).toHaveLength(2);
		});

		it("should match SHA at word boundaries", () => {
			const text = "In abc1234, we changed...";
			const matches = [...text.matchAll(GITHUB_COMMIT_SHA_PATTERN)];
			expect(matches).toHaveLength(1);
		});

		it("should not match non-hex characters", () => {
			const text = "xyz12345 is not hex";
			const matches = [...text.matchAll(GITHUB_COMMIT_SHA_PATTERN)];
			expect(matches).toHaveLength(0);
		});
	});

	describe("Git Reference Pattern (@abc1234)", () => {
		it("should match @-prefixed 7-char SHA", () => {
			const text = "See @abc1234 for details";
			const matches = [...text.matchAll(GITHUB_GIT_REF_PATTERN)];
			expect(matches).toHaveLength(1);
			expect(matches[0][1]).toBe("abc1234");
		});

		it("should match @-prefixed full SHA", () => {
			const text = "@abc1234567890123456789012345678901234567";
			const matches = [...text.matchAll(GITHUB_GIT_REF_PATTERN)];
			expect(matches).toHaveLength(1);
			expect(matches[0][1]).toHaveLength(40);
		});

		it("should match multiple git refs", () => {
			const text = "Combined @abc1234 and @def5678";
			const matches = [...text.matchAll(GITHUB_GIT_REF_PATTERN)];
			expect(matches).toHaveLength(2);
		});

		it("should NOT match without @ prefix", () => {
			const text = "abc1234 without prefix";
			const matches = [...text.matchAll(GITHUB_GIT_REF_PATTERN)];
			expect(matches).toHaveLength(0);
		});
	});

	describe("GitHub URL Pattern", () => {
		it("should match commit URL", () => {
			const text = "https://github.com/anthropics/acepe/commit/abc1234";
			const matches = [...text.matchAll(GITHUB_URL_PATTERN)];
			expect(matches).toHaveLength(1);
			expect(matches[0][1]).toBe("anthropics");
			expect(matches[0][2]).toBe("acepe");
			expect(matches[0][3]).toBe("commit");
			expect(matches[0][4]).toBe("abc1234");
		});

		it("should match PR URL", () => {
			const text = "https://github.com/anthropics/acepe/pull/123";
			const matches = [...text.matchAll(GITHUB_URL_PATTERN)];
			expect(matches).toHaveLength(1);
			expect(matches[0][3]).toBe("pull");
			expect(matches[0][4]).toBe("123");
		});

		it("should match issue URL (issue singular)", () => {
			const text = "https://github.com/anthropics/acepe/issue/456";
			const matches = [...text.matchAll(GITHUB_URL_PATTERN)];
			expect(matches).toHaveLength(1);
			expect(matches[0][3]).toBe("issue");
		});

		it("should match issues URL (issues plural)", () => {
			const text = "https://github.com/anthropics/acepe/issues/789";
			const matches = [...text.matchAll(GITHUB_URL_PATTERN)];
			expect(matches).toHaveLength(1);
			expect(matches[0][3]).toBe("issues");
		});

		it("should match http (not just https)", () => {
			const text = "http://github.com/anthropics/acepe/commit/abc1234";
			const matches = [...text.matchAll(GITHUB_URL_PATTERN)];
			expect(matches).toHaveLength(1);
		});

		it("should match multiple URLs", () => {
			const text =
				"See https://github.com/anthropics/acepe/pull/123 and https://github.com/vercel/nextjs/issues/456";
			const matches = [...text.matchAll(GITHUB_URL_PATTERN)];
			expect(matches).toHaveLength(2);
		});

		it("should handle hyphens and underscores in owner/repo", () => {
			const text = "https://github.com/my-org/my_repo/pull/123";
			const matches = [...text.matchAll(GITHUB_URL_PATTERN)];
			expect(matches).toHaveLength(1);
			expect(matches[0][1]).toBe("my-org");
			expect(matches[0][2]).toBe("my_repo");
		});
	});
});

describe("GitHub Badge Detection - Parse Functions", () => {
	it("parsePRShorthand creates PR type reference", () => {
		const ref = parsePRShorthand("anthropics", "acepe", "123");
		expect(ref.type).toBe("pr");
	});

	it("parseCommitSHA creates commit type reference", () => {
		const ref = parseCommitSHA("abc1234");
		expect(ref.type).toBe("commit");
	});

	it("parseGitHubURL handles pull request URLs", () => {
		const ref = parseGitHubURL("anthropics", "acepe", "pull", "123");
		expect(ref.type).toBe("pr");
	});

	it("parseGitHubURL handles commit URLs", () => {
		const ref = parseGitHubURL("anthropics", "acepe", "commit", "abc1234");
		expect(ref.type).toBe("commit");
	});

	it("parseGitHubURL handles issue URLs (singular)", () => {
		const ref = parseGitHubURL("anthropics", "acepe", "issue", "456");
		expect(ref.type).toBe("issue");
	});

	it("parseGitHubURL handles issue URLs (plural)", () => {
		const ref = parseGitHubURL("anthropics", "acepe", "issues", "789");
		expect(ref.type).toBe("issue");
	});
});

describe("GitHub Badge Detection - URL Generation", () => {
	it("getGitHubURL generates correct PR URL", () => {
		const ref = { type: "pr" as const, owner: "anthropics", repo: "acepe", number: 123 };
		const url = getGitHubURL(ref);
		expect(url).toBe("https://github.com/anthropics/acepe/pull/123");
	});

	it("getGitHubURL generates correct commit URL with repo context", () => {
		const ref = {
			type: "commit" as const,
			sha: "abc1234567890123456789012345678901234567",
			owner: "anthropics",
			repo: "acepe",
		};
		const url = getGitHubURL(ref);
		expect(url).toBe(
			"https://github.com/anthropics/acepe/commit/abc1234567890123456789012345678901234567"
		);
	});

	it("getGitHubURL returns empty string for commit without repo context", () => {
		const ref = {
			type: "commit" as const,
			sha: "abc1234",
		};
		const url = getGitHubURL(ref);
		expect(url).toBe("");
	});

	it("getGitHubURL generates correct issue URL", () => {
		const ref = { type: "issue" as const, owner: "anthropics", repo: "acepe", number: 456 };
		const url = getGitHubURL(ref);
		expect(url).toBe("https://github.com/anthropics/acepe/issues/456");
	});
});

describe("GitHub Badge Detection - Label Generation", () => {
	it("getGitHubLabel returns correct PR label", () => {
		const ref = { type: "pr" as const, owner: "anthropics", repo: "acepe", number: 123 };
		const label = getGitHubLabel(ref);
		expect(label).toBe("anthropics/acepe#123");
	});

	it("getGitHubLabel returns short SHA for commits", () => {
		const ref = {
			type: "commit" as const,
			sha: "abc1234567890123456789012345678901234567",
		};
		const label = getGitHubLabel(ref);
		expect(label).toBe("abc1234");
	});

	it("getGitHubLabel returns correct issue label", () => {
		const ref = { type: "issue" as const, owner: "anthropics", repo: "acepe", number: 789 };
		const label = getGitHubLabel(ref);
		expect(label).toBe("anthropics/acepe#789");
	});
});

describe("GitHub Badge Detection - HTML Generation", () => {
	it("createGitHubBadgeHtml generates button for PR with URL", () => {
		const ref = { type: "pr" as const, owner: "anthropics", repo: "acepe", number: 123 };
		const html = createGitHubBadgeHtml(ref);
		expect(html).toContain('class="github-badge"');
		expect(html).toContain('data-github-type="pr"');
		expect(html).toContain("https://github.com/anthropics/acepe/pull/123");
		expect(html).toContain("anthropics/acepe#123");
	});

	it("createGitHubBadgeHtml adds repo context to commit refs", () => {
		const ref = { type: "commit" as const, sha: "abc1234" };
		const repoContext = { owner: "anthropics", repo: "acepe" };
		const html = createGitHubBadgeHtml(ref, repoContext);
		expect(html).toContain("https://github.com/anthropics/acepe/commit/abc1234");
		expect(html).toContain('data-github-type="commit"');
	});

	it("createGitHubBadgeHtml generates span for commit without repo context", () => {
		const ref = { type: "commit" as const, sha: "abc1234" };
		const html = createGitHubBadgeHtml(ref);
		expect(html).toContain("<span");
		expect(html).not.toContain("https://github.com");
		expect(html).toContain("abc1234");
	});

	it("createGitHubBadgeHtml does not include external link", () => {
		const ref = { type: "pr" as const, owner: "anthropics", repo: "acepe", number: 123 };
		const html = createGitHubBadgeHtml(ref);
		expect(html).not.toContain('class="github-external-link"');
		expect(html).not.toContain('target="_blank"');
	});

	it("createGitHubBadgeHtml includes data attributes for click handling", () => {
		const ref = { type: "pr" as const, owner: "anthropics", repo: "acepe", number: 123 };
		const html = createGitHubBadgeHtml(ref);
		expect(html).toContain('data-github-url="');
		expect(html).toContain('data-github-ref="');
	});

	it("createGitHubBadgeHtml escapes JSON quotes in data attributes", () => {
		const ref = { type: "pr" as const, owner: "anthropics", repo: "acepe", number: 123 };
		const html = createGitHubBadgeHtml(ref);
		// JSON should be escaped
		expect(html).toContain("&quot;");
	});

	it("createGitHubBadgeHtml handles issue references", () => {
		const ref = { type: "issue" as const, owner: "anthropics", repo: "acepe", number: 456 };
		const html = createGitHubBadgeHtml(ref);
		expect(html).toContain('data-github-type="issue"');
		expect(html).toContain("https://github.com/anthropics/acepe/issues/456");
	});
});

describe("GitHub Badge Detection - Edge Cases", () => {
	it("should handle PR number 1", () => {
		const ref = parsePRShorthand("owner", "repo", "1");
		expect(ref.type).toBe("pr");
	});

	it("should handle very large PR numbers", () => {
		const ref = parsePRShorthand("owner", "repo", "999999");
		expect(ref.type).toBe("pr");
	});

	it("should handle repos with numbers", () => {
		const text = "anthropics/acepe-v2#123";
		const matches = [...text.matchAll(GITHUB_PR_SHORTHAND_PATTERN)];
		expect(matches).toHaveLength(1);
		expect(matches[0][2]).toBe("acepe-v2");
	});

	it("should handle mixed case (pattern is case-sensitive for hex, case-insensitive for urls)", () => {
		const text = "ABC1234 is uppercase";
		const matches = [...text.matchAll(GITHUB_COMMIT_SHA_PATTERN)];
		// Should match lowercase a-f only
		expect(matches).toHaveLength(0);
	});

	it("should handle commit SHAs in URLs with mixed case", () => {
		const text = "https://github.com/anthropics/acepe/commit/abc1234DEFGH";
		const matches = [...text.matchAll(GITHUB_URL_PATTERN)];
		expect(matches).toHaveLength(1);
	});
});
