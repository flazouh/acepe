import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(__dirname, "./agent-panel.svelte"), "utf8");

describe("agent panel: Open PR button visibility during loading", () => {
	it("keeps onCreatePr defined while createPrRunning is true so the button shows its loading state", () => {
		// The onCreatePr prop controls whether the Open PR button renders at all.
		// When createPrRunning is true, the button should stay visible (showing its
		// built-in loading spinner via createPrLoading), not vanish.
		// Only createdPr (a completed PR) should suppress the button.
		expect(source).not.toContain(
			"onCreatePr={createdPr || createPrRunning ? undefined"
		);
	});

	it("suppresses onCreatePr only when a PR has been created (createdPr is set)", () => {
		// The button should disappear once a PR exists, replaced by PrStatusCard.
		expect(source).toContain("onCreatePr={createdPr ? undefined");
	});
});

describe("agent panel: merge button wired through ModifiedFilesHeader", () => {
	it("passes onMerge to ModifiedFilesHeader instead of PrStatusCard", () => {
		// ModifiedFilesHeader receives the merge callback
		const modifiedFilesHeaderBlock = source.slice(
			source.indexOf("<ModifiedFilesHeader"),
			source.indexOf("/>", source.indexOf("<ModifiedFilesHeader")) + 2,
		);
		expect(modifiedFilesHeaderBlock).toContain("onMerge=");
		expect(modifiedFilesHeaderBlock).toContain("handleMergePr");
		expect(modifiedFilesHeaderBlock).toContain("merging={mergePrRunning}");
		expect(modifiedFilesHeaderBlock).toContain("prState=");

		// PrStatusCard does NOT receive onMerge
		const prStatusCardBlock = source.slice(
			source.indexOf("<PrStatusCard"),
			source.indexOf("/>", source.indexOf("<PrStatusCard")) + 2,
		);
		expect(prStatusCardBlock).not.toContain("onMerge");
		expect(prStatusCardBlock).not.toContain("merging");
	});
});
