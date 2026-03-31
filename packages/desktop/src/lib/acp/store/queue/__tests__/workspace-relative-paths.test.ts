/**
 * Tests for workspace-relative path display (privacy/security feature).
 * Verifies that absolute paths are converted to workspace-relative paths
 * to prevent disclosure of usernames and system structure.
 */

import { describe, expect, it } from "bun:test";

import { makeWorkspaceRelative } from "../../../utils/path-utils.js";

describe("Workspace-Relative Path Privacy", () => {
	describe("makeWorkspaceRelative function", () => {
		const workspaceRoot = "/Users/alice/Projects/acepe";

		it("should remove workspace root prefix from absolute paths", () => {
			const absolutePath = "/Users/alice/Projects/acepe/packages/desktop/src/lib/utils.ts";
			const result = makeWorkspaceRelative(absolutePath, workspaceRoot);

			expect(result).toBe("packages/desktop/src/lib/utils.ts");
			// Username "alice" is no longer visible
			expect(result).not.toContain("alice");
			expect(result).not.toContain("/Users/");
		});

		it("should handle paths with trailing slash in workspace root", () => {
			const absolutePath = "/Users/alice/Projects/acepe/packages/desktop/src/lib/utils.ts";
			const rootWithSlash = "/Users/alice/Projects/acepe/";
			const result = makeWorkspaceRelative(absolutePath, rootWithSlash);

			expect(result).toBe("packages/desktop/src/lib/utils.ts");
		});

		it("should handle paths without trailing slash", () => {
			const absolutePath = "/Users/bob/work/project/src/main.ts";
			const workspaceRoot = "/Users/bob/work/project";
			const result = makeWorkspaceRelative(absolutePath, workspaceRoot);

			expect(result).toBe("src/main.ts");
			expect(result).not.toContain("bob");
		});

		it("should show only filename for files outside workspace (privacy)", () => {
			const outsidePath = "/etc/config/secrets.txt";
			const result = makeWorkspaceRelative(outsidePath, workspaceRoot);

			expect(result).toBe("secrets.txt");
			// System path is hidden
			expect(result).not.toContain("/etc/");
		});

		it("should handle root-level files in workspace", () => {
			const rootFile = "/Users/alice/Projects/acepe/README.md";
			const result = makeWorkspaceRelative(rootFile, workspaceRoot);

			expect(result).toBe("README.md");
		});

		it("should handle deeply nested paths", () => {
			const deepPath =
				"/Users/alice/Projects/acepe/packages/desktop/src/lib/acp/components/queue/queue-item.svelte";
			const result = makeWorkspaceRelative(deepPath, workspaceRoot);

			expect(result).toBe("packages/desktop/src/lib/acp/components/queue/queue-item.svelte");
			expect(result).not.toContain("alice");
		});
	});

	describe("Privacy benefits", () => {
		it("hides username from home directory paths", () => {
			const userPath = "/Users/sensitive-username/Documents/project/src/api-keys.ts";
			const workspace = "/Users/sensitive-username/Documents/project";
			const result = makeWorkspaceRelative(userPath, workspace);

			expect(result).toBe("src/api-keys.ts");
			expect(result).not.toContain("sensitive-username");
		});

		it("hides system structure from paths", () => {
			const systemPath = "/home/admin/.config/app/credentials.json";
			const workspace = "/home/admin/projects/myapp";
			const result = makeWorkspaceRelative(systemPath, workspace);

			// Outside workspace - only filename shown
			expect(result).toBe("credentials.json");
			expect(result).not.toContain("/home/");
			expect(result).not.toContain("admin");
			expect(result).not.toContain(".config");
		});

		it("produces shorter, cleaner paths", () => {
			const longAbsolute =
				"/Users/example/Documents/projects/client-work/acepe/packages/desktop/src/lib/components/ui/button.svelte";
			const workspace = "/Users/example/Documents/projects/client-work/acepe";
			const result = makeWorkspaceRelative(longAbsolute, workspace);

			expect(result).toBe("packages/desktop/src/lib/components/ui/button.svelte");
			expect(result.length).toBeLessThan(longAbsolute.length);
		});
	});

	describe("Queue file path display", () => {
		it("should use relative paths when displaying file tools", () => {
			const absolutePath = "/Users/alice/Projects/acepe/packages/desktop/src/lib/utils.ts";
			const workspace = "/Users/alice/Projects/acepe";
			const relativePath = makeWorkspaceRelative(absolutePath, workspace);

			expect(relativePath).toBe("packages/desktop/src/lib/utils.ts");
			expect(relativePath).not.toContain("alice");
			// Queue item applies makeWorkspaceRelative to getToolKindFilePath result
		});

		it("documents that relative paths prevent username disclosure", () => {
			// This test serves as documentation:
			//
			// PRIVACY PROTECTION STRATEGY:
			// 1. getToolKindFilePath returns raw path from tool call
			// 2. queue-item applies makeWorkspaceRelative before display
			// 3. Component displays relative path (no username/system structure visible)
			// 4. For files outside workspace, show only filename (maximum privacy)
			//
			// BENEFITS:
			// - Hides username from home directory paths (/Users/alice → packages/...)
			// - Hides system structure (/etc/config → filename only)
			// - Shorter, cleaner paths in UI
			// - Safe for screen sharing and screenshots

			const beforePath = "/Users/sensitive-user/confidential-project/src/secrets.ts";
			const workspace = "/Users/sensitive-user/confidential-project";
			const afterPath = makeWorkspaceRelative(beforePath, workspace);

			// Before: exposes "sensitive-user" and "confidential-project" in full path
			expect(beforePath).toContain("sensitive-user");
			expect(beforePath).toContain("confidential-project");

			// After: only shows workspace-relative path
			expect(afterPath).toBe("src/secrets.ts");
			expect(afterPath).not.toContain("sensitive-user");
			// Note: "confidential-project" is part of workspace, so it's intentionally hidden
		});
	});
});
