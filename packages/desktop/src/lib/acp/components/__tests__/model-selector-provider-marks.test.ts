import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const modelSelectorPath = resolve(__dirname, "../model-selector.svelte");
const modelSelectorSource = readFileSync(modelSelectorPath, "utf8");
const modelSelectorContentPath = resolve(__dirname, "../model-selector.content.svelte");
const modelSelectorContentSource = readFileSync(modelSelectorContentPath, "utf8");

describe("ACP model selector provider marks", () => {
	it("renders provider marks in the trigger and dropdown rows", () => {
		expect(modelSelectorSource).toContain("ProviderMark");
		expect(modelSelectorContentSource).toContain("ProviderMark");
	});

	it("derives trigger and dropdown provider marks from the selected model and row/group data", () => {
		expect(modelSelectorSource).toContain("triggerProviderMarkSource");
		expect(modelSelectorContentSource).toContain("getModelProviderSource(model)");
		expect(modelSelectorContentSource).toContain(
			'ProviderMark provider={group.provider} class="size-3"'
		);
	});

	it("marks the selector trigger as a hover group for provider marks", () => {
		expect(modelSelectorSource).toContain('buttonClass="group/provider-trigger"');
	});

	it("does not reference removed provider metadata fallback state", () => {
		expect(modelSelectorContentSource).not.toContain("hasProviderMetadata");
	});
});
