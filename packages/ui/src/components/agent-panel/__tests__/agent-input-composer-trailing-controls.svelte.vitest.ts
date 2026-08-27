import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import AgentInputComposerTrailingControlsFixture from "./fixtures/agent-input-composer-trailing-controls-fixture.svelte";
import { AGENT_INPUT_CONTROL_GAP_CLASS } from "../agent-input-composer-spacing.js";

vi.mock("../agent-input-voice-fused-controls.svelte", async () => {
	const module = await import("./fixtures/mock-toolbar-control.svelte");
	return { default: module.default };
});

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

describe("AgentInputComposerTrailingControls", () => {
	it("leaves the model to the leading cluster", () => {
		const view = render(AgentInputComposerTrailingControlsFixture);

		expect(view.container.querySelector('[data-qa="agent-input-model-control"]')).toBeNull();
	});

	it("spaces its controls with the shared composer control gap", () => {
		const view = render(AgentInputComposerTrailingControlsFixture);
		const row = view.container.querySelector('[data-qa="agent-input-trailing-controls"]');

		expect(row?.classList.contains(AGENT_INPUT_CONTROL_GAP_CLASS)).toBe(true);
	});

	it("keeps context visible while voice is active", () => {
		const view = render(AgentInputComposerTrailingControlsFixture, {
			props: {
				voiceActive: true,
			},
		});
		const metricsChip = view.container.querySelector('[data-qa="agent-input-metrics-chip"]');

		expect(metricsChip?.classList.contains("opacity-0")).toBe(false);
	});

	it("hides an empty metrics slot so it does not add a flex gap", () => {
		const view = render(AgentInputComposerTrailingControlsFixture, {
			props: {
				showMetrics: false,
			},
		});
		const metricsChip = view.container.querySelector('[data-qa="agent-input-metrics-chip"]');

		expect(metricsChip?.classList.contains("empty:hidden")).toBe(true);
		expect(metricsChip?.childElementCount).toBe(0);
	});
});
