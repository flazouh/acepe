import { beforeEach, describe, expect, it } from "vitest";

import { QuestionSelectionStore } from "../question-selection-store.svelte.js";

describe("QuestionSelectionStore", () => {
	let store: QuestionSelectionStore;

	beforeEach(() => {
		store = new QuestionSelectionStore();
	});

	describe("option selection", () => {
		it("should start with no selections", () => {
			expect(store.isOptionSelected("q1", 0, "Option A")).toBe(false);
			expect(store.hasSelections("q1", 0)).toBe(false);
		});

		it("should toggle option for multi-select", () => {
			store.toggleOption("q1", 0, "Option A");
			expect(store.isOptionSelected("q1", 0, "Option A")).toBe(true);

			store.toggleOption("q1", 0, "Option A");
			expect(store.isOptionSelected("q1", 0, "Option A")).toBe(false);
		});

		it("should allow multiple selections for multi-select", () => {
			store.toggleOption("q1", 0, "Option A");
			store.toggleOption("q1", 0, "Option B");

			expect(store.isOptionSelected("q1", 0, "Option A")).toBe(true);
			expect(store.isOptionSelected("q1", 0, "Option B")).toBe(true);
		});

		it("should set single option and clear others", () => {
			store.toggleOption("q1", 0, "Option A");
			store.setSingleOption("q1", 0, "Option B");

			expect(store.isOptionSelected("q1", 0, "Option A")).toBe(false);
			expect(store.isOptionSelected("q1", 0, "Option B")).toBe(true);
		});

		it("should deactivate Other mode when selecting predefined option in single-select", () => {
			store.toggleOtherMode("q1", 0, true);
			store.setOtherText("q1", 0, "Custom text");
			expect(store.isOtherActive("q1", 0)).toBe(true);

			store.setSingleOption("q1", 0, "Option A");
			expect(store.isOtherActive("q1", 0)).toBe(false);
		});

		it("should track selections per question index", () => {
			store.toggleOption("q1", 0, "Option A");
			store.toggleOption("q1", 1, "Option B");

			expect(store.isOptionSelected("q1", 0, "Option A")).toBe(true);
			expect(store.isOptionSelected("q1", 0, "Option B")).toBe(false);
			expect(store.isOptionSelected("q1", 1, "Option A")).toBe(false);
			expect(store.isOptionSelected("q1", 1, "Option B")).toBe(true);
		});

		it("should track selections per question ID", () => {
			store.toggleOption("q1", 0, "Option A");
			store.toggleOption("q2", 0, "Option B");

			expect(store.isOptionSelected("q1", 0, "Option A")).toBe(true);
			expect(store.isOptionSelected("q1", 0, "Option B")).toBe(false);
			expect(store.isOptionSelected("q2", 0, "Option A")).toBe(false);
			expect(store.isOptionSelected("q2", 0, "Option B")).toBe(true);
		});
	});

	describe("Other mode", () => {
		it("should start with Other mode inactive", () => {
			expect(store.isOtherActive("q1", 0)).toBe(false);
			expect(store.getOtherText("q1", 0)).toBe("");
		});

		it("should toggle Other mode", () => {
			store.toggleOtherMode("q1", 0);
			expect(store.isOtherActive("q1", 0)).toBe(true);

			store.toggleOtherMode("q1", 0);
			expect(store.isOtherActive("q1", 0)).toBe(false);
		});

		it("should clear Other text when deactivating", () => {
			store.toggleOtherMode("q1", 0);
			store.setOtherText("q1", 0, "Custom text");
			expect(store.getOtherText("q1", 0)).toBe("Custom text");

			store.toggleOtherMode("q1", 0);
			expect(store.getOtherText("q1", 0)).toBe("");
		});

		it("should clear selections when activating Other in single-select mode", () => {
			store.toggleOption("q1", 0, "Option A");
			expect(store.isOptionSelected("q1", 0, "Option A")).toBe(true);

			store.toggleOtherMode("q1", 0, true); // clearSelectionsIfActivating = true
			expect(store.isOptionSelected("q1", 0, "Option A")).toBe(false);
			expect(store.isOtherActive("q1", 0)).toBe(true);
		});

		it("should not clear selections when activating Other in multi-select mode", () => {
			store.toggleOption("q1", 0, "Option A");
			expect(store.isOptionSelected("q1", 0, "Option A")).toBe(true);

			store.toggleOtherMode("q1", 0, false); // clearSelectionsIfActivating = false
			expect(store.isOptionSelected("q1", 0, "Option A")).toBe(true);
			expect(store.isOtherActive("q1", 0)).toBe(true);
		});

		it("should set Other text", () => {
			store.toggleOtherMode("q1", 0);
			store.setOtherText("q1", 0, "My custom answer");
			expect(store.getOtherText("q1", 0)).toBe("My custom answer");
		});

		it("should set Other mode directly with setOtherModeActive", () => {
			store.setOtherModeActive("q1", 0, true);
			expect(store.isOtherActive("q1", 0)).toBe(true);

			store.setOtherText("q1", 0, "Custom text");
			store.setOtherModeActive("q1", 0, false);
			expect(store.isOtherActive("q1", 0)).toBe(false);
			expect(store.getOtherText("q1", 0)).toBe("");
		});
	});

	describe("hasSelections", () => {
		it("should return false when no selections", () => {
			expect(store.hasSelections("q1", 0)).toBe(false);
		});

		it("should return true when option is selected", () => {
			store.toggleOption("q1", 0, "Option A");
			expect(store.hasSelections("q1", 0)).toBe(true);
		});

		it("should return true when Other has text", () => {
			store.toggleOtherMode("q1", 0);
			store.setOtherText("q1", 0, "Custom text");
			expect(store.hasSelections("q1", 0)).toBe(true);
		});

		it("should return false when Other is active but empty", () => {
			store.toggleOtherMode("q1", 0);
			expect(store.hasSelections("q1", 0)).toBe(false);
		});

		it("should return false when Other has only whitespace", () => {
			store.toggleOtherMode("q1", 0);
			store.setOtherText("q1", 0, "   ");
			expect(store.hasSelections("q1", 0)).toBe(false);
		});
	});

	describe("getAnswers", () => {
		it("should return empty array when no selections", () => {
			expect(store.getAnswers("q1", 0, false)).toEqual([]);
			expect(store.getAnswers("q1", 0, true)).toEqual([]);
		});

		it("should return single option for single-select", () => {
			store.setSingleOption("q1", 0, "Option A");
			expect(store.getAnswers("q1", 0, false)).toEqual(["Option A"]);
		});

		it("should return Other text for single-select when active", () => {
			store.toggleOtherMode("q1", 0, true);
			store.setOtherText("q1", 0, "Custom answer");
			expect(store.getAnswers("q1", 0, false)).toEqual(["Custom answer"]);
		});

		it("should return all options for multi-select", () => {
			store.toggleOption("q1", 0, "Option A");
			store.toggleOption("q1", 0, "Option B");
			const answers = store.getAnswers("q1", 0, true);
			expect(answers).toContain("Option A");
			expect(answers).toContain("Option B");
			expect(answers.length).toBe(2);
		});

		it("should include Other text in multi-select", () => {
			store.toggleOption("q1", 0, "Option A");
			store.toggleOtherMode("q1", 0, false);
			store.setOtherText("q1", 0, "Custom answer");
			const answers = store.getAnswers("q1", 0, true);
			expect(answers).toContain("Option A");
			expect(answers).toContain("Custom answer");
			expect(answers.length).toBe(2);
		});

		it("should trim Other text", () => {
			store.toggleOtherMode("q1", 0, true);
			store.setOtherText("q1", 0, "  Custom answer  ");
			expect(store.getAnswers("q1", 0, false)).toEqual(["Custom answer"]);
		});
	});

	describe("clearQuestion", () => {
		it("should clear all state for a question", () => {
			store.toggleOption("q1", 0, "Option A");
			store.toggleOption("q1", 1, "Option B");
			store.toggleOtherMode("q1", 2, true);
			store.setOtherText("q1", 2, "Custom text");

			store.clearQuestion("q1");

			expect(store.isOptionSelected("q1", 0, "Option A")).toBe(false);
			expect(store.isOptionSelected("q1", 1, "Option B")).toBe(false);
			expect(store.isOtherActive("q1", 2)).toBe(false);
			expect(store.getOtherText("q1", 2)).toBe("");
		});

		it("should not affect other questions", () => {
			store.toggleOption("q1", 0, "Option A");
			store.toggleOption("q2", 0, "Option B");

			store.clearQuestion("q1");

			expect(store.isOptionSelected("q1", 0, "Option A")).toBe(false);
			expect(store.isOptionSelected("q2", 0, "Option B")).toBe(true);
		});
	});

	describe("hasAnySelections", () => {
		it("should return false when no selections for any index", () => {
			expect(store.hasAnySelections("q1")).toBe(false);
		});

		it("should return true when any index has selections", () => {
			store.toggleOption("q1", 2, "Option A");
			expect(store.hasAnySelections("q1")).toBe(true);
		});

		it("should return true when any index has Other text", () => {
			store.toggleOtherMode("q1", 1);
			store.setOtherText("q1", 1, "Custom");
			expect(store.hasAnySelections("q1")).toBe(true);
		});

		it("should return false for different question ID", () => {
			store.toggleOption("q1", 0, "Option A");
			expect(store.hasAnySelections("q2")).toBe(false);
		});
	});

	describe("clearSelections", () => {
		it("should clear only selections for a specific question index", () => {
			store.toggleOption("q1", 0, "Option A");
			store.toggleOption("q1", 0, "Option B");
			store.toggleOtherMode("q1", 0);
			store.setOtherText("q1", 0, "Custom");

			store.clearSelections("q1", 0);

			expect(store.isOptionSelected("q1", 0, "Option A")).toBe(false);
			expect(store.isOptionSelected("q1", 0, "Option B")).toBe(false);
			// Note: clearSelections only clears selectedOptions, not Other mode
			expect(store.isOtherActive("q1", 0)).toBe(true);
		});
	});

	describe("getSelectedOptions", () => {
		it("should return a SvelteSet of selected options", () => {
			store.toggleOption("q1", 0, "Option A");
			store.toggleOption("q1", 0, "Option B");

			const selected = store.getSelectedOptions("q1", 0);
			expect(selected.has("Option A")).toBe(true);
			expect(selected.has("Option B")).toBe(true);
			expect(selected.size).toBe(2);
		});

		it("should return empty set when no selections", () => {
			const selected = store.getSelectedOptions("q1", 0);
			expect(selected.size).toBe(0);
		});
	});
});
