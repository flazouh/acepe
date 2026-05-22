import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import AgentInputStandardModelSelector from "../agent-input-standard-model-selector.svelte";

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

describe("AgentInputStandardModelSelector", () => {
	it("renders an empty model message when no models are available", () => {
		const view = render(AgentInputStandardModelSelector, {
			open: true,
			triggerLabel: "Model",
			currentModelId: null,
			totalModelCount: 0,
			filteredGroups: [],
			onSelect: vi.fn(),
		});

		expect(view.getByText("No models available")).toBeTruthy();
	});

	it("reports search text changes to the parent", async () => {
		const onSearchChange = vi.fn();
		const view = render(AgentInputStandardModelSelector, {
			open: true,
			triggerLabel: "Model",
			currentModelId: null,
			totalModelCount: 13,
			filteredGroups: [],
			searchQuery: "",
			showSearch: true,
			onSearchChange,
			onSelect: vi.fn(),
		});

		await fireEvent.input(view.getByPlaceholderText("Search models"), {
			target: { value: "claude" },
		});

		expect(onSearchChange).toHaveBeenCalledWith("claude");
	});

	it("calls onSelect when a model row is selected", async () => {
		const onSelect = vi.fn();
		const view = render(AgentInputStandardModelSelector, {
			open: true,
			triggerLabel: "Model",
			currentModelId: null,
			totalModelCount: 1,
			filteredGroups: [
				{
					label: "",
					items: [{ id: "gpt-5", name: "GPT-5" }],
				},
			],
			onSelect,
		});

		await fireEvent.click(view.getByText("GPT-5"));

		expect(onSelect).toHaveBeenCalledWith("gpt-5");
	});
});
