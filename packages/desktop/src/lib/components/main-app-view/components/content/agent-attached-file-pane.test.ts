import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const desktopSource = readFileSync(
	resolve(import.meta.dir, "./agent-attached-file-pane.svelte"),
	"utf8"
);
const sharedSource = readFileSync(
	resolve(
		import.meta.dir,
		"../../../../../../../ui/src/components/agent-panel/agent-attached-file-pane.svelte"
	),
	"utf8"
);

describe("agent attached file pane layout", () => {
	it("delegates the constrained attached-file layout to the shared pane shell", () => {
		expect(desktopSource).toContain("<SharedAgentAttachedFilePane {columnWidth}>");
		expect(sharedSource).toContain("flex-col gap-0 overflow-hidden");
		expect(sharedSource).toContain("min-h-8 shrink-0 items-center");
		expect(sharedSource).toContain('class="min-h-0 flex-1 overflow-hidden"');
	});
});
