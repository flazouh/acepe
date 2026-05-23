import { describe, expect, it } from "bun:test";

import {
	getFilePanelGitStats,
	resolveFilePanelGitStatus,
	toFilePanelGitStatus,
} from "./file-panel-git-status.js";

function status(path: string, insertions: number, deletions: number) {
	return {
		path,
		status: "M",
		insertions,
		deletions,
	};
}

describe("file panel git status logic", () => {
	it("resolves absolute file paths against project-relative git status keys", () => {
		const statusMap = new Map([["src/app.ts", status("src/app.ts", 4, 1)]]);

		expect(resolveFilePanelGitStatus(statusMap, "/repo/src/app.ts", "/repo")).toEqual(
			status("src/app.ts", 4, 1)
		);
	});

	it("does not scan the whole status map when a file has no git status", () => {
		const statusMap = new Map([["src/other.ts", status("src/other.ts", 4, 1)]]);
		statusMap.values = () => {
			throw new Error("must not scan every git status");
		};

		expect(resolveFilePanelGitStatus(statusMap, "/repo/src/app.ts", "/repo")).toBeNull();
	});

	it("returns zero stats when the file has no git status", () => {
		expect(getFilePanelGitStats(new Map(), "src/app.ts", "/repo")).toEqual({
			added: 0,
			removed: 0,
		});
	});

	it("narrows status data to the file panel header contract", () => {
		expect(toFilePanelGitStatus(status("src/app.ts", 7, 2))).toEqual({
			status: "M",
			insertions: 7,
			deletions: 2,
		});
	});
});
