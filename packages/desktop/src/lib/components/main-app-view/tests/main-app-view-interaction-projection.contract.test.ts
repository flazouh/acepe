import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const source = readFileSync(resolve(import.meta.dir, "../../main-app-view.svelte"), "utf8");

describe("main app view interaction projection contract", () => {
	it("hydrates live interaction state instead of reconstructing create-plan approvals from entries", () => {
		expect(source).toContain('hydrateInteractionProjection(question.sessionId, "session-update-question"');
		expect(source).not.toContain("toolCall.awaitingPlanApproval");
		expect(source).not.toContain("sessionStore.getEntries(session.id)");
	});
});
