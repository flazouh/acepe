import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import AgentInputMicButton from "./agent-input-mic-button.svelte";

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

describe("AgentInputMicButton", () => {
	it("uses the compact stroke mic glyph for the idle state", () => {
		const view = render(AgentInputMicButton, {
			props: {
				title: "Start voice recording",
				ariaLabel: "Start voice recording",
				embeddedInGroup: true,
			},
		});

		const button = view.getByRole("button", { name: "Start voice recording" });
		const icon = view.getByTestId("agent-input-mic-icon");

		expect(button.getAttribute("data-slot")).toBe("button");
		expect(button.className).toContain("h-7");
		expect(button.className).toContain("w-6");
		expect(icon.tagName.toLowerCase()).toBe("svg");
		expect(icon.getAttribute("viewBox")).toBe("0 0 24 24");
		expect(icon.querySelectorAll("path").length).toBeGreaterThan(0);
		expect(icon.querySelector("path")?.getAttribute("stroke")).toBe("currentColor");
	});
});
