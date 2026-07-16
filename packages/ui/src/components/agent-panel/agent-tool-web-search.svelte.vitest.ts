import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import AgentToolWebSearch from "./agent-tool-web-search.svelte";

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

describe("AgentToolWebSearch external navigation icons", () => {
	const links = [
		{
			title: "Acepe repository",
			url: "https://github.com/flazouh/acepe",
			domain: "github.com",
		},
	];

	it("renders collapsed web-search result links with the open-in-new-window icon", () => {
		const view = render(AgentToolWebSearch, {
			props: {
				query: "acepe github",
				links,
				status: "done",
			},
		});

		const icon = view.getByTestId("web-search-collapsed-open-external-hugeicons-icon");
		expect(icon.tagName.toLowerCase()).toBe("svg");
		expect(icon.getAttribute("viewBox")).toBe("0 0 24 24");
		expect(icon.innerHTML).not.toBe("");
	});

	it("renders expanded web-search result cards with the open-in-new-window icon", async () => {
		const view = render(AgentToolWebSearch, {
			props: {
				query: "acepe github",
				links,
				status: "done",
			},
		});

		await fireEvent.click(view.getByLabelText("Expand results"));

		const icon = view.getByTestId("web-search-expanded-open-external-hugeicons-icon");
		expect(icon.tagName.toLowerCase()).toBe("svg");
		expect(icon.getAttribute("viewBox")).toBe("0 0 24 24");
		expect(icon.innerHTML).not.toBe("");
	});
});
