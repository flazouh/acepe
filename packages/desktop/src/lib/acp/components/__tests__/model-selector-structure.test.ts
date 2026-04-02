import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const modelSelectorPath = resolve(__dirname, "../model-selector.svelte");
const modelSelectorSource = readFileSync(modelSelectorPath, "utf8");
const modelSelectorTriggerPath = resolve(__dirname, "../model-selector.trigger.svelte");
const modelSelectorTriggerSource = readFileSync(modelSelectorTriggerPath, "utf8");

describe("model selector structure", () => {
	it("keeps codex-only split model and reasoning effort picker when supportsReasoningEffortPicker", () => {
		expect(modelSelectorSource).toContain("isCodexModelOpen");
		expect(modelSelectorSource).toContain("isCodexEffortOpen");
		expect(modelSelectorSource).toContain("handleCodexBaseSelect");
		expect(modelSelectorSource).toContain("handleCodexEffortSelect");
	});

	it("removes the model trigger tooltip while keeping the reasoning-effort help", () => {
		expect(modelSelectorSource).not.toContain("m.model_selector_tooltip_label()");
		expect(modelSelectorSource).not.toContain("const shortcutKeys");
		expect(modelSelectorSource).not.toContain("KEYBINDING_ACTIONS.SELECTOR_MODEL_TOGGLE");
		expect(modelSelectorSource).toContain("m.model_selector_reasoning_effort_tooltip()");
		expect(modelSelectorSource).toContain("<Selector");
	});

	it("renders model selector triggers without the legacy CPU icon", () => {
		expect(modelSelectorSource).not.toContain('from "phosphor-svelte/lib/Cpu"');
		expect(modelSelectorSource).not.toContain("<Cpu");
		expect(modelSelectorTriggerSource).not.toContain('from "phosphor-svelte/lib/Cpu"');
		expect(modelSelectorTriggerSource).not.toContain("<Cpu");
	});
});
