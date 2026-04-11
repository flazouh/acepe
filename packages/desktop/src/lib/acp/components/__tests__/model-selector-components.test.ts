import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

describe("model-selector subcomponents", () => {
	it("keeps the shared selector subcomponents available from @acepe/ui", () => {
		const base = resolve(__dirname, "../../../../../../ui/src/components/agent-panel");
		expect(existsSync(resolve(base, "agent-input-model-trigger.svelte"))).toBe(true);
		expect(existsSync(resolve(base, "agent-input-model-row.svelte"))).toBe(true);
		expect(existsSync(resolve(base, "agent-input-model-mode-bar.svelte"))).toBe(true);
		expect(existsSync(resolve(base, "agent-input-model-favorite-star.svelte"))).toBe(true);
	});
});
