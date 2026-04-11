import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const modeSelectorPath = resolve(__dirname, "../mode-selector.svelte");
const modeSelectorSource = readFileSync(modeSelectorPath, "utf8");
const modelSelectorPath = resolve(__dirname, "../model-selector.svelte");
const modelSelectorSource = readFileSync(modelSelectorPath, "utf8");
const sharedModeBarPath = resolve(
	__dirname,
	"../../../../../../ui/src/components/agent-panel/agent-input-model-mode-bar.svelte"
);
const sharedModeBarSource = readFileSync(sharedModeBarPath, "utf8");

describe("plan and build icon tooltips", () => {
	it("labels the compact mode selector buttons", () => {
		expect(modeSelectorSource).toContain("m.plan_heading()");
		expect(modeSelectorSource).toContain("m.plan_sidebar_build()");
		expect(modeSelectorSource).toContain("<Tooltip.Content>");
		expect(modeSelectorSource).toContain(
			"{mode.id === CanonicalModeId.PLAN ? m.plan_heading() : m.plan_sidebar_build()}"
		);
		expect(modeSelectorSource).toContain("{#snippet child({ props })}");
	});

	it("labels the model-selector mode bar buttons through shared props", () => {
		expect(modelSelectorSource).toContain("planLabel={m.plan_heading()}");
		expect(modelSelectorSource).toContain("buildLabel={m.plan_sidebar_build()}");
		expect(sharedModeBarSource).toContain("title={planLabel}");
		expect(sharedModeBarSource).toContain("aria-label={planLabel}");
		expect(sharedModeBarSource).toContain("title={buildLabel}");
		expect(sharedModeBarSource).toContain("aria-label={buildLabel}");
	});
});
