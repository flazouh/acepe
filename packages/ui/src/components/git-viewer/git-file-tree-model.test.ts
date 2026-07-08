import { describe, expect, it } from "bun:test";

import {
	createGitFileTreeDiffDecoration,
	createGitFileTreeModel,
	mapGitViewerStatusToPierreStatus,
} from "./git-file-tree-model.js";
import type { GitViewerFile } from "./types.js";

function file(path: string, status: GitViewerFile["status"]): GitViewerFile {
	return {
		path,
		status,
		additions: 2,
		deletions: 1,
	};
}

describe("git-file-tree-model", () => {
	it("maps files to Pierre paths and git status entries", () => {
		const model = createGitFileTreeModel([
			file("src/app.ts", "modified"),
			file("src/new.ts", "added"),
		]);

		expect(model.paths).toEqual(["src/app.ts", "src/new.ts"]);
		expect(model.gitStatus).toEqual([
			{ path: "src/app.ts", status: "modified" },
			{ path: "src/new.ts", status: "added" },
		]);
		expect(model.filesByPath.get("src/app.ts")?.status).toBe("modified");
	});

	it("maps every Git viewer status to a Pierre status", () => {
		expect(mapGitViewerStatusToPierreStatus("added")).toBe("added");
		expect(mapGitViewerStatusToPierreStatus("deleted")).toBe("deleted");
		expect(mapGitViewerStatusToPierreStatus("modified")).toBe("modified");
		expect(mapGitViewerStatusToPierreStatus("renamed")).toBe("renamed");
	});

	it("formats compact diff decorations with an accessible title", () => {
		const decoration = createGitFileTreeDiffDecoration({
			path: "src/app.ts",
			status: "modified",
			additions: 1,
			deletions: 3,
		});

		expect(decoration).toEqual({
			text: "+1 -3",
			title: "src/app.ts: 1 addition, 3 deletions",
		});
	});
});
