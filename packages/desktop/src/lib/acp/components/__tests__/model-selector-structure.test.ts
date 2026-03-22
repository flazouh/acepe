import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const modelSelectorPath = resolve(__dirname, "../model-selector.svelte");
const modelSelectorSource = readFileSync(modelSelectorPath, "utf8");

describe("model selector structure", () => {
	it("keeps codex-only split model and reasoning effort picker when supportsReasoningEffortPicker", () => {
		expect(modelSelectorSource).toContain("isCodexModelOpen");
		expect(modelSelectorSource).toContain("isCodexEffortOpen");
		expect(modelSelectorSource).toContain("handleCodexBaseSelect");
		expect(modelSelectorSource).toContain("handleCodexEffortSelect");
	});

	it("wraps the selector in tooltip props without making the tooltip the interactive trigger", () => {
		expect(modelSelectorSource).toContain("{#snippet child({ props: tooltipProps })}");
		expect(modelSelectorSource).toContain("<div {...tooltipProps}>");
		expect(modelSelectorSource).toContain("<Selector");
	});
});
