import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import ActivityEntry from "../../../../../../ui/src/components/attention-queue/attention-queue-entry.svelte";

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

describe("ActivityEntry todo progress", () => {
	it("renders one segment per todo and fills completed ones without numeric counter", () => {
		const { container } = render(ActivityEntry, {
			selected: false,
			latestTaskSubagentTool: null,
			onSelect: vi.fn(),
			mode: null,
			title: "Queue item",
			timeAgo: "1m",
			insertions: 0,
			deletions: 0,
			isStreaming: false,
			taskDescription: null,
			taskSubagentSummaries: [],
			showTaskSubagentList: false,
			fileToolDisplayText: null,
			toolContent: null,
			showToolShimmer: false,
			statusText: null,
			showStatusShimmer: false,
			todoProgress: {
				current: 3,
				total: 5,
				label: "Working through todos",
			},
			currentQuestion: null,
			totalQuestions: 0,
			hasMultipleQuestions: false,
			currentQuestionIndex: 0,
			questionId: "",
			questionProgress: [],
			currentQuestionAnswered: false,
			currentAnswerDisplay: "",
			currentQuestionOptions: [],
			otherText: "",
			otherPlaceholder: "Other",
			showOtherInput: true,
			showSubmitButton: false,
			canSubmit: false,
			submitLabel: "Submit",
			onOptionSelect: vi.fn(),
			onOtherInput: vi.fn(),
			onOtherKeydown: vi.fn(),
			onSubmitAll: vi.fn(),
			onPrevQuestion: vi.fn(),
			onNextQuestion: vi.fn(),
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

	it("renders the parent task label in the header with the default tally footer", () => {
		const { container, getByText, queryByText } = render(ActivityEntry, {
			selected: false,
			latestTaskSubagentTool: null,
			taskSubagentTools: [
				{
					id: "child-1",
					type: "tool_call",
					kind: "search",
					title: "Grep",
					subtitle: "github.com",
					status: "done",
				},
				{
					id: "child-2",
					type: "tool_call",
					kind: "fetch",
					title: "Fetch",
					subtitle: "raw.githubusercontent.com",
					status: "done",
				},
				{
					id: "child-3",
					type: "tool_call",
					kind: "search",
					title: "Grep",
					subtitle: "api.github.com",
					status: "running",
				},
			],
			onSelect: vi.fn(),
			mode: null,
			title: "Queue item",
			timeAgo: "1m",
			insertions: 0,
			deletions: 0,
			isStreaming: true,
			taskDescription: "Explore GitHub endpoints",
			taskSubagentSummaries: ["github.com", "raw.githubusercontent.com", "api.github.com"],
			showTaskSubagentList: true,
			fileToolDisplayText: null,
			toolContent: null,
			showToolShimmer: false,
			statusText: null,
			showStatusShimmer: false,
			todoProgress: null,
			currentQuestion: null,
			totalQuestions: 0,
			hasMultipleQuestions: false,
			currentQuestionIndex: 0,
			questionId: "",
			questionProgress: [],
			currentQuestionAnswered: false,
			currentAnswerDisplay: "",
			currentQuestionOptions: [],
			otherText: "",
			otherPlaceholder: "Other",
			showOtherInput: true,
			showSubmitButton: false,
			canSubmit: false,
			submitLabel: "Submit",
			onOptionSelect: vi.fn(),
			onOtherInput: vi.fn(),
			onOtherKeydown: vi.fn(),
			onSubmitAll: vi.fn(),
			onPrevQuestion: vi.fn(),
			onNextQuestion: vi.fn(),
		});

		expect(container.querySelectorAll("[data-testid='agent-tool-task-card']")).toHaveLength(1);
		expect(getByText("Explore GitHub endpoints")).toBeTruthy();
		expect(queryByText("github.com")).toBeTruthy();
		expect(queryByText("raw.githubusercontent.com")).toBeTruthy();
		expect(queryByText("api.github.com")).toBeTruthy();

		const card = container.querySelector("[data-testid='agent-tool-task-card']");
		expect(card?.querySelector('[title="3 tool calls"]')).toBeTruthy();
		expect(card?.className).toContain("w-full");
		expect(card?.parentElement?.className).toContain("w-full");
		expect(card?.parentElement?.className).not.toContain("max-w-[60%]");

		const tally = card?.querySelector('[title="3 tool calls"]');
		expect(tally).toBeTruthy();
		expect(tally?.className).toContain("border-t");
		expect(tally?.children).toHaveLength(3);
	});

	it("renders a robot header label and the latest file row below it with one svg chip", () => {
		const fullPath = "packages/desktop/src-tauri/src/acp/parsers/claude_code_parser.rs";
		const { container, queryByText } = render(ActivityEntry, {
			selected: false,
			onSelect: vi.fn(),
			mode: null,
			title: "Queue item",
			timeAgo: "1m",
			insertions: 0,
			deletions: 0,
			isStreaming: true,
			taskDescription: "Explore parser regression",
			taskSubagentSummaries: ["Investigate parser regression", fullPath],
			taskSubagentTools: [
				{
					id: "child-1",
					type: "tool_call",
					kind: "search",
					title: "Grep",
					subtitle: "Investigate parser regression",
					status: "done",
				},
				{
					id: "child-2",
					type: "tool_call",
					kind: "read",
					title: "Reading",
					filePath: fullPath,
					status: "running",
				},
			],
			latestTaskSubagentTool: {
				id: "child-2",
				kind: "read",
				title: "Read",
				filePath: fullPath,
				status: "running",
			},
			showTaskSubagentList: true,
			fileToolDisplayText: null,
			toolContent: null,
			showToolShimmer: false,
			statusText: null,
			showStatusShimmer: false,
			todoProgress: null,
			currentQuestion: null,
			totalQuestions: 0,
			hasMultipleQuestions: false,
			currentQuestionIndex: 0,
			questionId: "",
			questionProgress: [],
			currentQuestionAnswered: false,
			currentAnswerDisplay: "",
			currentQuestionOptions: [],
			otherText: "",
			otherPlaceholder: "Other",
			showOtherInput: true,
			showSubmitButton: false,
			canSubmit: false,
			submitLabel: "Submit",
			onOptionSelect: vi.fn(),
			onOtherInput: vi.fn(),
			onOtherKeydown: vi.fn(),
			onSubmitAll: vi.fn(),
			onPrevQuestion: vi.fn(),
			onNextQuestion: vi.fn(),
		});

		const card = container.querySelector("[data-testid='agent-tool-task-card']");
		const fileChipSelector = `[data-file-path='${fullPath}']`;
		const fileChip = card?.querySelector(fileChipSelector);
		expect(card?.querySelectorAll(fileChipSelector)).toHaveLength(1);
		expect(fileChip).toBeTruthy();
		expect(card?.firstElementChild?.textContent).toContain("Explore parser regression");
		expect(card?.firstElementChild?.querySelector(fileChipSelector)).toBeNull();
		expect(card?.children[1]?.querySelector(fileChipSelector)).toBeTruthy();
		expect(card?.children[2]?.querySelector(fileChipSelector)).toBeNull();
		expect(fileChip?.textContent).toContain("claude_code_parser.rs");
		expect(card?.querySelector("img.file-icon")?.getAttribute("src")).toContain("/svgs/icons/");
		expect(queryByText(fullPath)).toBeNull();
		expect(card?.querySelectorAll("svg[fill='currentColor']").length).toBeGreaterThan(0);
	});

	it("renders a gerund tool label with a tiny file chip in the compact activity row", () => {
		const fullPath = "packages/ui/src/components/attention-queue/attention-queue-entry.svelte";
		const { container, getByText, queryByText } = render(ActivityEntry, {
			selected: false,
			onSelect: vi.fn(),
			mode: null,
			title: "Queue item",
			timeAgo: "1m",
			insertions: 0,
			deletions: 0,
			isStreaming: true,
			taskDescription: null,
			taskSubagentSummaries: [],
			showTaskSubagentList: false,
			latestToolDisplay: {
				id: "tool-edit-1",
				title: "Editing",
				filePath: fullPath,
				status: "running",
			},
			fileToolDisplayText: "Edit attention-queue-entry.svelte",
			toolContent: null,
			showToolShimmer: false,
			statusText: null,
			showStatusShimmer: false,
			todoProgress: null,
			currentQuestion: null,
			totalQuestions: 0,
			hasMultipleQuestions: false,
			currentQuestionIndex: 0,
			questionId: "",
			questionProgress: [],
			currentQuestionAnswered: false,
			currentAnswerDisplay: "",
			currentQuestionOptions: [],
			otherText: "",
			otherPlaceholder: "Other",
			showOtherInput: true,
			showSubmitButton: false,
			canSubmit: false,
			submitLabel: "Submit",
			onOptionSelect: vi.fn(),
			onOtherInput: vi.fn(),
			onOtherKeydown: vi.fn(),
			onSubmitAll: vi.fn(),
			onPrevQuestion: vi.fn(),
			onNextQuestion: vi.fn(),
		});

		expect(getByText("Editing")).toBeTruthy();
		expect(
			container.querySelector(`[data-file-path='${fullPath}'] .file-name`)?.textContent
		).toContain("attention-queue-entry.svelte");
		expect(queryByText("Edit attention-queue-entry.svelte")).toBeNull();
	});
});
