import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const files = [
	resolve(import.meta.dir, "../../components/tool-calls/tool-call-create-plan.svelte"),
	resolve(import.meta.dir, "../../components/queue/queue-item.svelte"),
	resolve(import.meta.dir, "../../../components/main-app-view/components/content/kanban-view.svelte"),
];

describe("plan approval ownership contract", () => {
	it("keeps renderer plan approval updates behind InteractionStore helpers", () => {
		for (const file of files) {
			const source = readFileSync(file, "utf8");
			expect(source).toContain("interactionStore.setPlanApprovalStatus(");
			expect(source).not.toContain("planApprovalsPending.set(");
		}
	});

	it("routes renderer plan approval replies through the canonical approval object", () => {
		for (const file of files) {
			const source = readFileSync(file, "utf8").replaceAll(/\s+/g, "");
			expect(source).toContain("replyToPlanApprovalRequest(approval,true,false)");
			expect(source).toContain("replyToPlanApprovalRequest(approval,false,false)");
			expect(source).not.toContain("approval.jsonRpcRequestId");
		}
	});
});
