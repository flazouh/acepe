import { describe, expect, it } from "bun:test";

import type { FileDiff } from "../../types/github-integration.js";

import {
	buildSideBySideDiffViewState,
	getSideBySideDiffLanguage,
} from "./side-by-side-diff-view-state.js";

function makeDiff(overrides: Partial<FileDiff> = {}): FileDiff {
	return {
		path: "src/file.ts",
		status: "modified",
		additions: 1,
		deletions: 1,
		patch: `--- a/src/file.ts
+++ b/src/file.ts
@@ -1 +1 @@
-old
+new`,
		...overrides,
	};
}

describe("side-by-side-diff-view-state", () => {
	it("builds split content for modified files", () => {
		const state = buildSideBySideDiffViewState(makeDiff());

		expect(state.mode).toBe("split");
		expect(state.before).toContain("old");
		expect(state.after).toContain("new");
		expect(state.language).toBe("typescript");
	});

	it("uses added mode for new files", () => {
		const state = buildSideBySideDiffViewState(
			makeDiff({
				status: "added",
				patch: `--- /dev/null
+++ b/src/file.ts
@@ -0,0 +1 @@
+created`,
			})
		);

		expect(state.mode).toBe("added");
		expect(state.before).toBe("");
		expect(state.after).toContain("created");
	});

	it("uses deleted mode for removed files", () => {
		const state = buildSideBySideDiffViewState(
			makeDiff({
				status: "deleted",
				patch: `--- a/src/file.ts
+++ /dev/null
@@ -1 +0,0 @@
-removed`,
			})
		);

		expect(state.mode).toBe("deleted");
		expect(state.before).toContain("removed");
		expect(state.after).toBe("");
	});

	it("uses binary mode without display content for binary patches", () => {
		const state = buildSideBySideDiffViewState(
			makeDiff({
				path: "image.png",
				patch: "Binary files a/image.png and b/image.png differ",
			})
		);

		expect(state.mode).toBe("binary");
		expect(state.before).toBe("");
		expect(state.after).toBe("");
		expect(state.language).toBeUndefined();
	});

	it("maps known filename extensions to display languages", () => {
		expect(getSideBySideDiffLanguage("Component.svelte")).toBe("svelte");
		expect(getSideBySideDiffLanguage("config.yaml")).toBe("yaml");
		expect(getSideBySideDiffLanguage("README.md")).toBe("markdown");
		expect(getSideBySideDiffLanguage("Makefile")).toBeUndefined();
	});
});
