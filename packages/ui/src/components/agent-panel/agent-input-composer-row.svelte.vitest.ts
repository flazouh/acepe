import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { createRawSnippet } from "svelte";
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

	it("keeps the submit button to the right of trailing toolbar controls", () => {
		const trailing = createRawSnippet(() => ({
			render: () => '<span data-testid="context-window-widget">Context</span>',
		}));

		render(AgentInputComposerRow, {
			props: {
				placeholder: "Ask the agent",
				submitAriaLabel: "Send message",
				trailing,
			},
		});

		const button = screen.getByRole("button", { name: "Send message" });
		const contextWidget = screen.getByTestId("context-window-widget");
		const cluster = button.parentElement;
		const toolbarRow = cluster?.parentElement;
		const glyph = button.querySelector("svg");
		const glyphClass = glyph?.getAttribute("class");

		expect(toolbarRow?.className).toContain("items-end");
		expect(toolbarRow?.className).toContain("justify-between");
		expect(toolbarRow?.getAttribute("data-qa")).toBe("agent-input-toolbar-row");
		expect(cluster?.getAttribute("data-qa")).toBe("agent-input-submit-cluster");
		expect(button.className).toContain("h-7");
		expect(button.className).toContain("w-7");
		expect(button.className).not.toContain("h-8");
		expect(button.className).not.toContain("w-8");
		expect(button.className).toContain("rounded-lg");
		expect(button.className).not.toContain("rounded-md");
		expect(glyphClass).toContain("h-4");
		expect(glyphClass).toContain("w-4");
		expect(glyphClass).not.toContain("h-3.5");
		expect(glyphClass).not.toContain("w-3.5");
		expect(cluster?.className).toContain("justify-end");
		expect(cluster?.className).toContain("items-end");
		expect(cluster?.className).toContain("min-w-0");
		expect(cluster?.className).toContain("max-w-full");
		expect(cluster?.className).not.toContain("flex-1");
		expect(cluster?.className).not.toContain("shrink-0");
		expect(
			contextWidget.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});

	it("gives the editor a slightly taller resting height", () => {
		render(AgentInputComposerRow, {
			props: {
				placeholder: "Ask the agent",
				submitAriaLabel: "Send message",
			},
		});

		const editor = screen.getByRole("textbox");
		expect(editor.className).toContain("min-h-7");
		expect(editor.className).not.toContain("min-h-6");
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

	it("shows a split menu for choosing busy Enter behavior", async () => {
		const onEnterBehaviorChange = vi.fn();
		render(AgentInputComposerRow, {
			props: {
				placeholder: "Ask the agent",
				submitAriaLabel: "Send message",
				submitDisabled: true,
				isEmpty: true,
				enterBehavior: "queue",
				enterBehaviorMenuLabel: "Enter behavior",
				enterQueueLabel: "Queue",
				enterQueueDescription: "Runs after the agent finishes its current turn.",
				enterSteerLabel: "Steer",
				enterSteerDescription: "Interrupts now and redirects the agent immediately.",
				onEnterBehaviorChange,
			},
		});

		const menuButton = screen.getByRole("button", { name: "Enter behavior" });
		const submitButton = screen.getByRole("button", { name: "Send message" });
		const buttonGroup = submitButton.closest('[data-slot="button-group"]');

		expect(buttonGroup?.className).toContain("h-7");
		expect(buttonGroup?.className).toContain("!rounded-lg");
		expect(buttonGroup?.className).toContain("opacity-50");
		expect(submitButton.className).toContain("rounded-l-lg");
		expect(submitButton.className).not.toContain("opacity-50");
		expect(menuButton.className).toContain("rounded-r-lg");
		expect(menuButton.className).not.toContain("opacity-50");
		expect(menuButton.hasAttribute("disabled")).toBe(false);

		await fireEvent.click(menuButton);
		const queueItem = await screen.findByRole("menuitemradio", { name: /Queue/ });
		const steerItem = await screen.findByRole("menuitemradio", { name: /Steer/ });

		expect(screen.getByText("Runs after the agent finishes its current turn.")).toBeTruthy();
		expect(screen.getByText("Interrupts now and redirects the agent immediately.")).toBeTruthy();
		expect(queueItem.querySelector(".size-2.rounded-full")).toBeNull();

		await fireEvent.click(steerItem);

		expect(onEnterBehaviorChange).toHaveBeenCalledWith("steer");
	});

	it("fades the split submit group when disabled even with draft text", () => {
		render(AgentInputComposerRow, {
			props: {
				placeholder: "Ask the agent",
				submitAriaLabel: "Send message",
				submitDisabled: true,
				isEmpty: false,
				enterBehaviorMenuLabel: "Enter behavior",
				onEnterBehaviorChange: vi.fn(),
			},
		});

		const menuButton = screen.getByRole("button", { name: "Enter behavior" });
		const submitButton = screen.getByRole("button", { name: "Send message" });
		const buttonGroup = submitButton.closest('[data-slot="button-group"]');

		expect(buttonGroup?.className).toContain("opacity-50");
		expect(menuButton.className).not.toContain("opacity-50");
		expect(menuButton.hasAttribute("disabled")).toBe(false);
	});

	it("keeps the split submit group full opacity when submit is enabled without draft", () => {
		render(AgentInputComposerRow, {
			props: {
				placeholder: "Ask the agent",
				submitAriaLabel: "Stop agent",
				submitIntent: "stop",
				submitDisabled: false,
				isEmpty: true,
				enterBehaviorMenuLabel: "Enter behavior",
				onEnterBehaviorChange: vi.fn(),
			},
		});

		const menuButton = screen.getByRole("button", { name: "Enter behavior" });
		const submitButton = screen.getByRole("button", { name: "Stop agent" });
		const buttonGroup = submitButton.closest('[data-slot="button-group"]');

		expect(buttonGroup?.className).not.toContain("opacity-50");
		expect(menuButton.className).not.toContain("opacity-50");
		expect(menuButton.hasAttribute("disabled")).toBe(false);
	});
});
