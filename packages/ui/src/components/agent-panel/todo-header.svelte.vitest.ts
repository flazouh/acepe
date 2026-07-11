import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import TodoHeader from "./todo-header.svelte";
import type { AgentTodoItem } from "./types.js";

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

const items: AgentTodoItem[] = [
	{ content: "First task", status: "completed", duration: 1200 },
	{ content: "Second task", status: "in_progress", duration: null },
	{ content: "Third task", status: "pending", duration: null },
];

function renderTodoHeader() {
	return render(TodoHeader, {
		props: {
			items,
			currentTask: items[1],
			completedCount: 1,
			totalCount: 3,
			isLive: true,
			allCompletedLabel: "All tasks completed",
			pausedLabel: "Tasks paused",
		},
	});
}

afterEach(() => {
	cleanup();
});

describe("TodoHeader", () => {
	it("renders the todo list on a single fully-rounded surface", () => {
		const view = renderTodoHeader();

		const surface = view.getByTestId("agent-todo-surface");
		const classes = surface.className;

		expect(classes).toContain("rounded-lg");
		expect(classes).not.toContain("rounded-t-none");
		expect(classes).not.toContain("rounded-t-md");
		expect(classes).toContain("bg-accent");
		expect(classes).toContain("shadow-sm");
		expect(classes).not.toContain("border");
		expect(classes).not.toContain("shadow-lg");

		expect(surface.textContent).toContain("First task");
		expect(surface.textContent).toContain("Third task");
		expect(surface.textContent).not.toContain("All tasks completed");
	});
});
