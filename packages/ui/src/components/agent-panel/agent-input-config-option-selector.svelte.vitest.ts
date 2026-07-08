import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import AgentInputConfigOptionSelector from "./agent-input-config-option-selector.svelte";
import type { AgentInputConfigOption } from "./agent-input-config-option-types.js";

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

describe("AgentInputConfigOptionSelector fast mode button", () => {
	function makeFastModeOption(currentValue: boolean): AgentInputConfigOption {
		return {
			id: "service_tier",
			name: "Fast mode",
			category: "runtime",
			type: "boolean",
			currentValue,
			presentation: "compactSpeed",
		};
	}

	it("uses the composer chip button footprint without changing the glyph", () => {
		const view = render(AgentInputConfigOptionSelector, {
			props: {
				configOption: makeFastModeOption(true),
				onValueChange: vi.fn(),
			},
		});

		const button = view.getByTestId("agent-input-fast-mode-button");
		const icon = button.querySelector("svg");

		expect(button.className).toContain("bg-secondary");
		expect(button.className).toContain("size-7");
		expect(button.className).toContain("p-0");
		expect(button.className).not.toContain("h-[28px]");
		expect(button.className).not.toContain("w-[24px]");
		expect(button.className).not.toContain("w-[28px]");
		expect(icon?.getAttribute("viewBox")).toBe("0 0 24 24");
	});

	it("emits the next boolean value when clicked", async () => {
		const onValueChange = vi.fn();
		const view = render(AgentInputConfigOptionSelector, {
			props: {
				configOption: makeFastModeOption(false),
				onValueChange,
			},
		});

		await fireEvent.click(view.getByTestId("agent-input-fast-mode-button"));

		expect(onValueChange).toHaveBeenCalledTimes(1);
		expect(onValueChange).toHaveBeenCalledWith("service_tier", "true");
	});
});
