import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AssistantMessage } from "../../types/assistant-message.js";

vi.mock(
	"svelte",
	async () => {
		const { createRequire } = await import("node:module");
		const { dirname, join } = await import("node:path");
		const require = createRequire(import.meta.url);
		const svelteClientPath = join(dirname(require.resolve("svelte/package.json")), "src/index-client.js");

		return import(/* @vite-ignore */ svelteClientPath);
	}
);

vi.mock("@acepe/ui/agent-panel", async () => {
	const AgentToolThinking =
		(await import("./__tests__/fixtures/agent-tool-thinking-stub.svelte")).default;

	return {
		AgentToolThinking,
	};
});

vi.mock("./content-block-router.svelte", async () => {
	const ContentBlockRouter =
		(await import("./__tests__/fixtures/content-block-router-growing-stub.svelte")).default;

	return {
		default: ContentBlockRouter,
	};
});

const { default: AssistantMessageComponent } = await import("./assistant-message.svelte");

afterEach(() => {
	cleanup();
});

function createStreamingThoughtMessage(): AssistantMessage {
	return {
		chunks: [{ type: "thought", block: { type: "text", text: "thinking" } }],
	};
}

describe("AssistantMessage thinking auto-scroll", () => {
	it("keeps following thinking content that grows inside the existing DOM subtree", async () => {
		const view = render(AssistantMessageComponent, {
			message: createStreamingThoughtMessage(),
			isStreaming: true,
		});

		const thinkingContainer = view.container.querySelector(".thinking-content");
		if (!(thinkingContainer instanceof HTMLDivElement)) {
			throw new Error("Missing thinking content container");
		}

		let scrollTopValue = 0;
		Object.defineProperty(thinkingContainer, "scrollTop", {
			configurable: true,
			get: () => scrollTopValue,
			set: (value: number) => {
				scrollTopValue = value;
			},
		});

		Object.defineProperty(thinkingContainer, "scrollHeight", {
			configurable: true,
			get: () => thinkingContainer.querySelectorAll(".stub-line").length * 20,
		});

		expect(thinkingContainer.querySelectorAll(".stub-line")).toHaveLength(1);

		await fireEvent.click(view.getByTestId("grow-line"));

		await waitFor(() => {
			expect(thinkingContainer.querySelectorAll(".stub-line")).toHaveLength(2);
			expect(scrollTopValue).toBe(40);
		});

		await fireEvent.click(view.getByTestId("grow-line"));

		await waitFor(() => {
			expect(thinkingContainer.querySelectorAll(".stub-line")).toHaveLength(3);
			expect(scrollTopValue).toBe(60);
		});
	});
});
