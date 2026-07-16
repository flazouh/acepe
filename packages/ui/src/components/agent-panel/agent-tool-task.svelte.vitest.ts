import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import AgentToolTaskRowRendererFixture from "./__tests__/fixtures/agent-tool-task-row-renderer-fixture.svelte";

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

describe("AgentToolTask", () => {
	it("uses the supplied ordinary row renderer for every scoped Task detail row", () => {
		const onTaskDetailOpenChange = vi.fn();
		const onTaskDetailLoadMore = vi.fn();
		render(AgentToolTaskRowRendererFixture, {
			props: {
				entry: {
					id: "task-root-entry",
					type: "tool_call",
					kind: "task",
					title: "Investigate transcript",
					status: "running",
				},
				taskDetail: {
					open: true,
					status: "ready",
					rows: [
						{
							rowId: "operation-task-1:question",
							entry: {
								id: "scoped-question",
								type: "tool_call",
								kind: "other",
								title: "Question",
								status: "running",
							},
						},
						{
							rowId: "operation-task-1:nested-task",
							entry: {
								id: "scoped-nested-task",
								type: "tool_call",
								kind: "task",
								title: "Nested task",
								status: "running",
							},
						},
					],
					hasMore: false,
					errorMessage: null,
				},
				onTaskDetailOpenChange,
				onTaskDetailLoadMore,
			},
		});

		const suppliedRows = screen.getAllByTestId("supplied-task-detail-row-renderer");
		expect(suppliedRows).toHaveLength(2);
		expect(suppliedRows[0]?.getAttribute("data-rendered-row-id")).toBe(
			"operation-task-1:question"
		);
		expect(suppliedRows[1]?.getAttribute("data-rendered-row-id")).toBe(
			"operation-task-1:nested-task"
		);
	});

	it("renders canonical latest action and ordinary scoped transcript rows", async () => {
		const onTaskDetailOpenChange = vi.fn();
		const onTaskDetailLoadMore = vi.fn();

		render(AgentToolTaskRowRendererFixture, {
			props: {
				entry: {
					id: "task-root-entry",
					type: "tool_call",
					kind: "task",
					title: "Investigate transcript",
					status: "running",
					taskLatestAction: {
						id: "operation-task-1:read-1",
						kind: "read",
						title: "Read",
						subtitle: "src/session.rs",
						filePath: "/repo/src/session.rs",
						status: "running",
					},
				},
				taskDetail: {
					open: true,
					status: "ready",
					rows: [
						{
							rowId: "operation-task-1:row-1",
							entry: {
								id: "scoped-thought",
								type: "thinking",
								label: "Scoped thought",
							},
						},
						{
							rowId: "operation-task-1:row-2",
							entry: {
								id: "scoped-answer",
								type: "assistant",
								markdown: "Scoped answer",
							},
						},
					],
					hasMore: true,
					errorMessage: null,
				},
				onTaskDetailOpenChange,
				onTaskDetailLoadMore,
			},
		});

		expect(screen.getByTestId("agent-tool-task-current-tool-label").textContent).toContain(
			"Read"
		);
		const detailBody = screen.getByTestId("agent-tool-task-detail-body");
		expect(detailBody.textContent).toContain("Scoped thought");
		expect(detailBody.textContent).toContain("Scoped answer");
		expect(detailBody.textContent?.indexOf("Scoped thought")).toBeLessThan(
			detailBody.textContent?.indexOf("Scoped answer") ?? -1
		);

		await fireEvent.click(screen.getByRole("button", { name: "Load more" }));
		expect(onTaskDetailLoadMore).toHaveBeenCalledOnce();

		await fireEvent.click(screen.getByRole("button", { name: "Close" }));
		expect(onTaskDetailOpenChange).toHaveBeenCalledWith(false);
	});

	it("renders the latest child action for a completed historical Task", () => {
		const onTaskDetailOpenChange = vi.fn();
		const onTaskDetailLoadMore = vi.fn();

		render(AgentToolTaskRowRendererFixture, {
			props: {
				entry: {
					id: "task-root-entry",
					type: "tool_call",
					kind: "task",
					title: "Inspect existing session",
					status: "done",
					taskLatestAction: {
						id: "operation-task-1:read-1",
						kind: "read",
						title: "Read",
						subtitle: "src/session.rs",
						filePath: "/repo/src/session.rs",
						status: "done",
					},
				},
				taskDetail: {
					open: false,
					status: "ready",
					rows: [],
					hasMore: false,
					errorMessage: null,
				},
				onTaskDetailOpenChange,
				onTaskDetailLoadMore,
			},
		});

		expect(screen.getByTestId("agent-tool-task-current-tool-label").textContent).toContain(
			"Read"
		);
	});
});
