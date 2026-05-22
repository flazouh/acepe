import { describe, expect, it } from "bun:test";

import {
	canShowFileTreeItemActions,
	getFileTreeItemFullPath,
	getFileTreeItemIndentPx,
	getFileTreeItemNameColor,
	getFileTreeItemParentPath,
	getFileTreeItemRenameSubmission,
	hasFileTreeItemDiff,
	shouldShowFileTreeItemDuplicate,
} from "./file-tree-item-state.js";

describe("file tree item state", () => {
	it("builds full paths from project and node paths", () => {
		expect(
			getFileTreeItemFullPath({
				projectPath: "/repo/",
				nodePath: "src/app.ts",
			})
		).toBe("/repo/src/app.ts");
		expect(
			getFileTreeItemFullPath({
				projectPath: "/repo",
				nodePath: "",
			})
		).toBe("/repo");
	});

	it("resolves parent paths for files and directories", () => {
		expect(getFileTreeItemParentPath({ path: "src/lib", isDirectory: true })).toBe(
			"src/lib"
		);
		expect(getFileTreeItemParentPath({ path: "src/app.ts", isDirectory: false })).toBe(
			"src"
		);
		expect(getFileTreeItemParentPath({ path: "app.ts", isDirectory: false })).toBe("");
	});

	it("uses a stable indent from depth", () => {
		expect(getFileTreeItemIndentPx(0)).toBe(0);
		expect(getFileTreeItemIndentPx(3)).toBe(36);
	});

	it("maps git status to file name colors", () => {
		expect(
			getFileTreeItemNameColor({
				isDirectory: true,
				hasModifiedDescendants: true,
			})
		).toBe("#E2BF8D");
		expect(
			getFileTreeItemNameColor({
				isDirectory: false,
				gitStatus: { status: "A", insertions: 1, deletions: 0 },
			})
		).toBe("var(--success)");
		expect(
			getFileTreeItemNameColor({
				isDirectory: false,
				gitStatus: { status: "D", insertions: 0, deletions: 1 },
			})
		).toBe("#FF5D5A");
		expect(getFileTreeItemNameColor({ isDirectory: false, gitStatus: null })).toBeNull();
	});

	it("detects diff pills only when line counts are present", () => {
		expect(
			hasFileTreeItemDiff({
				gitStatus: { status: "M", insertions: 1, deletions: 0 },
			})
		).toBe(true);
		expect(
			hasFileTreeItemDiff({
				gitStatus: { status: "M", insertions: 0, deletions: 0 },
			})
		).toBe(false);
		expect(hasFileTreeItemDiff({ gitStatus: null })).toBe(false);
	});

	it("hides actions while renaming and shows them when callbacks exist", () => {
		expect(
			canShowFileTreeItemActions({
				isRenaming: true,
				onCopyPath: () => {},
			})
		).toBe(false);
		expect(
			canShowFileTreeItemActions({
				isRenaming: false,
				onCopyPath: () => {},
			})
		).toBe(true);
		expect(canShowFileTreeItemActions({ isRenaming: false })).toBe(false);
	});

	it("only shows duplicate for files", () => {
		expect(
			shouldShowFileTreeItemDuplicate({
				onDuplicate: () => {},
				isDirectory: false,
			})
		).toBe(true);
		expect(
			shouldShowFileTreeItemDuplicate({
				onDuplicate: () => {},
				isDirectory: true,
			})
		).toBe(false);
	});

	it("normalizes rename submissions", () => {
		expect(
			getFileTreeItemRenameSubmission({
				renameInput: " app.ts ",
				currentName: "old.ts",
			})
		).toBe("app.ts");
		expect(
			getFileTreeItemRenameSubmission({
				renameInput: " old.ts ",
				currentName: "old.ts",
			})
		).toBeNull();
		expect(
			getFileTreeItemRenameSubmission({
				renameInput: "   ",
				currentName: "old.ts",
			})
		).toBeNull();
	});
});
