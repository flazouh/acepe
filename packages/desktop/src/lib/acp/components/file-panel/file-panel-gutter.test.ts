import { describe, expect, it } from "bun:test";

import { resolveFilePanelGutterAction } from "./file-panel-gutter.js";

function gitStatus(status: string) {
	return {
		status,
		insertions: 1,
		deletions: 0,
	};
}

describe("file panel gutter logic", () => {
	it("waits for content before asking for gutter work", () => {
		expect(
			resolveFilePanelGutterAction({
				content: null,
				gitStatus: gitStatus("M"),
			})
		).toEqual({ kind: "none", reason: "missing-content" });
	});

	it("does not ask for gutter work without git status", () => {
		expect(
			resolveFilePanelGutterAction({
				content: "const answer = 42;\n",
				gitStatus: null,
			})
		).toEqual({ kind: "none", reason: "missing-git-status" });
	});

	it("uses new-file gutter mode for added and untracked files", () => {
		for (const status of ["A", "?", "??"]) {
			expect(
				resolveFilePanelGutterAction({
					content: "const answer = 42;\n",
					gitStatus: gitStatus(status),
				})
			).toEqual({ kind: "new-file" });
		}
	});

	it("loads old content only for modified files", () => {
		for (const status of ["M", "MM"]) {
			expect(
				resolveFilePanelGutterAction({
					content: "const answer = 42;\n",
					gitStatus: gitStatus(status),
				})
			).toEqual({ kind: "load-modified-diff" });
		}
	});

	it("skips unsupported statuses", () => {
		expect(
			resolveFilePanelGutterAction({
				content: "const answer = 42;\n",
				gitStatus: gitStatus("D"),
			})
		).toEqual({ kind: "none", reason: "unsupported-status" });
	});
});
