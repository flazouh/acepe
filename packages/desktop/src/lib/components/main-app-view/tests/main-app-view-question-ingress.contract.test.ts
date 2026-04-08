import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const source = readFileSync(resolve(import.meta.dir, "../../main-app-view.svelte"), "utf8");

describe("main app view question ingress contract", () => {
	it("hydrates backend-owned interaction projections without synthesizing tool-call entries", () => {
		expect(source).not.toContain('import { getQuestionToolCallBackfill }');
		expect(source).not.toContain("sessionStore.createToolCallEntry(question.sessionId, backfill);");
		expect(source).toContain("function hydrateInteractionProjection(");
		expect(source).toContain('hydrateInteractionProjection(question.sessionId, "session-update-question"');
		expect(source).not.toContain("questionStore.add(question);");
	});
});
