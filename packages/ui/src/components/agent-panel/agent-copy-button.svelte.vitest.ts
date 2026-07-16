import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import AgentCopyButton from "./agent-copy-button.svelte";

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

describe("AgentCopyButton Hugeicons wiring", () => {
	it("renders message copy with the shared Hugeicons Copy icon", () => {
		const view = render(AgentCopyButton, {
			props: {
				text: "hello",
			},
		});

		const icon = view.getByTestId("agent-copy-button-linear-copy-icon");
		expect(icon.tagName.toLowerCase()).toBe("svg");
		expect(icon.getAttribute("viewBox")).toBe("0 0 24 24");
		expect(icon.innerHTML).not.toBe("");
	});

	it("renders header copy with the shared Hugeicons Copy icon", () => {
		const view = render(AgentCopyButton, {
			props: {
				text: "hello",
				size: "header",
			},
		});

		const icon = view.getByTestId("agent-copy-button-linear-copy-icon");
		expect(icon.tagName.toLowerCase()).toBe("svg");
		expect(icon.getAttribute("viewBox")).toBe("0 0 24 24");
		expect(icon.innerHTML).not.toBe("");
	});
});
