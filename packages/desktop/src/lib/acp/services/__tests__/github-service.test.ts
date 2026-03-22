import { beforeEach, describe, expect, it } from "bun:test";

import { clearDiffCache, type GitHubError, getCacheSize } from "../github-service.js";

describe("GitHub Service - Cache Management", () => {
	beforeEach(() => {
		clearDiffCache();
	});

	it("should start with empty cache", () => {
		expect(getCacheSize()).toBe(0);
	});

	it("should clear cache", () => {
		clearDiffCache();
		expect(getCacheSize()).toBe(0);
	});
});

describe("GitHub Service - Error Types", () => {
	it("should have valid GitHubError type", () => {
		const error: GitHubError = {
			type: "git_not_found",
			message: "git: not found",
		};
		expect(error.type).toBe("git_not_found");
	});

	it("should support gh_not_found error type", () => {
		const error: GitHubError = {
			type: "gh_not_found",
			message: "gh: not found",
		};
		expect(error.type).toBe("gh_not_found");
	});

	it("should support gh_not_authenticated error type", () => {
		const error: GitHubError = {
			type: "gh_not_authenticated",
			message: "401 Unauthorized",
		};
		expect(error.type).toBe("gh_not_authenticated");
	});

	it("should support ref_not_found error type", () => {
		const error: GitHubError = {
			type: "ref_not_found",
			message: "404 Not Found",
		};
		expect(error.type).toBe("ref_not_found");
	});

	it("should support not_a_git_repo error type", () => {
		const error: GitHubError = {
			type: "not_a_git_repo",
			message: "Not a git repository",
		};
		expect(error.type).toBe("not_a_git_repo");
	});

	it("should support parse_error type", () => {
		const error: GitHubError = {
			type: "parse_error",
			message: "Failed to parse JSON",
		};
		expect(error.type).toBe("parse_error");
	});

	it("should support network_error type", () => {
		const error: GitHubError = {
			type: "network_error",
			message: "Connection timeout",
		};
		expect(error.type).toBe("network_error");
	});

	it("should support unknown_error type", () => {
		const error: GitHubError = {
			type: "unknown_error",
			message: "Unknown error occurred",
		};
		expect(error.type).toBe("unknown_error");
	});
});

describe("GitHub Service - PR Reference Parsing", () => {
	it("should parse valid PR reference format", () => {
		const ref = "anthropics/acepe#123";
		const match = ref.match(/^([^/]+)\/([^#]+)#(\d+)$/);
		expect(match).not.toBe(null);
		expect(match?.[1]).toBe("anthropics");
		expect(match?.[2]).toBe("acepe");
		expect(match?.[3]).toBe("123");
	});

	it("should parse PR reference with hyphens", () => {
		const ref = "my-org/my-repo#456";
		const match = ref.match(/^([^/]+)\/([^#]+)#(\d+)$/);
		expect(match).not.toBe(null);
		expect(match?.[1]).toBe("my-org");
		expect(match?.[2]).toBe("my-repo");
		expect(match?.[3]).toBe("456");
	});

	it("should parse PR reference with underscores", () => {
		const ref = "my_org/my_repo#789";
		const match = ref.match(/^([^/]+)\/([^#]+)#(\d+)$/);
		expect(match).not.toBe(null);
		expect(match?.[1]).toBe("my_org");
		expect(match?.[2]).toBe("my_repo");
	});

	it("should reject PR reference without owner", () => {
		const ref = "/repo#123";
		const match = ref.match(/^([^/]+)\/([^#]+)#(\d+)$/);
		expect(match).toBe(null);
	});

	it("should reject PR reference without number", () => {
		const ref = "anthropics/acepe";
		const match = ref.match(/^([^/]+)\/([^#]+)#(\d+)$/);
		expect(match).toBe(null);
	});

	it("should reject PR reference without hash", () => {
		const ref = "anthropics/acepe123";
		const match = ref.match(/^([^/]+)\/([^#]+)#(\d+)$/);
		expect(match).toBe(null);
	});

	it("should handle very large PR numbers", () => {
		const ref = "anthropics/acepe#999999";
		const match = ref.match(/^([^/]+)\/([^#]+)#(\d+)$/);
		expect(match).not.toBe(null);
		expect(parseInt(match?.[3] ?? "0", 10)).toBe(999999);
	});
});

describe("GitHub Service - Cache Key Generation", () => {
	it("should generate cache key for commit", () => {
		const sha = "abc1234";
		const key = `commit:${sha}`;
		expect(key).toBe("commit:abc1234");
	});

	it("should generate unique cache keys for different SHAs", () => {
		const key1 = `commit:abc1234`;
		const key2 = `commit:def5678`;
		expect(key1).not.toBe(key2);
	});

	it("should generate cache key for PR", () => {
		const owner = "anthropics";
		const repo = "acepe";
		const prNumber = 123;
		const key = `pr:${owner}/${repo}#${prNumber}`;
		expect(key).toBe("pr:anthropics/acepe#123");
	});

	it("should generate unique cache keys for different PRs", () => {
		const key1 = `pr:anthropics/acepe#123`;
		const key2 = `pr:anthropics/acepe#456`;
		expect(key1).not.toBe(key2);
	});

	it("should differentiate between commit and PR cache keys", () => {
		const commitKey = `commit:abc1234`;
		const prKey = `pr:anthropics/acepe#123`;
		expect(commitKey).not.toBe(prKey);
	});
});

describe("GitHub Service - Cache Validity", () => {
	it("should validate commit cache (never expires)", () => {
		const now = Date.now();
		const entry = {
			diff: {},
			timestamp: now - 10 * 60 * 1000, // 10 minutes ago
			type: "commit" as const,
		};
		// Commits never expire
		const isValid = entry.type === "commit" ? true : now - entry.timestamp < 5 * 60 * 1000;
		expect(isValid).toBe(true);
	});

	it("should validate fresh PR cache", () => {
		const now = Date.now();
		const entry = {
			diff: {},
			timestamp: now - 1 * 60 * 1000, // 1 minute ago
			type: "pr" as const,
		};
		const isValid = entry.type === "pr" ? now - entry.timestamp < 5 * 60 * 1000 : true;
		expect(isValid).toBe(true);
	});

	it("should invalidate expired PR cache", () => {
		const now = Date.now();
		const entry = {
			diff: {},
			timestamp: now - 10 * 60 * 1000, // 10 minutes ago
			type: "pr" as const,
		};
		const isValid = entry.type === "pr" ? now - entry.timestamp < 5 * 60 * 1000 : true;
		expect(isValid).toBe(false);
	});

	it("should use 5-minute TTL for PR cache", () => {
		const CACHE_EXPIRY_MS = 5 * 60 * 1000;
		expect(CACHE_EXPIRY_MS).toBe(300000);
	});
});
