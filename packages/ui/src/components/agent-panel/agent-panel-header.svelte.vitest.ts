import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

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

import AgentPanelHeader from "./agent-panel-header.svelte";

afterEach(() => {
	cleanup();
});

describe("AgentPanelHeader project badge", () => {
	it("renders the project letter alongside the session sequence id", () => {
		const view = render(AgentPanelHeader, {
			sessionTitle: "Hi",
			projectName: "sandbox",
			projectColor: "#22c55e",
			sequenceId: 4,
			onClose: () => {},
		});

		expect(view.container.textContent).toContain("S");
		expect(view.container.textContent).toContain("4");
	});
});
