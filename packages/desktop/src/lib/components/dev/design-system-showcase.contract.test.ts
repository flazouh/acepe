import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const source = readFileSync(resolve(import.meta.dir, "./design-system-showcase.svelte"), "utf8");

describe("design system showcase contract", () => {
	it("adds a dedicated buttons section to the design system overlay", () => {
		expect(source).toContain('id: "button"');
		expect(source).toContain('label: "Buttons"');
		expect(source).toContain('{#if activeSection === "button"}');
		expect(source).toContain('>Buttons</div>');
		expect(source).toContain('<Button variant="header" size="header">');
		expect(source).toContain('<Button variant="toolbar" size="toolbar">');
	});

	it("shows a kanban card specimen with a subagent task", () => {
		expect(source).toContain("const demoCardSubagent: KanbanCardData = {");
		expect(source).toContain("taskCard: {");
		expect(source).toContain('title: "Inspect queue reconciliation"');
		expect(source).toContain("With Subagent Task");
		expect(source).toContain("<KanbanCard card={demoCardSubagent} />");
	});
});