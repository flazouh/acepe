import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import AgentInputComposerTrailingControlsFixture from "./fixtures/agent-input-composer-trailing-controls-fixture.svelte";

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
	it("keeps a long model label content-sized instead of filling a wide composer", () => {
		const view = render(AgentInputComposerTrailingControlsFixture);
		const modelControl = view.container.querySelector('[data-qa="agent-input-model-control"]');

		expect(modelControl?.classList.contains("w-fit")).toBe(true);
		expect(modelControl?.classList.contains("max-w-[min(18rem,100%)]")).toBe(true);
	});

	it("keeps model and context visible while voice is active", () => {
		const view = render(AgentInputComposerTrailingControlsFixture, {
			props: {
				voiceActive: true,
			},
		});
		const modelControl = view.container.querySelector('[data-qa="agent-input-model-control"]');
		const metricsChip = view.container.querySelector('[data-qa="agent-input-metrics-chip"]');

		expect(modelControl?.classList.contains("opacity-0")).toBe(false);
		expect(metricsChip?.classList.contains("opacity-0")).toBe(false);
	});
});
