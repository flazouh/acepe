import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import AgentPanelContentColumnFrame from "./agent-panel-content-column-frame.svelte";

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

describe("AgentPanelContentColumnFrame", () => {
	it("caps centered content at a readable width", () => {
		const view = render(AgentPanelContentColumnFrame, {
			props: {
				centered: true,
				"data-testid": "column-frame",
			},
		});

		const frame = view.getByTestId("column-frame");
		const content = frame.firstElementChild;

		expect(content?.className).toContain("w-full");
		expect(content?.className).toContain("max-w-3xl");
	});

	it("does not cap regular multi-panel content", () => {
		const view = render(AgentPanelContentColumnFrame, {
			props: {
				centered: false,
				"data-testid": "column-frame",
			},
		});

		const content = view.getByTestId("column-frame").firstElementChild;

		expect(content?.className).not.toContain("max-w-3xl");
	});
});
