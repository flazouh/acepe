import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import AgentInputNewThreadOptionsFixture from "./fixtures/agent-input-new-thread-options-fixture.svelte";
import { getNewThreadChipClass } from "../agent-input-new-thread-chip-state.js";

vi.mock("svelte", async () => {
	const { createRequire } = await import("node:module");
	const { dirname, join } = await import("node:path");
	const require = createRequire(import.meta.url);
	const svelteClientPath = join(
		dirname(require.resolve("svelte/package.json")),
		"src/index-client.js"
	);

	return import(/* @vite-ignore */ svelteClientPath);
});

afterEach(() => {
	cleanup();
});

describe("AgentInputNewThreadOptions", () => {
	it("puts rest opacity on every setup chip wrap", () => {
		const view = render(AgentInputNewThreadOptionsFixture);
		const chips = view.container.querySelectorAll("[data-slot=new-thread-chip]");
		const restClass = getNewThreadChipClass();

		expect(chips.length).toBe(4);
		for (const chip of chips) {
			expect(chip.className).toContain(restClass);
		}
	});
});
