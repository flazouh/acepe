import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import AgentInputComposerRow from "./agent-input-composer-row.svelte";

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

afterEach(() => cleanup());

describe("AgentInputComposerRow", () => {
	it("exposes the primary send button by aria-label", () => {
		render(AgentInputComposerRow, {
			props: {
				placeholder: "Ask the agent",
				submitAriaLabel: "Send message",
			},
		});

		const button = screen.getByRole("button", { name: "Send message" });
		expect(button.getAttribute("aria-label")).toBe("Send message");
	});

	it("keeps the submit glyph decorative", () => {
		render(AgentInputComposerRow, {
			props: {
				placeholder: "Ask the agent",
				submitAriaLabel: "Send message",
			},
		});

		const button = screen.getByRole("button", { name: "Send message" });
		expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
	});

	it("keeps the submit button aligned with the bottom-right control rhythm", () => {
		render(AgentInputComposerRow, {
			props: {
				placeholder: "Ask the agent",
				submitAriaLabel: "Send message",
			},
		});

		const button = screen.getByRole("button", { name: "Send message" });
		const cluster = button.parentElement;
		const glyph = button.querySelector("svg");
		const glyphClass = glyph?.getAttribute("class");

		expect(button.className).toContain("h-8");
		expect(button.className).toContain("w-8");
		expect(button.className).not.toContain("h-7");
		expect(button.className).not.toContain("w-7");
		expect(button.className).toContain("rounded-lg");
		expect(button.className).not.toContain("rounded-md");
		expect(glyphClass).toContain("h-4");
		expect(glyphClass).toContain("w-4");
		expect(glyphClass).not.toContain("h-3.5");
		expect(glyphClass).not.toContain("w-3.5");
		expect(cluster?.className).toContain("gap-0.5");
		expect(cluster?.className).not.toContain("gap-2");
	});

	it("uses the provided submit handler and disabled state", () => {
		const onSubmit = vi.fn();
		render(AgentInputComposerRow, {
			props: {
				placeholder: "Ask the agent",
				submitAriaLabel: "Stop agent",
				submitIntent: "stop",
				submitDisabled: true,
				onSubmit,
			},
		});

		const button = screen.getByRole("button", { name: "Stop agent" });
		expect(button.hasAttribute("disabled")).toBe(true);
		button.click();
		expect(onSubmit).not.toHaveBeenCalled();
	});
});
