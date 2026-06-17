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

		expect(view.queryByTestId("thinking-block-content")).toBeNull();

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
