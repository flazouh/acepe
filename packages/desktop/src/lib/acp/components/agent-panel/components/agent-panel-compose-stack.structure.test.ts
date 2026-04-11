import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const agentPanelSource = readFileSync(resolve(__dirname, "./agent-panel.svelte"), "utf8");
const modifiedFilesHeaderSource = readFileSync(
	resolve(__dirname, "../../modified-files/modified-files-header.svelte"),
	"utf8"
);
const prStatusCardSource = readFileSync(
	resolve(__dirname, "../../pr-status-card/pr-status-card.svelte"),
	"utf8"
);
// TodoHeader still exists for kanban-view; the agent panel now renders SharedTodoHeader directly
const todoHeaderSource = readFileSync(resolve(__dirname, "../../todo-header.svelte"), "utf8");
const worktreeSetupCardSource = readFileSync(
	resolve(__dirname, "./worktree-setup-card.svelte"),
	"utf8"
);
const agentErrorCardSource = readFileSync(resolve(__dirname, "./agent-error-card.svelte"), "utf8");
const agentInstallCardSource = readFileSync(
	resolve(__dirname, "./agent-install-card.svelte"),
	"utf8"
);

describe("agent panel compose stack", () => {
	it("owns the shared above-composer gutter in the parent stack", () => {
		expect(agentPanelSource).toContain('class="flex flex-col gap-0.5 px-5"');
	});

	it("keeps the above-composer cards edge-to-edge inside that shared rail", () => {
		expect(modifiedFilesHeaderSource).not.toContain('<div class="w-full px-5">');
		expect(prStatusCardSource).not.toContain('<div class="w-full px-5">');
		expect(todoHeaderSource).not.toContain("{compact ? '' : 'px-5'}");
		expect(worktreeSetupCardSource).not.toContain('<div class="w-full px-5">');
		expect(agentErrorCardSource).not.toContain('<div class="w-full px-5">');
		expect(agentInstallCardSource).not.toContain('<div class="w-full px-5">');
	});
});
