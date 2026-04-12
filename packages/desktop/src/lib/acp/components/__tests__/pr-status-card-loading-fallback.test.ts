import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const desktopPrStatusCardSource = readFileSync(
	resolve(__dirname, "../pr-status-card/pr-status-card.svelte"),
	"utf8"
);
const sharedPrCardSource = readFileSync(
	resolve(
		__dirname,
		"../../../../../../ui/src/components/agent-panel/agent-panel-pr-card.svelte"
	),
	"utf8"
);
const sharedPrStatusCardShellSource = readFileSync(
	resolve(__dirname, "../../../../../../ui/src/components/agent-panel/pr-status-card.svelte"),
	"utf8"
);
const headerIndex = sharedPrStatusCardShellSource.indexOf(
	'class="w-full flex items-center justify-between px-3 py-1 rounded-md border border-border bg-input/30'
);
const expandedContentIndex = sharedPrStatusCardShellSource.indexOf(
	"{#if isExpanded && hasExpandedContent && expandedContent}"
);

describe("PR status card loading fallback", () => {
	it("delegates the existing-PR loading placeholder to the shared PR card", () => {
		expect(desktopPrStatusCardSource).toContain('mode: "pending"');
		expect(desktopPrStatusCardSource).toContain("number: prNumber");
		expect(sharedPrCardSource).toContain("{:else if model.number !== null && model.number !== undefined}");
		expect(sharedPrCardSource).toContain("#{model.number}");
	});

	it("renders the PR action bar before the expanded content markup", () => {
		expect(headerIndex).toBeGreaterThan(-1);
		expect(expandedContentIndex).toBeGreaterThan(-1);
		expect(headerIndex).toBeLessThan(expandedContentIndex);
	});
});
