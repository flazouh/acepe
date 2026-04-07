import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const queueItemSource = readFileSync(
	resolve(import.meta.dir, "../../queue/queue-item.svelte"),
	"utf8"
);
const permissionActionBarSource = readFileSync(
	resolve(import.meta.dir, "../permission-action-bar.svelte"),
	"utf8"
);

describe("queue permission toolbar contract", () => {
	it("renders compact queue permission actions without duplicating the permission summary", () => {
		expect(queueItemSource).toContain(
			"<PermissionActionBar permission={pendingPermission} compact hideHeader />"
		);
		expect(permissionActionBarSource).toContain("{#if !hideHeader}");
		expect(permissionActionBarSource).not.toContain("{#if compact}");
	});

	it("gates queue action cards on live pending interactions instead of stale queue snapshots", () => {
		expect(queueItemSource).toContain(
			"interactionStore.permissionsPending.get(snapshotPermission.id) ?? null"
		);
		expect(queueItemSource).toContain(
			"interactionStore.questionsPending.get(item.pendingQuestion.id) ?? null"
		);
		expect(queueItemSource).not.toContain(
			'const pendingPermission = $derived(\n\titem.state.pendingInput.kind === "permission" ? item.state.pendingInput.request : null\n);'
		);
		expect(queueItemSource).not.toContain("questionStore.reply(item.pendingQuestion.id");
	});
});
