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

	return {
		SegmentedProgress: actual.SegmentedProgress,
		TodoNumberIcon: Stub,
	};
});

afterEach(() => {
	cleanup();
	mockGetTodoStateFromToolCalls.mockReset();
});

describe("TodoHeader", () => {
	it("renders todo items without the status footer", () => {
		const todoState: TodoState = {
			items: [
				{ content: "first", status: "completed", duration: 1000 },
				{ content: "second", status: "completed", duration: 1000 },
				{ content: "third", status: "pending" },
			],
			currentTask: null,
			completedCount: 2,
			totalCount: 3,
			isLive: false,
			lastUpdatedAt: new Date("2026-03-25T00:00:00Z"),
		};

		mockGetTodoStateFromToolCalls.mockReturnValue({
			isOk: () => true,
			isErr: () => false,
			value: todoState,
		});

		const view = render(TodoHeader, {
			sessionId: "session-1",
			toolCalls: [],
			isConnected: false,
			status: "idle",
			isStreaming: false,
		});

		const surface = view.getByTestId("agent-todo-surface");

		expect(surface.textContent).toContain("first");
		expect(surface.textContent).toContain("third");
		expect(surface.textContent).not.toContain("All tasks completed");
		expect(surface.querySelectorAll("[data-testid='todo-progress-segment']")).toHaveLength(0);
	});

	it("shows progress segments only in compact mode", () => {
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
			compact: true,
		});

		const segments = Array.from(
			container.querySelectorAll("[data-testid='todo-progress-segment']")
		);

		expect(segments).toHaveLength(2);
		expect(container.textContent).toContain("Currently running");
	});
});
