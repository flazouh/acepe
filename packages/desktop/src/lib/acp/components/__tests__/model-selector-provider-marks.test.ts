import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const modelSelectorPath = resolve(__dirname, "../model-selector.svelte");
const modelSelectorSource = readFileSync(modelSelectorPath, "utf8");
const sharedModelSelectorPath = resolve(
	__dirname,
	"../../../../../../ui/src/components/agent-panel/agent-input-model-selector.svelte"
);
const sharedModelSelectorSource = readFileSync(sharedModelSelectorPath, "utf8");

describe("ACP model selector provider marks", () => {
	it("renders provider marks in the trigger and dropdown rows", () => {
		expect(sharedModelSelectorSource).toContain("ProviderMark");
	});

	it("derives trigger and dropdown provider marks from the selected model and row/group data", () => {
		expect(modelSelectorSource).toContain("triggerProviderMarkSource");
		expect(modelSelectorSource).toContain("getModelProviderSource(model)");
		expect(sharedModelSelectorSource).toContain(
			'ProviderMark provider={group.label} class="size-3"'
		);
	});

	it("marks the selector trigger as a hover group for provider marks", () => {
		expect(sharedModelSelectorSource).toContain('buttonClass="group/provider-trigger"');
	});

	it("does not reference removed provider metadata fallback state", () => {
		expect(modelSelectorSource).not.toContain("hasProviderMetadata");
	});
});
