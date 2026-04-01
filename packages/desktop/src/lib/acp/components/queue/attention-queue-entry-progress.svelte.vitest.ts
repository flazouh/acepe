import { ActivityEntry } from "@acepe/ui";
import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

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

	it("renders one compact task card with the latest child summary and a tally strip", () => {
		const { container, getByText, queryByText } = render(ActivityEntry, {
			selected: false,
			latestTaskSubagentTool: null,
			onSelect: vi.fn(),
			mode: null,
			title: "Queue item",
			timeAgo: "1m",
			insertions: 0,
			deletions: 0,
			isStreaming: true,
			taskDescription: null,
			taskSubagentSummaries: [
				"github.com",
				"raw.githubusercontent.com",
				"api.github.com",
			],
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

		expect(container.querySelectorAll("[data-testid='queue-subagent-card']")).toHaveLength(1);
		expect(getByText("api.github.com")).toBeTruthy();
		expect(queryByText("github.com")).toBeNull();
		expect(queryByText("raw.githubusercontent.com")).toBeNull();

		const card = container.querySelector("[data-testid='queue-subagent-card']");
		expect(card?.querySelector('[title="3 tool calls"]')).toBeTruthy();
		expect(card?.querySelector("[data-testid='queue-subagent-accent']")).toBeNull();
		expect(card?.className).toContain("w-full");
		expect(card?.parentElement?.className).toContain("w-full");
		expect(card?.parentElement?.className).not.toContain("max-w-[60%]");

		const tally = card?.querySelector('[title="3 tool calls"]');
		expect(tally).toBeTruthy();
		expect(tally?.children).toHaveLength(3);
	});

	it("renders the latest task child file chip in the header with svg icons and no duplicate body chip", () => {
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
			taskDescription: null,
			taskSubagentSummaries: ["Investigate parser regression", fullPath],
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

		const card = container.querySelector("[data-testid='queue-subagent-card']");
		const fileChipSelector = `[data-file-path='${fullPath}']`;
		const fileChip = card?.querySelector(fileChipSelector);
		expect(card?.querySelectorAll(fileChipSelector)).toHaveLength(1);
		expect(fileChip).toBeTruthy();
		expect(card?.firstElementChild?.querySelector(fileChipSelector)).toBeTruthy();
		expect(fileChip?.textContent).toContain("claude_code_parser.rs");
		expect(card?.querySelector("img.file-icon")?.getAttribute("src")).toContain("/svgs/icons/");
		expect(queryByText(fullPath)).toBeNull();
		expect(card?.querySelector("svg[fill='currentColor']")).toBeTruthy();
	});
});
