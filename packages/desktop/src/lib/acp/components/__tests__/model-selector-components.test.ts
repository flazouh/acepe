import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

describe("model-selector subcomponents", () => {
	it("exports the subcomponents", () => {
		const base = resolve(__dirname, "..");
		expect(existsSync(resolve(base, "model-selector.trigger.svelte"))).toBe(true);
		expect(existsSync(resolve(base, "model-selector.content.svelte"))).toBe(true);
		expect(existsSync(resolve(base, "model-selector.row.svelte"))).toBe(true);
		expect(existsSync(resolve(base, "model-selector.mode-bar.svelte"))).toBe(true);
		expect(existsSync(resolve(base, "model-selector.favorite-star.svelte"))).toBe(true);
	});
});
