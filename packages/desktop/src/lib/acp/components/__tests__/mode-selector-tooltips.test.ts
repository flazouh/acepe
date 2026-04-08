import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const modeSelectorPath = resolve(__dirname, "../mode-selector.svelte");
const modeSelectorSource = readFileSync(modeSelectorPath, "utf8");
const modeBarPath = resolve(__dirname, "../model-selector.mode-bar.svelte");
const modeBarSource = readFileSync(modeBarPath, "utf8");

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

	it("labels the model-selector mode bar buttons", () => {
		expect(modeBarSource).toContain("m.plan_heading()");
		expect(modeBarSource).toContain("m.plan_sidebar_build()");
		expect(modeBarSource).toContain("<Tooltip.Content>{m.plan_heading()}</Tooltip.Content>");
		expect(modeBarSource).toContain("<Tooltip.Content>{m.plan_sidebar_build()}</Tooltip.Content>");
		expect(modeBarSource).toContain("{#snippet child({ props })}");
	});
});
