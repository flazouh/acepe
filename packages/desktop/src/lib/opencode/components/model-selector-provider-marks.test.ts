import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const modelSelectorPath = resolve(__dirname, "./model-selector.svelte");
const modelSelectorSource = readFileSync(modelSelectorPath, "utf8");
const providerLogoPath = resolve(__dirname, "./provider-logo.svelte");
const providerLogoSource = readFileSync(providerLogoPath, "utf8");

describe("opencode model selector provider marks", () => {
	it("uses the shared provider mark component and shows marks for grouped model rows", () => {
		expect(providerLogoSource).toContain('from "@acepe/ui"');
		expect(providerLogoSource).toContain("ProviderMark");
		expect(modelSelectorSource).toContain(
			'ProviderLogo providerId={provider.id} class="h-3.5 w-3.5"'
		);
	});

	it("marks the trigger button as a hover group for provider marks", () => {
		expect(modelSelectorSource).toContain(
			'class={cn("group/provider-trigger h-8 gap-2 px-2", className)}'
		);
	});
});
