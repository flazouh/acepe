import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const contentDir = import.meta.dir;
const kanbanViewPath = resolve(contentDir, "./kanban-view.svelte");

describe("kanban empty-column contract", () => {
	it("builds groups from a fixed section order instead of only queueStore.sections", () => {
		expect(existsSync(kanbanViewPath)).toBe(true);
		if (!existsSync(kanbanViewPath)) return;

		const source = readFileSync(kanbanViewPath, "utf8");

		expect(source).toContain("const SECTION_ORDER: readonly QueueSectionId[] = [");
		expect(source).toContain('"answer_needed"');
		expect(source).toContain('"planning"');
		expect(source).toContain('"working"');
		expect(source).toContain('"finished"');
		expect(source).toContain('"error"');
		expect(source).toContain("SECTION_ORDER.map((sectionId) => {");
		expect(source).toContain(
			"const section = queueStore.sections.find((section) => section.id === sectionId);"
		);
		expect(source).toContain("items: section ? section.items.map(mapItemToCard) : [],");
	});
});