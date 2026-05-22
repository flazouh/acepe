import { describe, expect, it } from "bun:test";

import {
	formatQuestionAnswerLabels,
	getQuestionOptionClasses,
	hasActiveOtherText,
	isQuestionOptionSelected,
	isSingleQuestionSingleSelect,
	shouldShowQuestionFooter,
	shouldStopQuestionOtherKey,
} from "./agent-tool-question-state.js";
import type { AgentQuestion } from "./types.js";

function question(overrides: Partial<AgentQuestion> = {}): AgentQuestion {
	return {
		question: "Choose one",
		options: [{ label: "A" }],
		...overrides,
	};
}

describe("agent tool question state", () => {
	it("detects one single-select question", () => {
		expect(isSingleQuestionSingleSelect(null)).toBe(false);
		expect(isSingleQuestionSingleSelect([question()])).toBe(true);
		expect(isSingleQuestionSingleSelect([question({ multiSelect: true })])).toBe(false);
		expect(isSingleQuestionSingleSelect([question(), question()])).toBe(false);
	});

	it("shows the footer for multi-select questions or active Other text", () => {
		expect(
			shouldShowQuestionFooter({
				isInteractive: false,
				questions: [question({ multiSelect: true })],
				otherText: {},
			})
		).toBe(false);
		expect(
			shouldShowQuestionFooter({
				isInteractive: true,
				questions: [question()],
				otherText: {},
			})
		).toBe(false);
		expect(
			shouldShowQuestionFooter({
				isInteractive: true,
				questions: [question()],
				otherText: { 0: " custom " },
			})
		).toBe(true);
		expect(
			shouldShowQuestionFooter({
				isInteractive: true,
				questions: [question({ multiSelect: true })],
				otherText: {},
			})
		).toBe(true);
	});

	it("formats answer labels and selected option state", () => {
		expect(hasActiveOtherText({ 0: " ", 1: "Other" })).toBe(true);
		expect(
			isQuestionOptionSelected({
				selectedLabels: { 0: ["Keep"] },
				questionIndex: 0,
				label: "Keep",
			})
		).toBe(true);
		expect(
			formatQuestionAnswerLabels({
				answeredLabels: { 0: ["A", "B"] },
				questionIndex: 0,
				noAnswerLabel: "No answer",
			})
		).toBe("A, B");
		expect(
			formatQuestionAnswerLabels({
				answeredLabels: {},
				questionIndex: 0,
				noAnswerLabel: "No answer",
			})
		).toBe("No answer");
	});

	it("keeps key and option class rules named", () => {
		expect(shouldStopQuestionOtherKey("Enter")).toBe(true);
		expect(shouldStopQuestionOtherKey("Escape")).toBe(true);
		expect(shouldStopQuestionOtherKey("Tab")).toBe(false);

		expect(getQuestionOptionClasses({ selected: true, isInteractive: true })).toContain(
			"hover:bg-accent/80"
		);
		expect(getQuestionOptionClasses({ selected: false, isInteractive: false })).not.toContain(
			"cursor-pointer"
		);
	});
});
