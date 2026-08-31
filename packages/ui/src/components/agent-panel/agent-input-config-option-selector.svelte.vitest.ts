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

describe("AgentInputConfigOptionSelector reasoning trigger tooltip", () => {
	function makeReasoningOption(): AgentInputConfigOption {
		return {
			id: "reasoning_effort",
			name: "Reasoning Effort",
			category: "reasoning_effort",
			type: "select",
			description:
				"Controls Claude reasoning depth. A change applies when the session next connects.",
			currentValue: "auto",
			options: [
				{ name: "Auto", value: "auto" },
				{ name: "High", value: "high" },
			],
			presentation: "compactReasoning",
		};
	}

	// The fused model+reasoning group passes embeddedInGroup, and the Selector
	// used to suppress its rich tooltip there -- so the option's description
	// (including "a change applies when the session next connects") was
	// invisible in exactly the layout Claude sessions get. The trigger must
	// carry the tooltip wiring, drop the redundant native title, and keep the
	// fused segment styling.
	it("wires the rich tooltip on the embedded trigger instead of a native title", () => {
		const view = render(AgentInputConfigOptionSelector, {
			props: {
				configOption: makeReasoningOption(),
				embeddedInGroup: true,
				onValueChange: vi.fn(),
			},
		});

		const button = view.container.querySelector("button");
		expect(button).not.toBeNull();
		expect(button?.hasAttribute("data-tooltip-trigger")).toBe(true);
		expect(button?.hasAttribute("title")).toBe(false);
		expect(button?.className).toContain("!rounded-none");
	});

	it("wires the rich tooltip on the standalone trigger too", () => {
		const view = render(AgentInputConfigOptionSelector, {
			props: {
				configOption: makeReasoningOption(),
				onValueChange: vi.fn(),
			},
		});

		const button = view.container.querySelector("button");
		expect(button?.hasAttribute("data-tooltip-trigger")).toBe(true);
	});
});
