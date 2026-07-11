import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import AgentToolTodo from "./agent-tool-todo.svelte";
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

afterEach(() => {
	cleanup();
});

const todos: AgentTodoItem[] = [
	{ content: "Set up scaffolding", status: "completed", duration: 4000 },
	{ content: "Wire up the panel", status: "in_progress", duration: null },
	{ content: "Write tests", status: "pending", duration: null },
];

describe("AgentToolTodo redesign", () => {
	it("renders each task row with its duration", () => {
		const view = render(AgentToolTodo, { props: { todos, isLive: true } });

		expect(view.getByText("Set up scaffolding")).toBeTruthy();
		expect(view.getByText("Wire up the panel")).toBeTruthy();
		expect(view.getByText("Write tests")).toBeTruthy();
		// Right-aligned duration for the completed task.
		expect(view.getByText("4s")).toBeTruthy();
	});

	it("omits the Tasks heading, progress counter, and progress bar", () => {
		const view = render(AgentToolTodo, { props: { todos, isLive: true } });

		expect(view.queryByText("Tasks")).toBeNull();
		// The old "completed/total" counter (e.g. "1/3").
		expect(view.queryByText("1/3")).toBeNull();
		// The old progress bar used a bg-primary fill element.
		expect(view.container.querySelector(".bg-primary")).toBeNull();
	});

	it("falls back to the label when no todos are parsed", () => {
		const view = render(AgentToolTodo, {
			props: { todos: [], fallbackLabel: "Updated todos" },
		});

		expect(view.getByText("Updated todos")).toBeTruthy();
	});
});
