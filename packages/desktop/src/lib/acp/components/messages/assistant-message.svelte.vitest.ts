import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AssistantMessage } from "../../types/assistant-message.js";

type ResizeObserverCallback = () => void;

class TestResizeObserver {
	readonly targets = new Set<Element>();

	constructor(private readonly callback: ResizeObserverCallback) {
		resizeObservers.push(this);
	}

	observe(target: Element): void {
		this.targets.add(target);
	}

	disconnect(): void {
		this.targets.clear();
	}

	trigger(): void {
		this.callback();
	}
}

const resizeObservers: TestResizeObserver[] = [];

type QueuedAnimationFrame = {
	id: number;
	callback: FrameRequestCallback;
};

let queuedAnimationFrames: QueuedAnimationFrame[] = [];
let nextAnimationFrameId = 1;

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

vi.mock("@acepe/ui/agent-panel", async () => {
	const AgentToolThinking = (await import("./__tests__/fixtures/agent-tool-thinking-stub.svelte"))
		.default;

	return {
		AgentToolThinking,
	};
});

vi.mock("./content-block-router.svelte", async () => {
	const ContentBlockRouter = (
		await import("./__tests__/fixtures/content-block-router-growing-stub.svelte")
	).default;

	return {
		default: ContentBlockRouter,
	};
});

const { default: AssistantMessageComponent } = await import("./assistant-message.svelte");

afterEach(() => {
	cleanup();
	resizeObservers.length = 0;
	queuedAnimationFrames = [];
	nextAnimationFrameId = 1;
	vi.unstubAllGlobals();
});

function triggerResizeObservers(): void {
	for (const observer of resizeObservers) {
		observer.trigger();
	}
}

async function flushAnimationFrames(): Promise<void> {
	const queued = [...queuedAnimationFrames];
	queuedAnimationFrames = [];
	for (const frame of queued) {
		frame.callback(0);
	}
	await Promise.resolve();
}

function createStreamingThoughtMessage(): AssistantMessage {
	return {
		chunks: [{ type: "thought", block: { type: "text", text: "thinking" } }],
	};
}

describe("AssistantMessage thinking auto-scroll", () => {
	it("coalesces repeated thinking growth notifications into one scroll update per frame", async () => {
		vi.stubGlobal("ResizeObserver", TestResizeObserver);
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback): number => {
			const id = nextAnimationFrameId;
			nextAnimationFrameId += 1;
			queuedAnimationFrames.push({ id, callback });
			return id;
		});
		vi.stubGlobal("cancelAnimationFrame", (id: number): void => {
			queuedAnimationFrames = queuedAnimationFrames.filter((frame) => frame.id !== id);
		});

		const view = render(AssistantMessageComponent, {
			message: createStreamingThoughtMessage(),
			isStreaming: true,
		});

		const thinkingContainer = view.container.querySelector(".thinking-content");
		if (!(thinkingContainer instanceof HTMLDivElement)) {
			throw new Error("Missing thinking content container");
		}

		let scrollTopValue = 0;
		let scrollWrites = 0;
		Object.defineProperty(thinkingContainer, "scrollTop", {
			configurable: true,
			get: () => scrollTopValue,
			set: (value: number) => {
				scrollTopValue = value;
				scrollWrites += 1;
			},
		});

		Object.defineProperty(thinkingContainer, "scrollHeight", {
			configurable: true,
			get: () => thinkingContainer.querySelectorAll(".stub-line").length * 20,
		});

		Object.defineProperty(thinkingContainer, "clientHeight", {
			configurable: true,
			get: () => 20,
		});

		scrollWrites = 0;

		await fireEvent.click(view.getByTestId("grow-line"));
		triggerResizeObservers();
		await fireEvent.click(view.getByTestId("grow-line"));
		triggerResizeObservers();

		expect(scrollWrites).toBe(0);

		await flushAnimationFrames();

		expect(scrollWrites).toBe(1);
		expect(scrollTopValue).toBe(60);
	});

	it("keeps following thinking content that grows inside the existing DOM subtree", async () => {
		vi.stubGlobal("ResizeObserver", TestResizeObserver);
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback): number => {
			const id = nextAnimationFrameId;
			nextAnimationFrameId += 1;
			queuedAnimationFrames.push({ id, callback });
			return id;
		});
		vi.stubGlobal("cancelAnimationFrame", (id: number): void => {
			queuedAnimationFrames = queuedAnimationFrames.filter((frame) => frame.id !== id);
		});

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
		triggerResizeObservers();
		await flushAnimationFrames();

		await waitFor(() => {
			expect(thinkingContainer.querySelectorAll(".stub-line")).toHaveLength(2);
			expect(scrollTopValue).toBe(40);
		});

		await fireEvent.click(view.getByTestId("grow-line"));
		triggerResizeObservers();
		await flushAnimationFrames();

		await waitFor(() => {
			expect(thinkingContainer.querySelectorAll(".stub-line")).toHaveLength(3);
			expect(scrollTopValue).toBe(60);
		});
	});
});
