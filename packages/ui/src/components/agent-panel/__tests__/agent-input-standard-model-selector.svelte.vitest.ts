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

	it("lets the user add a model to favorites without selecting the model", async () => {
		const onSelect = vi.fn();
		const onToggleFavorite = vi.fn();
		const view = render(AgentInputStandardModelSelector, {
			open: true,
			triggerLabel: "Model",
			currentModelId: null,
			totalModelCount: 1,
			filteredGroups: [
				{ label: "OpenRouter", items: [{ id: "openrouter/model", name: "Router Model" }] },
			],
			onSelect,
			onToggleFavorite,
		});

		await fireEvent.click(view.getByRole("button", { name: "Add to favorites" }));
		expect(onToggleFavorite).toHaveBeenCalledWith("openrouter/model");
		expect(onSelect).not.toHaveBeenCalled();
	});
});
