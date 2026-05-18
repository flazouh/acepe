import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TodoState } from "$lib/acp/types/todo.js";

import TodoHeader from "./todo-header.svelte";

const mockGetTodoStateFromToolCalls = vi.fn();

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

vi.mock("$lib/acp/logic/todo-state-manager.svelte.js", () => ({
	getTodoStateManager: () => ({
		getTodoStateFromToolCalls: mockGetTodoStateFromToolCalls,
	}),
}));

vi.mock("@acepe/ui", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@acepe/ui")>();
	const Stub = (await import("./pr-status-card/test-component-stub.svelte")).default;
	const TextShimmerStub = (await import("./__tests__/text-shimmer-stub.svelte")).default;

	return {
		SegmentedProgress: actual.SegmentedProgress,
		TextShimmer: TextShimmerStub,
		TodoNumberIcon: Stub,
	};
});

vi.mock("@acepe/ui/agent-panel", async () => {
	const Stub = (await import("./pr-status-card/test-component-stub.svelte")).default;

	return {
		AgentPanelTodoHeader: Stub,
	};
});

vi.mock("./animated-chevron.svelte", async () => {
	const Stub = (await import("./pr-status-card/test-component-stub.svelte")).default;

	return {
		default: Stub,
	};
});

vi.mock("./messages/copy-button.svelte", async () => {
	const Stub = (await import("./pr-status-card/test-component-stub.svelte")).default;

	return {
		default: Stub,
	};
});

vi.mock("phosphor-svelte/lib/CheckCircle", async () => {
	const Stub = (await import("./pr-status-card/test-component-stub.svelte")).default;

	return {
		default: Stub,
	};
});

afterEach(() => {
	cleanup();
	mockGetTodoStateFromToolCalls.mockReset();
});

describe("TodoHeader", () => {
	it("renders one progress segment per todo and fills completed ones without numeric counter", () => {
		const todoState: TodoState = {
			items: [
				{ content: "first", status: "completed", duration: 1000 },
				{ content: "second", status: "completed", duration: 1000 },
				{ content: "third", status: "completed", duration: 1000 },
				{ content: "fourth", status: "pending" },
				{ content: "fifth", status: "pending" },
			],
			currentTask: null,
			completedCount: 3,
			totalCount: 5,
			isLive: false,
			lastUpdatedAt: new Date("2026-03-25T00:00:00Z"),
		};

		mockGetTodoStateFromToolCalls.mockReturnValue({
			isOk: () => true,
			isErr: () => false,
			value: todoState,
		});

		const { container } = render(TodoHeader, {
			sessionId: "session-1",
			toolCalls: [],
			isConnected: false,
			status: "idle",
			isStreaming: false,
		});

		const segments = Array.from(
			container.querySelectorAll("[data-testid='todo-progress-segment']")
		);

		expect(segments).toHaveLength(5);
		expect(container.textContent).not.toContain("3/5");
		expect(
			segments.filter((segment) => segment.getAttribute("data-filled") === "true")
		).toHaveLength(3);
		expect(
			segments.filter((segment) => segment.getAttribute("data-filled") === "false")
		).toHaveLength(2);
	});

	it("shows plain current task text in the collapsed header instead of shimmer", () => {
		const todoState: TodoState = {
			items: [
				{ content: "first", status: "completed", duration: 1000 },
				{ content: "currently running", activeForm: "Currently running", status: "in_progress" },
			],
			currentTask: {
				content: "currently running",
				activeForm: "Currently running",
				status: "in_progress",
			},
			completedCount: 1,
			totalCount: 2,
			isLive: true,
			lastUpdatedAt: new Date("2026-03-25T00:00:00Z"),
		};

		mockGetTodoStateFromToolCalls.mockReturnValue({
			isOk: () => true,
			isErr: () => false,
			value: todoState,
		});

		const { container } = render(TodoHeader, {
			sessionId: "session-1",
			toolCalls: [],
			isConnected: true,
			status: "streaming",
			isStreaming: true,
		});

		const shimmerStubs = container.querySelectorAll("[data-testid='text-shimmer-stub']");

		expect(shimmerStubs).toHaveLength(1);
		expect(container.textContent).toContain("Currently running");
	});
});
