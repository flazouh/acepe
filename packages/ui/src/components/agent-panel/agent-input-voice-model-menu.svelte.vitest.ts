import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import AgentInputVoiceModelMenu from "./agent-input-voice-model-menu.svelte";

vi.mock("../dropdown-menu/index.js", async () => {
	const module = await import("./__tests__/fixtures/mock-dropdown-part.svelte");
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

vi.mock("../selector/index.js", async () => {
	const module = await import("./__tests__/fixtures/mock-selector.svelte");
	return { Selector: module.default };
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

describe("AgentInputVoiceModelMenu", () => {
	it("does not show download actions for external speech backend rows", () => {
		const view = render(AgentInputVoiceModelMenu, {
			props: {
				models: [
					{
						id: "external",
						name: "Speech to text",
						sizeBytes: 0,
						isDownloaded: false,
						isDownloadable: false,
					},
				],
				selectedModelId: "external",
				onSelectModel: () => undefined,
				onDownloadModel: () => undefined,
				onUninstallModel: () => undefined,
			},
		});

		expect(view.getByText("Speech to text")).toBeTruthy();
		expect(view.getByText("Not configured")).toBeTruthy();
		expect(view.queryByRole("button", { name: "Download" })).toBeNull();
		expect(view.queryByRole("button", { name: "Uninstall" })).toBeNull();
	});
});
