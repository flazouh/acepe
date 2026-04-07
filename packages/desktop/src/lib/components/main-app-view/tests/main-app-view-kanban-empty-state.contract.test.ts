import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "bun:test";

const source = readFileSync(resolve(import.meta.dir, "../../main-app-view.svelte"), "utf8");

describe("main app view kanban empty-state contract", () => {
	it("keeps kanban mode routed through the panel container even with zero panels", () => {
		expect(source).toContain(
			'const showPanelsContainer = $derived(hasAnyPanel || panelStore.viewMode === "kanban");'
		);
		expect(source).toContain("{showPanelsContainer");
		expect(source).toContain("justify-center items-center overflow-x-auto");
		expect(source).toContain("{#if showPanelsContainer}");
		expect(source).toContain("{:else if viewState.initializationComplete}");
		expect(source).not.toContain("{#if hasAnyPanel}");
	});
});
