import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(__dirname, "./file-explorer-preview-pane.svelte"), "utf8");

describe("file explorer preview pane performance integration", () => {
	it("memoizes theme registration instead of awaiting it on every render", () => {
		expect(source).toContain("ensurePierreThemeRegistered()");
		expect(source).not.toContain("await registerCursorThemeForPierreDiffs();");
	});

	it("reuses the FileDiff instance rather than recreating it for every preview", () => {
		expect(source).toContain("fileDiffInstance = new FileDiff");
		expect(source).toContain("fileDiffInstance.setOptions(");
		expect(source).toContain("fileDiffInstance.render({");
		expect(source).not.toContain("if (fileDiffInstance) {\n\t\tfileDiffInstance.cleanUp();");
	});

	it("captures render timing for parse and render phases", () => {
		expect(source).toContain("performance.now()");
		expect(source).toContain("parseElapsedMs");
		expect(source).toContain("renderElapsedMs");
	});
});
