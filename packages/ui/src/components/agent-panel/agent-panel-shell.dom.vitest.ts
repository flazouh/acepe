import { cleanup, render } from "@testing-library/svelte";
import { createRawSnippet } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import AgentPanelShell from "./agent-panel-shell.svelte";

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

const marker = (id: string) =>
	createRawSnippet(() => ({ render: () => `<div data-testid="${id}">${id}</div>` }));

afterEach(() => {
	cleanup();
});

describe("AgentPanelShell", () => {
	it("floats the pre-composer layer over the transcript instead of in flow", () => {
		const view = render(AgentPanelShell, {
			props: {
				header: marker("header"),
				body: marker("body"),
				preComposer: marker("pre-composer"),
				composer: marker("composer"),
			},
		});

		const preComposer = view.getByTestId("pre-composer");
		const composer = view.getByTestId("composer");

		// The pre-composer content sits inside an overlay layer: absolutely
		// positioned above the composer (bottom-full) and click-through by default
		// so the transcript beneath the gaps stays interactive.
		const layer = preComposer.closest(".absolute");
		expect(layer).not.toBeNull();
		const layerClasses = layer?.className ?? "";
		expect(layerClasses).toContain("bottom-full");
		expect(layerClasses).toContain("pointer-events-none");

		// The composer itself is NOT inside that floating layer — it keeps its
		// normal document-flow slot at the bottom of the column.
		expect(composer.closest(".pointer-events-none")).toBeNull();

		// Both share the same relative anchor so the layer is measured against the
		// composer's top edge.
		const anchor = composer.closest(".relative");
		expect(anchor).not.toBeNull();
		expect(anchor?.contains(layer)).toBe(true);
	});
});
