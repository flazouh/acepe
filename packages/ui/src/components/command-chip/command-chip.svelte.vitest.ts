import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import CommandChip from "./command-chip.svelte";

vi.mock("svelte", async () => {
	const { createRequire } = await import("node:module");
	const { dirname, join } = await import("node:path");
	const require = createRequire(import.meta.url);
	const svelteClientPath = join(
		dirname(require.resolve("svelte/package.json")),
		"src/index-client.js",
	);

	return import(/* @vite-ignore */ svelteClientPath);
});

afterEach(() => {
	cleanup();
});

describe("CommandChip rounded icons", () => {
	it("renders model commands with the rounded sliders icon", () => {
		const { container, getByText } = render(CommandChip, {
			props: {
				model: {
					command: "",
					message: "",
					stdout: "",
					displayModelName: "Opus",
					displayModelDescription: "High reasoning",
					isModelCommand: true,
				},
			},
		});

		expect(getByText("Model")).toBeTruthy();
		expect(getByText("Opus")).toBeTruthy();
		expect(container.querySelector('svg[viewBox="0 0 20 20"]')).not.toBeNull();
		expect(container.querySelector("svg")?.getAttribute("class")).toContain("h-3.5");
	});
});
