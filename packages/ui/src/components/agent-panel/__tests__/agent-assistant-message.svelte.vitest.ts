import { cleanup, fireEvent, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import AgentAssistantMessage from "../agent-assistant-message.svelte";

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

describe("AgentAssistantMessage", () => {
	const message = {
		chunks: [
			{ type: "thought" as const, block: { type: "text" as const, text: "Checking the evidence." } },
			{ type: "message" as const, block: { type: "text" as const, text: "Done." } },
		],
	};

	const streamingThoughtMessage = {
		chunks: [
			{ type: "thought" as const, block: { type: "text" as const, text: "Weighing the options." } },
		],
	};

	it("shows a shimmering Thinking header while streaming", async () => {
		const view = render(AgentAssistantMessage, {
			props: {
				message: streamingThoughtMessage,
				isStreaming: true,
			},
		});

		await new Promise<void>((resolve) => {
			window.setTimeout(resolve, 25);
		});

		const shimmer = view.container.querySelector(".text-shimmer");
		expect(shimmer).not.toBeNull();
		expect(shimmer?.textContent).toContain("Thinking");
	});

	it("auto-collapses settled thinking content once streaming ends", async () => {
		const streamingProps = {
			messageId: "auto-collapse-on-settle",
			message,
			isStreaming: true,
			initiallyCollapsed: true,
		};
		const view = render(AgentAssistantMessage, { props: streamingProps });

		await new Promise<void>((resolve) => {
			window.setTimeout(resolve, 25);
		});

		// Expanded while the turn is streaming.
		expect(view.getByTestId("thinking-block-content").textContent).toContain(
			"Checking the evidence."
		);

		// Streaming ends -> collapse to the settled default.
		await view.rerender({
			messageId: "auto-collapse-on-settle",
			message,
			isStreaming: false,
			initiallyCollapsed: true,
		});
		await new Promise<void>((resolve) => {
			window.setTimeout(resolve, 25);
		});

		expect(view.getByTestId("thinking-block-content").closest(".thinking-collapsible")?.className).toContain(
			"is-collapsed"
		);
		expect(view.getByRole("button", { name: "Expand thinking" })).toBeTruthy();
	});

	it("respects expanded initial state for settled thinking content", async () => {
		const view = render(AgentAssistantMessage, {
			props: {
				message,
				isStreaming: false,
				initiallyCollapsed: false,
			},
		});

		await new Promise<void>((resolve) => {
			window.setTimeout(resolve, 25);
		});

		expect(view.getByTestId("thinking-block-content").textContent).toContain(
			"Checking the evidence."
		);
		expect(view.getByRole("button", { name: "Collapse thinking" })).toBeTruthy();
	});

	it("keeps settled thinking content expanded after the user opens it", async () => {
		const props = {
			messageId: "assistant-rerender",
			message,
			isStreaming: false,
			initiallyCollapsed: true,
		};
		const view = render(AgentAssistantMessage, { props });

		expect(view.getByTestId("thinking-block-content").closest(".thinking-collapsible")?.className).toContain(
			"is-collapsed"
		);

		await fireEvent.click(view.getByRole("button", { name: "Expand thinking" }));
		await view.rerender(props);
		await new Promise<void>((resolve) => {
			window.setTimeout(resolve, 25);
		});

		expect(view.getByTestId("thinking-block-content").textContent).toContain(
			"Checking the evidence."
		);
		expect(view.getByRole("button", { name: "Collapse thinking" })).toBeTruthy();
	});

	it("restores user-expanded thinking content after remount with the same message id", async () => {
		const props = {
			messageId: "assistant-remount",
			message,
			isStreaming: false,
			initiallyCollapsed: true,
		};
		const view = render(AgentAssistantMessage, { props });

		await fireEvent.click(view.getByRole("button", { name: "Expand thinking" }));
		await new Promise<void>((resolve) => {
			window.setTimeout(resolve, 25);
		});

		expect(view.getByRole("button", { name: "Collapse thinking" })).toBeTruthy();

		view.unmount();

		const remounted = render(AgentAssistantMessage, { props });

		await new Promise<void>((resolve) => {
			window.setTimeout(resolve, 25);
		});

		expect(remounted.getByTestId("thinking-block-content").textContent).toContain(
			"Checking the evidence."
		);
		expect(remounted.getByRole("button", { name: "Collapse thinking" })).toBeTruthy();
	});
});
