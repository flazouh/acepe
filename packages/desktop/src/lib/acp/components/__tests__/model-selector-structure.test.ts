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
const sharedModelTriggerPath = resolve(
	__dirname,
	"../../../../../../ui/src/components/agent-panel/agent-input-model-trigger.svelte"
);
const sharedModelTriggerSource = readFileSync(sharedModelTriggerPath, "utf8");

describe("model selector structure", () => {
	it("adapts desktop model state into the shared selector view", () => {
		expect(modelSelectorSource).toContain("SharedAgentInputModelSelector");
		expect(modelSelectorSource).toContain("reasoningGroups");
		expect(modelSelectorSource).toContain("sharedSelectorRef");
		expect(modelSelectorSource).toContain("export function toggle()");
	});

	it("removes the model trigger tooltip while keeping the reasoning-effort help", () => {
		expect(modelSelectorSource).not.toContain("m.model_selector_tooltip_label()");
		expect(modelSelectorSource).not.toContain("const shortcutKeys");
		expect(modelSelectorSource).not.toContain("KEYBINDING_ACTIONS.SELECTOR_MODEL_TOGGLE");
		expect(modelSelectorSource).toContain("m.model_selector_reasoning_effort_tooltip()");
		expect(sharedModelSelectorSource).toContain("<Selector");
	});

	it("renders model selector triggers without the legacy CPU icon", () => {
		expect(modelSelectorSource).not.toContain("<Cpu");
		expect(sharedModelTriggerSource).not.toContain("<Cpu");
	});

	it("drives the live split selector from backend display groups instead of reparsing raw ids", () => {
		expect(modelSelectorSource).toContain("reasoningBaseGroupsFromDisplay");
		expect(modelSelectorSource).toContain("reasoningGroups");
	});

	it("only renders the sticky search header when search is visible", () => {
		expect(sharedModelSelectorSource).toMatch(
			/\{#if showSearch\}\s*<div class="sticky top-0 z-10 bg-popover px-3 py-1\.5">/
		);
		expect(sharedModelSelectorSource).not.toMatch(
			/<div class="sticky top-0 z-10 bg-popover px-3 py-1\.5">\s*\{#if showSearch\}/
		);
	});
});
