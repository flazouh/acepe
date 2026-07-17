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

	it("shows provider tabs and only the active provider models", async () => {
		const onProviderChange = vi.fn();
		const view = render(AgentInputStandardModelSelector, {
			open: true,
			triggerLabel: "Model",
			currentModelId: null,
			totalModelCount: 2,
			providerGroups: [
				{ label: "OpenRouter", providerId: "openrouter", upstreamProviderBrand: "openRouter", items: [{ id: "or/model", name: "OpenRouter Model" }] },
				{ label: "GitHub Copilot", providerId: "github-copilot", upstreamProviderBrand: "githubCopilot", items: [{ id: "gh/model", name: "Copilot Model" }] },
			],
			activeProviderId: "openrouter",
			filteredGroups: [
				{ label: "OpenRouter", providerId: "openrouter", upstreamProviderBrand: "openRouter", items: [{ id: "or/model", name: "OpenRouter Model" }] },
			],
			onProviderChange,
			onSelect: vi.fn(),
		});

		expect(view.getByRole("tab", { name: "OpenRouter" }).getAttribute("aria-selected")).toBe("true");
		expect(view.getByText("OpenRouter Model")).toBeTruthy();
		expect(view.queryByText("Copilot Model")).toBeNull();
		const openRouterTab = view.getByRole("tab", { name: "OpenRouter" });
		await fireEvent.keyDown(openRouterTab, { key: "ArrowRight" });
		expect(onProviderChange).toHaveBeenCalledWith("github-copilot");
	});

	it("uses the selected upstream provider mark in the trigger", () => {
		const view = render(AgentInputStandardModelSelector, {
			open: false,
			triggerLabel: "Claude Sonnet",
			triggerUpstreamProviderBrand: "openRouter",
			triggerProviderLabel: "OpenRouter",
			currentModelId: "openrouter/claude",
			totalModelCount: 1,
			filteredGroups: [{ label: "OpenRouter", items: [{ id: "openrouter/claude", name: "Claude Sonnet" }] }],
			onSelect: vi.fn(),
		});

		expect(view.container.querySelector('[data-upstream-provider-brand="openRouter"]')).toBeTruthy();
	});

	it("lets the user set a default model without selecting the model", async () => {
		const onSelect = vi.fn();
		const onDefaultModelToggle = vi.fn();
		const view = render(AgentInputStandardModelSelector, {
			open: true,
			triggerLabel: "Model",
			currentModelId: null,
			totalModelCount: 1,
			filteredGroups: [
				{ label: "OpenRouter", items: [{ id: "openrouter/model", name: "Router Model" }] },
			],
			onSelect,
			onDefaultModelToggle,
		});

		expect(view.queryByRole("button", { name: "Add Router Model to favorites" })).toBeNull();
		await fireEvent.click(view.getByRole("button", { name: "Set Router Model as default model" }));
		expect(onDefaultModelToggle).toHaveBeenCalledWith("openrouter/model");
		expect(onSelect).not.toHaveBeenCalled();
	});

	it("keeps the default model in normal list position without a promoted duplicate", () => {
		const view = render(AgentInputStandardModelSelector, {
			open: true,
			triggerLabel: "Model",
			currentModelId: "opus-one-minute",
			totalModelCount: 3,
			filteredGroups: [
				{
					label: "Claude",
					items: [
						{ id: "fable", name: "Fable 5" },
						{ id: "opus", name: "Opus 4.8", isDefault: true },
						{ id: "opus-one-minute", name: "Opus[1m]" },
					],
				},
			],
			onSelect: vi.fn(),
			onDefaultModelToggle: vi.fn(),
		});

		const rows = view.getAllByRole("menuitem").map((row) => (row.textContent ?? "").trim());
		expect(rows).toEqual(["Fable 5", "Opus 4.8", "Opus[1m]"]);
		expect(view.getAllByText("Opus 4.8")).toHaveLength(1);
		expect(view.getByRole("button", { name: "Clear Opus 4.8 as default model" })).toBeTruthy();
		expect(view.getByRole("button", { name: "Set Opus[1m] as default model" })).toBeTruthy();
		expect(view.queryByRole("button", { name: "Add Opus 4.8 to favorites" })).toBeNull();
	});

	it("shows favorite stars separately from default pins for large lists", () => {
		const view = render(AgentInputStandardModelSelector, {
			open: true,
			triggerLabel: "Model",
			currentModelId: "model-2",
			totalModelCount: 13,
			filteredGroups: [
				{
					label: "OpenRouter",
					items: [
						{ id: "model-1", name: "Model 1", isFavorite: true },
						{ id: "model-2", name: "Model 2", isDefault: true },
					],
				},
			],
			showFavoriteActions: true,
			onSelect: vi.fn(),
			onToggleFavorite: vi.fn(),
			onDefaultModelToggle: vi.fn(),
		});

		expect(view.getByRole("button", { name: "Remove Model 1 from favorites" })).toBeTruthy();
		expect(view.getByRole("button", { name: "Add Model 2 to favorites" })).toBeTruthy();
		expect(view.getByRole("button", { name: "Set Model 1 as default model" })).toBeTruthy();
		expect(view.getByRole("button", { name: "Clear Model 2 as default model" })).toBeTruthy();
	});
});
