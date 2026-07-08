import { describe, expect, it } from "vitest";

import {
	createReviewWorkspaceTreeDecoration,
	createReviewWorkspaceTreeModel,
} from "./review-workspace-tree-model.js";
import type { ReviewWorkspaceFileItem } from "./types.js";

function createFiles(): ReviewWorkspaceFileItem[] {
	return [
		{
			id: "file-1",
			filePath: "src/lib/alpha.ts",
			fileName: "alpha.ts",
			reviewStatus: "reviewed",
			additions: 12,
			deletions: 2,
		},
		{
			id: "file-2",
			filePath: "src/lib/beta.ts",
			fileName: "beta.ts",
			reviewStatus: "unreviewed",
			additions: 3,
			deletions: 1,
		},
	];
}

describe("createReviewWorkspaceTreeModel", () => {
	it("maps review files to Pierre tree paths and selected path", () => {
		const model = createReviewWorkspaceTreeModel(createFiles(), 1);

		expect(model.paths).toEqual(["src/lib/alpha.ts", "src/lib/beta.ts"]);
		expect(model.selectedPath).toBe("src/lib/beta.ts");
		expect(model.initialExpandedPaths).toEqual(["src/", "src/lib/"]);
	});

	it("keeps the file index lookup for tree selection callbacks", () => {
		const model = createReviewWorkspaceTreeModel(createFiles(), 0);

		expect(model.filesByPath.get("src/lib/beta.ts")?.index).toBe(1);
		expect(model.filesByPath.get("src/lib/beta.ts")?.file.id).toBe("file-2");
	});

	it("uses a null selected path when the selected index is invalid", () => {
		const model = createReviewWorkspaceTreeModel(createFiles(), 99);

		expect(model.selectedPath).toBeNull();
	});

	it("adds review status and diff details as row decorations", () => {
		const model = createReviewWorkspaceTreeModel(createFiles(), 0);

		expect(model.decorationsByPath.get("src/lib/alpha.ts")).toEqual({
			text: "Reviewed +12 -2",
			title: "src/lib/alpha.ts: Reviewed, 12 additions, 2 deletions",
		});
		expect(model.decorationsByPath.get("src/lib/beta.ts")).toEqual({
			text: "Needs review +3 -1",
			title: "src/lib/beta.ts: Needs review, 3 additions, 1 deletion",
		});
	});
});

describe("createReviewWorkspaceTreeDecoration", () => {
	it("keeps zero-diff files readable", () => {
		const decoration = createReviewWorkspaceTreeDecoration({
			id: "file-1",
			filePath: "README.md",
			fileName: "README.md",
			reviewStatus: "unreviewed",
			additions: 0,
			deletions: 0,
		});

		expect(decoration).toEqual({
			text: "Needs review",
			title: "README.md: Needs review, 0 additions, 0 deletions",
		});
	});
});
