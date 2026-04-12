import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sessionItemPath = resolve(
	process.cwd(),
	"src/lib/components/ui/session-item/session-item.svelte"
);

describe("session-item activity projection contract", () => {
	it("derives active row content from the shared activity projection", () => {
		expect(existsSync(sessionItemPath)).toBe(true);
		if (!existsSync(sessionItemPath)) return;

		const source = readFileSync(sessionItemPath, "utf8");

		expect(source).toContain('import { getSessionStore } from "$lib/acp/store/session-store.svelte.js"');
		expect(source).toContain("projectActivityEntryFromSessionEntries");
		expect(source).toContain("extractTodoProgress");
		expect(source).toContain("const activityProjection = $derived.by(() => {");
		expect(source).toContain("const entries = sessionStore.getEntries(session.id);");
		expect(source).toContain("return projectActivityEntryFromSessionEntries({");
		expect(source).toContain("includeLastCompletedTool: false,");
		expect(source).toContain("taskDescription={activityProjection?.taskDescription ?? null}");
		expect(source).toContain("taskSubagentTools={activityProjection?.taskSubagentTools ?? []}");
		expect(source).toContain("todoProgress={activityProjection?.todoProgress ?? null}");
	});
});
