import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import AgentInputComposerToolbarConfigFixture from "./fixtures/agent-input-composer-toolbar-config-fixture.svelte";

vi.mock("../../dropdown-menu/index.js", async () => {
	const module = await import("./fixtures/mock-dropdown-part.svelte");
	const Part = module.default;
	return {
		Root: Part,
		Trigger: Part,
		Content: Part,
		Item: Part,
		Group: Part,
		GroupHeading: Part,
		Separator: Part,
		Label: Part,
	};
});

vi.mock("../agent-input-autonomous-toggle.svelte", async () => {
	const module = await import("./fixtures/mock-toolbar-control.svelte");
	return { default: module.default };
});

vi.mock("../agent-input-config-option-selector.svelte", async () => {
	const module = await import("./fixtures/mock-agent-input-config-option-selector.svelte");
	return { default: module.default };
});

vi.mock("../agent-input-mic-button.svelte", async () => {
	const module = await import("./fixtures/mock-toolbar-control.svelte");
	return { default: module.default };
});

vi.mock("../agent-input-mode-pill.svelte", async () => {
	const module = await import("./fixtures/mock-toolbar-control.svelte");
	return { default: module.default };
});

vi.mock("../agent-input-voice-model-menu.svelte", async () => {
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

describe("AgentInputComposerToolbar", () => {
	it("renders config selectors while selector loading state is active", () => {
		const view = render(AgentInputComposerToolbarConfigFixture);

		expect(view.getByTestId("model-selector")).toBeTruthy();
		expect(view.getByTitle("Reasoning: medium")).toBeTruthy();
	});
});
