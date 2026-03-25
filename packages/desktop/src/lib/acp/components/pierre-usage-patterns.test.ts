import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
	return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("Pierre usage patterns", () => {
	it("reuses FileDiff instances in all diff renderers", () => {
		const pierreDiffView = readSource(
			"src/lib/acp/components/diff-viewer/pierre-diff-view.svelte"
		);
		const checkpointDiffPreview = readSource(
			"src/lib/acp/components/checkpoint/checkpoint-diff-preview.svelte"
		);
		const fileExplorerPreview = readSource(
			"src/lib/acp/components/file-explorer-modal/file-explorer-preview-pane.svelte"
		);
		const reviewDiffState = readSource(
			"src/lib/acp/components/modified-files/components/review-diff-view-state.svelte.ts"
		);

		expect(pierreDiffView).toContain("fileDiffInstance.setOptions(");
		expect(pierreDiffView).not.toContain("await registerCursorThemeForPierreDiffs();");
		expect(checkpointDiffPreview).toContain("diffInstance.setOptions(");
		expect(fileExplorerPreview).toContain("buildPierreDiffOptions");
		expect(reviewDiffState).toContain("this.fileDiffInstance.setOptions(");
	});

	it("reuses File instances and syncs theme in code file viewers", () => {
		const fileViewState = readSource("src/lib/components/ui/code-block/file-view.svelte.ts");
		const fileView = readSource("src/lib/components/ui/code-block/file-view.svelte");
		const filePreview = readSource("src/lib/acp/components/file-picker/file-preview.svelte");
		const filePanelReadView = readSource(
			"src/lib/acp/components/file-panel/file-panel-read-view.svelte"
		);

		expect(fileViewState).toContain("this.fileInstance.setOptions(");
		expect(fileViewState).toContain("setThemeType(");
		expect(fileView).toContain("useTheme()");
		expect(fileView).toContain("fileViewState.setThemeType(theme)");
		expect(filePreview).toContain("fileInstance.setOptions(");
		expect(filePreview).toContain("fileInstance.setThemeType(");
		expect(filePanelReadView).toContain("fileInstance.setOptions(");
		expect(filePanelReadView).toContain("diffInstance.setOptions(");
	});
	});
