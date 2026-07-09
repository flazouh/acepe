import { describe, expect, it } from "vitest";
import type { IndexedFile } from "$lib/services/converted-session-types.js";

import {
	createProjectFileSystemTreeModel,
	mapFileIndexStatusToPierreStatus,
} from "../project-file-system-tree-model.js";

function indexedFile(
	path: string,
	status: string | null,
	insertions = 0,
	deletions = 0
): IndexedFile {
	return {
		path,
		extension: path.split(".").pop() ?? "",
		lineCount: 10,
		gitStatus: status
			? {
					path,
					status,
					insertions,
					deletions,
				}
			: null,
	};
}

describe("project-file-system-tree-model", () => {
	it("maps indexed files to Pierre paths and first selectable file", () => {
		const model = createProjectFileSystemTreeModel([
			indexedFile("src/app.ts", null),
			indexedFile("src/lib/util.ts", null),
		]);

		expect(model.paths).toEqual(["src/app.ts", "src/lib/util.ts"]);
		expect(model.firstFilePath).toBe("src/app.ts");
		expect(model.filesByPath.get("src/lib/util.ts")?.lineCount).toBe(10);
	});

	it("maps file index status codes to Pierre git statuses", () => {
		expect(mapFileIndexStatusToPierreStatus("M")).toBe("modified");
		expect(mapFileIndexStatusToPierreStatus("A")).toBe("added");
		expect(mapFileIndexStatusToPierreStatus("?")).toBe("untracked");
		expect(mapFileIndexStatusToPierreStatus("D")).toBe("deleted");
		expect(mapFileIndexStatusToPierreStatus("R")).toBe("renamed");
		expect(mapFileIndexStatusToPierreStatus("X")).toBeNull();
	});

	it("adds file and directory git status with aggregate diff decorations", () => {
		const model = createProjectFileSystemTreeModel([
			indexedFile("src/app.ts", "M", 3, 1),
			indexedFile("src/lib/util.ts", "A", 2, 0),
		]);

		expect(model.gitStatus).toEqual([
			{ path: "src/app.ts", status: "modified" },
			{ path: "src/lib/util.ts", status: "added" },
			{ path: "src", status: "modified" },
			{ path: "src/lib", status: "modified" },
		]);
		expect(model.decorationsByPath.get("src/app.ts")).toEqual({
			text: "+3 -1",
			title: "src/app.ts: 3 additions, 1 deletion",
		});
		expect(model.decorationsByPath.get("src")).toEqual({
			text: "+5 -1",
			title: "src: 5 additions, 1 deletion",
		});
	});

	it("omits null git status entries and zero diff decorations", () => {
		const model = createProjectFileSystemTreeModel([
			indexedFile("README.md", null),
			indexedFile("src/no-counts.ts", "M", 0, 0),
		]);

		expect(model.gitStatus).toEqual([
			{ path: "src/no-counts.ts", status: "modified" },
			{ path: "src", status: "modified" },
		]);
		expect(model.decorationsByPath.has("README.md")).toBe(false);
		expect(model.decorationsByPath.has("src/no-counts.ts")).toBe(false);
	});
});
