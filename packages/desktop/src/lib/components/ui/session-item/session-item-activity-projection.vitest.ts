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
		expect(source).toContain("projectSessionPreviewActivity");
		expect(source).toContain("extractTodoProgress");
		expect(source).toContain("deriveQueueSessionState");
		expect(source).toContain("classifyThreadBoardState");
		expect(source).toContain("const activityProjection = $derived.by(() => {");
		expect(source).toContain("const entries = $derived(sessionStore.getEntries(session.id));");
		expect(source).toContain("const queueSessionState = $derived.by(() =>");
		expect(source).toContain("return projectSessionPreviewActivity({");
		expect(source).toContain("taskDescription={activityProjection?.taskDescription ?? null}");
		expect(source).toContain("taskSubagentTools={activityProjection?.taskSubagentTools ?? []}");
		expect(source).toContain("todoProgress={activityProjection?.todoProgress ?? null}");
	});
});
