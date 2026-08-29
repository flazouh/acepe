import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import AgentInputComposerLeadingControlsFixture from "./fixtures/agent-input-composer-leading-controls-fixture.svelte";
import { AGENT_INPUT_CONTROL_GAP_CLASS } from "../agent-input-composer-spacing.js";

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

describe("AgentInputComposerLeadingControls", () => {
	it("puts the mode before the model, so the row reads mode then model", () => {
		const view = render(AgentInputComposerLeadingControlsFixture);
		const cluster = view.container.querySelector('[data-qa="agent-input-leading-controls"]');
		const modeControl = cluster?.querySelector('[data-qa="agent-input-mode-control"]');
		const modelControl = cluster?.querySelector('[data-qa="agent-input-model-control"]');

		expect(modeControl).not.toBeNull();
		expect(modelControl).not.toBeNull();
		expect(
			(modeControl as Node).compareDocumentPosition(modelControl as Node) &
				Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
	});

	it("keeps a long model label content-sized instead of filling a wide composer", () => {
		const view = render(AgentInputComposerLeadingControlsFixture);
		const modelControl = view.container.querySelector('[data-qa="agent-input-model-control"]');

		expect(modelControl?.classList.contains("w-fit")).toBe(true);
		expect(modelControl?.classList.contains("max-w-[min(18rem,100%)]")).toBe(true);
	});

	it("spaces its controls with the shared composer control gap", () => {
		const view = render(AgentInputComposerLeadingControlsFixture);
		const cluster = view.container.querySelector('[data-qa="agent-input-leading-controls"]');

		expect(cluster?.classList.contains(AGENT_INPUT_CONTROL_GAP_CLASS)).toBe(true);
	});

	it("hides an empty mode slot so a provider with no modes adds no gap", () => {
		const view = render(AgentInputComposerLeadingControlsFixture, {
			props: {
				showMode: false,
			},
		});
		const modeControl = view.container.querySelector('[data-qa="agent-input-mode-control"]');

		expect(modeControl?.classList.contains("empty:hidden")).toBe(true);
		expect(modeControl?.childElementCount).toBe(0);
	});

	it("fuses the reasoning effort onto the model when the provider offers one", () => {
		const view = render(AgentInputComposerLeadingControlsFixture, {
			props: {
				withReasoning: true,
			},
		});
		const modelControl = view.container.querySelector('[data-qa="agent-input-model-control"]');

		expect(modelControl?.querySelector(".model-reasoning-controls")).not.toBeNull();
	});
});
